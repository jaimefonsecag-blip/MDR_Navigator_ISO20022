// Reported: the JSON schema viewer showed a pointless extra level between the
// message root and its real fields - "BankToCustomerAccountReport" containing
// "Message root <Document>" containing the actual building blocks - because
// the MDR structure table's very first row is always the ISO 20022 envelope
// itself ("Message root <Document> <BkToCstmrAcctRpt>"), which is the exact
// same thing the schema's own root node already represents, not a real nested
// field. schemaBuildMessageRoot() now detects that lone envelope row and
// skips straight to its children, carrying its constraint/definition/page up
// onto the root instead of losing them. This check exercises the real
// function against a synthetic structure shaped like a typical MDR message.
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

// Everything schemaBuildMessageRoot() actually calls on the "real structure
// table" path, extracted verbatim. schemaTypeInfo (datatype/CodeSet
// resolution) is unrelated to this fix and is stubbed instead, the same way
// check-schema-lookahead.js stubs schemaStructureBlock.
const levelsBlock = extract('function calculateElementLevels', 'function renderElementExplorer', 'calculateElementLevels()');
const coreBlock = extract('function parseSchemaMultiplicity', 'function schemaBlockIndex', 'parseSchemaMultiplicity + schemaTableIndex');
const looksComplexBlock = extract('function schemaLooksComplex', 'function schemaResolveDefinition', 'schemaLooksComplex()');
const orGroupsBlock = extract('function schemaOrGroups(siblings)', 'function schemaCodeSetFor', 'schemaOrGroups()');
const nodeBlock = extract('function schemaCreateNode(config)', 'function schemaNodeChildren', 'schemaCreateNode()');
const nameBlock = extract('function schemaMessageRootName', 'function schemaSyntheticNode', 'schemaMessageRootName()');
const synthBlock = extract('function schemaSyntheticNode(config)', 'function schemaBuildMessageRoot', 'schemaSyntheticNode()');
const buildBlock = extract('function schemaBuildMessageRoot(msgId)', 'function schemaBuildBlockRoot', 'schemaBuildMessageRoot()');
const wrapBlock = extract('function schemaWrapDocument(rootNode)', 'function schemaPropName', 'schemaWrapDocument()');

function makeSandbox(MDR) {
    const SchemaViewer = { nextId: 1, nodes: new Map() };
    const SCHEMA_SIMPLE_TYPES = ['Text', 'DateTime', 'Date', 'Time', 'CodeSet', 'Indicator', 'Boolean',
        'Amount', 'Quantity', 'Rate', 'Identifier', 'IdentifierSet', 'Number', 'Decimal'];
    const schemaTypeInfo = () => ({
        jsonType: 'string', label: 'string', kind: '', datatypeName: '', codeSet: null, codes: [],
        external: false, minLength: null, maxLength: null, length: null, totalDigits: null,
        fractionDigits: null, pattern: '', jsonFormat: ''
    });
    const { schemaBuildMessageRoot } = new Function(
        'SchemaViewer', 'MDR', 'SCHEMA_SIMPLE_TYPES', 'schemaTypeInfo', 'SCHEMA_TABLE_CACHE',
        `${levelsBlock}\n${coreBlock}\n${looksComplexBlock}\n${orGroupsBlock}\n${nodeBlock}\n${nameBlock}\n${synthBlock}\n${buildBlock}\n${wrapBlock}
        return { schemaBuildMessageRoot };`
    )(SchemaViewer, MDR, SCHEMA_SIMPLE_TYPES, schemaTypeInfo, new WeakMap());
    return { schemaBuildMessageRoot, SchemaViewer };
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

console.log('--- caso reportado: BankToCustomerAccountReport <Document> ---');
{
    const envelope = { name: 'Message root <Document>', tag: 'BkToCstmrAcctRpt', mult: '[1..1]', type: '',
        constraint: 'C23, C29', refPage: '', definition: '', x: 10, bb: '' };
    const groupHeader = { name: 'GroupHeader', tag: 'GrpHdr', mult: '[1..1]', type: '', constraint: '', refPage: '12', definition: '', x: 30, bb: '' };
    const msgId = { name: 'MessageIdentification', tag: 'MsgId', mult: '[1..1]', type: 'Text', constraint: '', refPage: '', definition: '', x: 50, bb: '' };
    const report = { name: 'Report', tag: 'Rpt', mult: '[1..n]', type: '', constraint: '', refPage: '15', definition: '', x: 30, bb: '' };
    const msg = {
        name: 'BankToCustomerAccountReport', sectionRoot: '2', definition: '', buildingBlocks: {},
        elements: [envelope, groupHeader, msgId, report]
    };
    const { schemaBuildMessageRoot } = makeSandbox({ messages: { m1: msg } });
    const documentNode = schemaBuildMessageRoot('m1');
    const messageNode = documentNode.children[0];

    expect('la raiz sigue llamandose como el mensaje (no "Message root <Document>")',
        messageNode.name, 'BankToCustomerAccountReport');
    expect('el envoltorio "Message root <Document>" no aparece como nivel propio',
        messageNode.children.map(c => c.name), ['GroupHeader', 'Report']);
    expect('el constraint del envoltorio (C23, C29) sube a la raiz en vez de perderse',
        messageNode.constraint, 'C23, C29');
    expect('GroupHeader sigue siendo complejo (tiene a MessageIdentification debajo)',
        messageNode.children[0].complex, true);
    expect('MessageIdentification no aparece al primer nivel (sigue anidado bajo GroupHeader)',
        documentNode.children[0].children.some(c => c.name === 'MessageIdentification'), false);
}

console.log('\n--- un mensaje con varios building blocks en el nivel superior no se toca ---');
{
    // No single envelope row here - two real top-level blocks - so there is
    // nothing to collapse; this must render exactly as before the fix.
    const blockA = { name: 'GroupHeader', tag: 'GrpHdr', mult: '[1..1]', type: '', constraint: '', refPage: '', definition: '', x: 10, bb: '' };
    const blockB = { name: 'Report', tag: 'Rpt', mult: '[1..n]', type: '', constraint: '', refPage: '', definition: '', x: 10, bb: '' };
    const msg = { name: 'SomeMessage', sectionRoot: '2', definition: '', buildingBlocks: {}, elements: [blockA, blockB] };
    const { schemaBuildMessageRoot } = makeSandbox({ messages: { m1: msg } });
    const messageNode = schemaBuildMessageRoot('m1').children[0];
    expect('con dos raices reales no hay envoltorio que colapsar: se mantienen las dos',
        messageNode.children.map(c => c.name), ['GroupHeader', 'Report']);
}

console.log('\n--- una unica raiz real (no un envoltorio "Message root") no se colapsa ---');
{
    // A message that genuinely has only one top-level building block must
    // keep showing it - only the literal envelope row gets skipped, not every
    // message with a single root.
    const soleBlock = { name: 'SoleBlock', tag: 'SlBk', mult: '[1..1]', type: '', constraint: '', refPage: '', definition: '', x: 10, bb: '' };
    const child = { name: 'InnerField', tag: 'InrFld', mult: '[1..1]', type: 'Text', constraint: '', refPage: '', definition: '', x: 30, bb: '' };
    const msg = { name: 'SomeOtherMessage', sectionRoot: '2', definition: '', buildingBlocks: {}, elements: [soleBlock, child] };
    const { schemaBuildMessageRoot } = makeSandbox({ messages: { m1: msg } });
    const messageNode = schemaBuildMessageRoot('m1').children[0];
    expect('sigue mostrando "SoleBlock" como unico hijo (no es el envoltorio ISO 20022)',
        messageNode.children.map(c => c.name), ['SoleBlock']);
}

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas del envoltorio del esquema pasaron');
process.exit(failures ? 1 : 0);
