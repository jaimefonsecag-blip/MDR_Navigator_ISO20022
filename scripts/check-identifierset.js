// Reported: fields whose MDR "Type" column value is "IdentifierSet" (AnyBIC,
// LEI...) showed up as expandable objects with "0 propiedades" in the JSON
// schema viewer, instead of the plain string field the sample JSON already
// showed correctly (e.g. "AnyBIC": "GTCHUS33"). Root cause: the PDF structure
// table row parser's isType() whitelist did not know the token
// "IdentifierSet", so it silently dropped it and left element.type empty -
// exactly the signal every downstream view uses for "this is a container,
// resolve its own structure". Fixed at the source (isType) plus the two other
// independent "is this a simple/leaf datatype" whitelists that had to agree
// with it: SCHEMA_SIMPLE_TYPES (schema viewer) and renderElementTable's
// inline isSimpleType (element explorer). This check exercises all three.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

function extract(startMarker, endMarker, label) {
    const s = script.indexOf(startMarker);
    const e = script.indexOf(endMarker, s);
    if (s === -1 || e === -1 || e <= s) {
        console.error(`No se encontro el bloque "${label}" en index.html`);
        process.exit(1);
    }
    return script.slice(s, e);
}

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

console.log('--- isType() reconoce "IdentifierSet" en la columna Type ---');
{
    const isTypeBlock = extract('function isType(s) {', '// ===== NAVIGATION FUNCTIONS =====', 'isType()');
    const { isType } = new Function(`${isTypeBlock}\nreturn { isType };`)();
    expect('isType("IdentifierSet") es true', isType('IdentifierSet'), true);
    // The other whitelisted values must keep working (no accidental narrowing).
    ['Text', 'DateTime', 'Date', 'CodeSet', 'Indicator', 'Amount', 'Quantity', 'Rate', 'Identifier', 'Boolean']
        .forEach(t => expect(`isType("${t}") sigue en true`, isType(t), true));
    expect('un token cualquiera que no es un Type real sigue en false', isType('SomeRandomWord'), false);
}

console.log('\n--- la fila de la tabla de estructura captura element.type = "IdentifierSet" ---');
{
    // The exact row-construction logic used while parsing the PDF structure
    // table, lifted verbatim so this proves the real parser, not a re-typed
    // copy of it.
    const isTypeBlock = extract('function isType(s) {', '// ===== NAVIGATION FUNCTIONS =====', 'isType()');
    // The extracted slice is the body of "if (structMatch) { ... }" up to (not
    // including) its closing brace, since the row's remaining construction
    // (elem object, dedup, push) is out of scope for what this fix touches.
    const rowBlock = extract('const structMatch = line.match', 'const bbTag = currentBB', 'parseo de la fila de estructura');
    const { parseRow } = new Function(`${isTypeBlock}
    function parseRow(line) {
        let result = { dataType: '', refPage: '', constraint: '', matched: false };
        ${rowBlock}
        result = { dataType, refPage, constraint, matched: true };
        }
        return result;
    }
    return { parseRow };`)();

    expect('AnyBIC <AnyBIC> [1..1] IdentifierSet 45 -> type IdentifierSet, sin constraint',
        parseRow('AnyBIC <AnyBIC> [1..1] IdentifierSet 45'),
        { dataType: 'IdentifierSet', refPage: '45', constraint: '', matched: true });
    expect('LEI <LEI> [1..1] IdentifierSet C1 46 -> conserva el constraint',
        parseRow('LEI <LEI> [1..1] IdentifierSet C1 46'),
        { dataType: 'IdentifierSet', refPage: '46', constraint: 'C1', matched: true });
    // A row truly without a Type column (e.g. a container row) must still fall
    // through to the "no type at all" behaviour - this fix must not make every
    // row look like IdentifierSet.
    expect('una fila sin columna Type real sigue sin capturar ningun tipo',
        parseRow('ReferenceIssuer <RefIssr> [0..1] 47'),
        { dataType: '', refPage: '47', constraint: '', matched: true });
}

console.log('\n--- el visor de esquema JSON trata IdentifierSet como campo simple, no como objeto ---');
{
    const schemaBlock = extract('const SCHEMA_SIMPLE_TYPES', 'function schemaResolveDefinition', 'tipos simples del esquema');
    const { SCHEMA_SIMPLE_TYPES, schemaLooksComplex } = new Function(`${schemaBlock}
    return { SCHEMA_SIMPLE_TYPES, schemaLooksComplex };`)();
    expect('SCHEMA_SIMPLE_TYPES incluye IdentifierSet', SCHEMA_SIMPLE_TYPES.includes('IdentifierSet'), true);
    expect('schemaLooksComplex({type:"IdentifierSet"}) es false (no se trata como objeto)',
        schemaLooksComplex({ type: 'IdentifierSet' }), false);
    expect('un elemento con type vacio (el caso previo al bug) si se sigue tratando como contenedor',
        schemaLooksComplex({ type: '' }), true);
}

console.log('\n--- el explorador de elementos enlaza AnyBIC/LEI al detalle, no a la estructura ---');
{
    const explorerBlock = extract('function renderElementTable', 'function elementExplorerRows', 'renderElementTable()');
    const { renderElementTable } = new Function(
        'calculateElementLevels', 'registerElementDetailReference', 'MDR',
        `${explorerBlock}\nreturn { renderElementTable };`
    )(
        elements => new Map(elements.map(el => [el, 0])),
        (msgId, elem) => `${msgId}::${elem.tag}`,
        { messages: { m1: { constraints: {} } } }
    );

    const html = renderElementTable([
        { name: 'AnyBIC', tag: 'AnyBIC', mult: '[1..1]', type: 'IdentifierSet', or: '', constraint: '', refPage: '' },
        { name: 'LEI', tag: 'LEI', mult: '[1..1]', type: 'IdentifierSet', or: '', constraint: '', refPage: '' }
    ], 'm1', '');

    expect('AnyBIC llama a showElementDetailByKey (campo simple)',
        /AnyBIC<\/span>/.test(html) && html.includes(`onclick="showElementDetailByKey('m1::AnyBIC')"`), true);
    expect('AnyBIC NO llama a navigateToStructureByKey (no se trata como objeto)',
        html.includes(`onclick="navigateToStructureByKey('m1::AnyBIC')"`), false);
    expect('LEI llama a showElementDetailByKey (campo simple)',
        html.includes(`onclick="showElementDetailByKey('m1::LEI')"`), true);
    expect('LEI NO llama a navigateToStructureByKey', html.includes(`onclick="navigateToStructureByKey('m1::LEI')"`), false);
}

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de IdentifierSet pasaron');
process.exit(failures ? 1 : 0);
