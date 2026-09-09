// The OpenAPI generator (button "Generar OpenAPI" inside the JSON schema
// viewer) has no server and no build step to catch a broken merge: a wrong
// ancestor lookup would silently misplace a field, and a wrong required/array
// rule would silently produce an invalid schema that still "looks" fine in
// the preview. The pure-logic half (selection grouping, required overrides,
// $ref extraction, YAML serialization) is exercised here against a synthetic
// node tree, the same way check-schema.js tests the MessageComponent
// resolution without a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

const start = script.indexOf('const API_ENUM_INLINE_LIMIT');
const end = script.indexOf('function apiCopyText');
if (start === -1 || end === -1) {
    console.error('No se encontro el bloque del generador OpenAPI en index.html');
    process.exit(1);
}
const block = script.slice(start, end);

const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function makeStore() {
    const nodes = new Map();
    const makeNode = (id, cfg) => {
        const node = Object.assign({
            id, complex: false, isArray: false, isOr: false, orGroup: 0, required: false,
            min: 0, max: 1, definition: '', typeInfo: { jsonType: 'string', codes: [] }
        }, cfg);
        nodes.set(id, node);
        return node;
    };
    return { nodes, makeNode };
}

function load(schemaComponentInfo, nodes) {
    const SchemaViewer = { nodes, msgId: 'pain.001.001.11' };
    return new Function('escapeHtml', 'SchemaViewer', 'schemaComponentInfo', 'document', `${block}
    return {
        ApiBuilder, apiBuildSelectionTree, apiIsRequired, apiBuildComponents, apiBuildSample, apiToYaml,
        apiHighlightJson, apiHighlightYaml
    };`)(escapeHtml, SchemaViewer, schemaComponentInfo, { getElementById: () => null });
}

let failures = 0;
const expect = (label, actual, wanted) => {
    const ok = JSON.stringify(actual) === JSON.stringify(wanted);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) {
        failures++;
        console.log(`      esperado: ${JSON.stringify(wanted)}`);
        console.log(`      obtenido: ${JSON.stringify(actual)}`);
    }
};

console.log('--- ancestro seleccionado mas cercano ---');
{
    const { nodes, makeNode } = makeStore();
    // GrpHdr(sel) > MsgId(sel), CreDtTm(sel)
    // Tx(NOT sel, array) > Amt(sel), Dbtr(NOT sel) > Nm(sel), Purp(sel, override required)
    makeNode('grphdr', { name: 'GroupHeader', tag: 'GrpHdr', complex: true, required: true, min: 1, max: 1 });
    makeNode('msgid', { name: 'MessageIdentification', tag: 'MsgId', required: true, min: 1, max: 1,
        typeInfo: { jsonType: 'string', maxLength: 35, codes: [] } });
    makeNode('credttm', { name: 'CreationDateTime', tag: 'CreDtTm', required: true, min: 1, max: 1,
        typeInfo: { jsonType: 'string', jsonFormat: 'date-time', codes: [] } });
    makeNode('tx', { name: 'CreditTransferTransactionInformation', tag: 'CdtTrfTxInf', complex: true,
        isArray: true, min: 1, max: Infinity, required: true });
    makeNode('amt', { name: 'Amount', tag: 'Amt', required: true, min: 1, max: 1,
        typeInfo: { jsonType: 'number', codes: [] } });
    makeNode('dbtr', { name: 'Debtor', tag: 'Dbtr', complex: true, required: false, min: 0, max: 1 });
    makeNode('dbtrnm', { name: 'Name', tag: 'Nm', required: false, min: 0, max: 1,
        typeInfo: { jsonType: 'string', codes: [] } });
    makeNode('purp', { name: 'Purpose', tag: 'Purp', required: false, min: 0, max: 1,
        typeInfo: { jsonType: 'string', datatypeName: 'ExternalPurpose1Code',
            codes: Array.from({ length: 5 }, (_, i) => ({ code: `P${i}` })) } });

    const api = load(() => null, nodes);
    api.ApiBuilder.selected.set('grphdr', { path: ['grphdr'], required: null });
    api.ApiBuilder.selected.set('msgid', { path: ['grphdr', 'msgid'], required: null });
    api.ApiBuilder.selected.set('credttm', { path: ['grphdr', 'credttm'], required: null });
    api.ApiBuilder.selected.set('amt', { path: ['tx', 'amt'], required: null });
    api.ApiBuilder.selected.set('dbtrnm', { path: ['tx', 'dbtr', 'dbtrnm'], required: false });
    api.ApiBuilder.selected.set('purp', { path: ['tx', 'purp'], required: true });

    const top = api.apiBuildSelectionTree();
    expect('los campos sin ancestro marcado suben a la raiz (Amt, Nm, Purp) junto a GrpHdr',
        top.map(t => t.id).sort(), ['amt', 'dbtrnm', 'grphdr', 'purp'].sort());
    expect('GrpHdr conserva sus dos hijos marcados',
        [...top.find(t => t.id === 'grphdr').children.keys()].sort(), ['credttm', 'msgid'].sort());

    expect('MsgId obligatorio por cardinalidad MDR ([1..1])', api.apiIsRequired(nodes.get('msgid')), true);
    expect('Nm forzado a opcional por override manual', api.apiIsRequired(nodes.get('dbtrnm')), false);
    expect('Purpose forzado a obligatorio pese a ser opcional en el MDR', api.apiIsRequired(nodes.get('purp')), true);

    const schemas = api.apiBuildComponents();
    const root = schemas[Object.keys(schemas)[0]];
    expect('el nombre por defecto termina en Request', /Request$/.test(Object.keys(schemas)[0]), true);
    expect('GrpHdr se anida como objeto con sus dos campos', root.properties.GroupHeader.type, 'object');
    expect('MsgId respeta la longitud maxima del MDR', root.properties.GroupHeader.properties.MessageIdentification.maxLength, 35);
    expect('CreDtTm usa el formato date-time', root.properties.GroupHeader.properties.CreationDateTime.format, 'date-time');
    expect('Amount queda como number directo en la raiz (Tx no esta marcado)', root.properties.Amount.type, 'number');
    expect('required de la raiz respeta cardinalidad + override', root.required.sort(),
        ['Amount', 'GroupHeader', 'Purpose'].sort());
    expect('un CodeSet corto se vuelca completo como enum', root.properties.Purpose.enum, ['P0', 'P1', 'P2', 'P3', 'P4']);

    const sample = api.apiBuildSample();
    expect('el preview JSON usa un valor de ejemplo por tipo (date-time)', sample.GroupHeader.CreationDateTime, '2024-01-01T00:00:00Z');
    expect('el preview JSON no envuelve un campo simple en objeto', typeof sample.Amount, 'number');

    const yaml = api.apiToYaml({ components: { schemas } });
    expect('el YAML generado empieza por components:', yaml.startsWith('components:'), true);
    expect('el YAML no deja placeholders de template sin resolver', /\$\{/.test(yaml), false);
}

console.log('\n--- MessageComponent reutilizable -> $ref propio en components ---');
{
    const { nodes, makeNode } = makeStore();
    makeNode('party', { name: 'Party', tag: 'Pty', complex: true, required: true, min: 1, max: 1 });
    makeNode('partynm', { name: 'Name', tag: 'Nm', required: true, min: 1, max: 1,
        typeInfo: { jsonType: 'string', codes: [] } });
    makeNode('bigcode', { name: 'CountryCode', tag: 'Ctry', required: false, min: 0, max: 1,
        typeInfo: { jsonType: 'string', datatypeName: 'ExternalCountryCode',
            codes: Array.from({ length: 250 }, (_, i) => ({ code: `C${i}` })) } });

    const api = load(node => (node.id === 'party'
        ? { name: 'PartyIdentification272', page: 336, section: '6.1', fields: 2 } : null), nodes);
    api.ApiBuilder.selected.set('party', { path: ['party'], required: null });
    api.ApiBuilder.selected.set('partynm', { path: ['party', 'partynm'], required: null });
    api.ApiBuilder.selected.set('bigcode', { path: ['party', 'bigcode'], required: null });

    const schemas = api.apiBuildComponents();
    const rootName = Object.keys(schemas).find(key => key !== 'PartyIdentification272');
    expect('se registra un schema aparte con el nombre del MessageComponent', 'PartyIdentification272' in schemas, true);
    expect('la propiedad del padre queda como referencia, no como objeto anidado',
        Object.keys(schemas[rootName].properties.Party), ['$ref']);
    expect('el componente registrado trae los campos marcados dentro de el',
        Object.keys(schemas.PartyIdentification272.properties).sort(), ['CountryCode', 'Name'].sort());
    expect('un CodeSet externo grande no se vuelca completo (supera el limite de inlining)',
        'enum' in schemas.PartyIdentification272.properties.CountryCode, false);
    expect('en su lugar queda una nota legible con el conteo',
        /250 valores/.test(schemas.PartyIdentification272.properties.CountryCode.description || ''), true);
}

console.log('\n--- nombres duplicados entre ramas huerfanas no se pisan ---');
{
    const { nodes, makeNode } = makeStore();
    makeNode('branchAParent', { name: 'BranchA', tag: 'BrA', complex: true, required: false });
    makeNode('ccyA', { name: 'Currency', tag: 'Ccy', required: false, typeInfo: { jsonType: 'string', codes: [] } });
    makeNode('branchBParent', { name: 'BranchB', tag: 'BrB', complex: true, required: false });
    makeNode('ccyB', { name: 'Currency', tag: 'Ccy', required: false, typeInfo: { jsonType: 'string', codes: [] } });

    const api = load(() => null, nodes);
    api.ApiBuilder.selected.set('ccyA', { path: ['branchAParent', 'ccyA'], required: null });
    api.ApiBuilder.selected.set('ccyB', { path: ['branchBParent', 'ccyB'], required: null });
    const schemas = api.apiBuildComponents();
    const root = schemas[Object.keys(schemas)[0]];
    expect('la segunda "Currency" huerfana se numera en vez de sobrescribir la primera',
        'Currency' in root.properties && 'Currency_2' in root.properties, true);
}

console.log('\n--- resaltado de sintaxis en las cajas de preview ---');
{
    const { nodes } = makeStore();
    const api = load(() => null, nodes);
    const jsonHtml = api.apiHighlightJson('{\n  "a": "<script>",\n  "b": 3.5,\n  "c": true,\n  "d": null\n}');
    expect('la clave se resalta con la clase jk', /<span class="jk">"a":<\/span>/.test(jsonHtml), true);
    expect('la cadena se resalta con la clase js', /<span class="js">"&lt;script&gt;"<\/span>/.test(jsonHtml), true);
    expect('el numero se resalta con la clase jn', /<span class="jn">3\.5<\/span>/.test(jsonHtml), true);
    expect('el booleano se resalta con la clase jb', /<span class="jb">true<\/span>/.test(jsonHtml), true);
    expect('null se resalta con la clase jz', /<span class="jz">null<\/span>/.test(jsonHtml), true);
    expect('no deja una etiqueta script sin escapar (inyeccion de HTML)', /<script>/.test(jsonHtml), false);

    const yamlHtml = api.apiHighlightYaml('components:\n  schemas:\n    Foo:\n      type: object\n      required:\n        - Bar\n# un comentario');
    expect('la clave yaml se resalta con la clase jk', /<span class="jk">type<\/span>/.test(yamlHtml), true);
    expect('el valor yaml se resalta como cadena', /<span class="js">object<\/span>/.test(yamlHtml), true);
    expect('un elemento de lista se resalta igual que un valor', /<span class="js">Bar<\/span>/.test(yamlHtml), true);
    expect('un comentario se marca con la clase jcm en vez de resaltarse como valor', /<span class="jcm"># un comentario<\/span>/.test(yamlHtml), true);
}

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas del generador OpenAPI pasaron');
process.exit(failures ? 1 : 0);
