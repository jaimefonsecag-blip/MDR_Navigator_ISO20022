// Reported: the building block tree showed every root field twice — once as a
// generic "±" placeholder (registered before its "contains X on page N"
// sentence resolved) and once with the actual reusable MessageComponent it
// points at (e.g. "MessageIdentification1", "InvestmentFundOrder4"). Both
// share the same numbered subsection and XML tag, so messageRootBuildingBlocks
// now keeps only the one that actually names a component. This check exercises
// that de-duplication directly.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

function extract(startMarker, endMarker, label) {
    const s = script.indexOf(startMarker);
    const e = script.indexOf(endMarker, s);
    if (s === -1 || e === -1) {
        console.error(`No se encontro el bloque "${label}" en index.html`);
        process.exit(1);
    }
    return script.slice(s, e);
}

const sectionHelpers = extract('function sectionNumberParts', 'function navigateToMessage', 'numeros de seccion');
const dedupAndRoots = extract('function preferResolvedBuildingBlock', 'function buildingBlockEntryIndex', 'agrupacion de building blocks raiz');
const componentName = extract('const SCHEMA_NOT_A_COMPONENT', 'function schemaComponentInfo', 'nombre del MessageComponent');

const api = new Function(`${sectionHelpers}\n${componentName}\n${dedupAndRoots}
return { preferResolvedBuildingBlock, messageRootBuildingBlocks, schemaComponentName };`)();

let failures = 0;
const expect = (label, actual, wanted) => {
    const ok = JSON.stringify(actual) === JSON.stringify(wanted);
    if (!ok) {
        failures++;
        console.log(`FAIL  ${label}`);
        console.log(`      esperado: ${JSON.stringify(wanted)}`);
        console.log(`      obtenido: ${JSON.stringify(actual)}`);
        return;
    }
    console.log(`PASS  ${label}`);
};

console.log('--- schemaComponentName (referencia) ---');
expect('un bloque "±" no nombra ningun componente',
    api.schemaComponentName({ typeName: '±' }), '');
expect('un componente resuelto si se reconoce',
    api.schemaComponentName({ componentTypeName: 'MessageIdentification1' }), 'MessageIdentification1');

console.log('\n--- deduplicacion por seccion + tag ---');
const placeholder = { section: '2.4.1', tag: 'MsgId', name: 'MessageIdentification', typeName: '±', elements: [{}] };
const resolved = { section: '2.4.1', tag: 'MsgId', name: 'MessageIdentification', componentTypeName: 'MessageIdentification1', elements: [{}, {}] };
expect('con las dos entradas, solo sobrevive la que referencia el componente',
    api.preferResolvedBuildingBlock([placeholder, resolved]).map(bb => bb.componentTypeName || bb.typeName),
    ['MessageIdentification1']);
expect('el orden de llegada no importa',
    api.preferResolvedBuildingBlock([resolved, placeholder]).map(bb => bb.componentTypeName || bb.typeName),
    ['MessageIdentification1']);

const otherField = { section: '2.4.2', tag: 'OrdrRef', name: 'OrderReference', typeName: '±', elements: [{}] };
const otherResolved = { section: '2.4.2', tag: 'OrdrRef', name: 'OrderReference', componentTypeName: 'InvestmentFundOrder4', elements: [{}] };
expect('campos distintos (secciones distintas) no se mezclan entre si',
    api.preferResolvedBuildingBlock([placeholder, resolved, otherField, otherResolved])
        .map(bb => bb.componentTypeName || bb.typeName).sort(),
    ['InvestmentFundOrder4', 'MessageIdentification1']);

const onlyPlaceholder = { section: '2.4.3', tag: 'PrvsRef', name: 'PreviousReference', typeName: '±', elements: [{}] };
expect('sin una version resuelta, el placeholder se conserva (no desaparece el campo)',
    api.preferResolvedBuildingBlock([onlyPlaceholder]).length, 1);

const twoResolved = { section: '2.4.1', tag: 'MsgId', name: 'MessageIdentification', componentTypeName: 'OtroNombre9', elements: [{}] };
expect('si ambas nombran un componente, se queda con una sola entrada (no se duplica)',
    api.preferResolvedBuildingBlock([resolved, twoResolved]).length, 1);

console.log('\n--- integracion con messageRootBuildingBlocks ---');
const msg = { sectionRoot: '2' };
const rootEntries = [placeholder, resolved, otherField, otherResolved];
const roots = api.messageRootBuildingBlocks(msg, rootEntries);
expect('la lista raiz no repite el mismo campo', roots.length, 2);
expect('cada campo raiz queda representado por su version con componente',
    roots.map(bb => bb.componentTypeName).sort(), ['InvestmentFundOrder4', 'MessageIdentification1']);

// A nested structure's own subsections (deeper sections, or a different
// sectionRoot entirely) must never be pulled into the root list nor affect
// the de-duplication of unrelated root fields.
const nestedUnderMsgId = { section: '2.4.1.3', tag: 'Nm', name: 'Name', typeName: 'Max140Text', elements: [{}] };
const foreignRoot = { section: '9.4.1', tag: 'MsgId', name: 'MessageIdentification', componentTypeName: 'Foreign1', elements: [{}] };
const rootsWithNoise = api.messageRootBuildingBlocks(msg, [placeholder, resolved, nestedUnderMsgId, foreignRoot]);
expect('una subseccion mas profunda no aparece en la raiz', rootsWithNoise.length, 1);
expect('un building block de otro mensaje (seccion raiz distinta) no se mezcla',
    rootsWithNoise[0].componentTypeName, 'MessageIdentification1');

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de deduplicacion de building blocks pasaron');
process.exit(failures ? 1 : 0);
