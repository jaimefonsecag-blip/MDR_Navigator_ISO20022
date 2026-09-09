// check-api-sample.js
//
// Verifica que apiSampleFromName devuelva ejemplos contextuales según el
// nombre del campo, el tag XML, el datatype ISO 20022 y — para campos
// ambiguos como "Name" o "Identification" — el nombre del nodo padre.
// También verifica que apiSampleLeaf los use correctamente, sin romper
// el fallback a CodeSets ni a los tipos genéricos.

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
        console.error(`No se encontró el bloque "${label}" en index.html`);
        process.exit(1);
    }
    return script.slice(s, e);
}

const fromNameBlock = extract('function apiSampleFromName', 'function apiSampleLeaf', 'apiSampleFromName');
const leafBlock     = extract('function apiSampleLeaf',     'function apiSampleValue', 'apiSampleLeaf');

// apiSampleLeaf ahora usa SchemaViewer para resolver el padre del nodo.
// El sandbox lo recibe como parámetro para poder poblarlo en los tests.
function makeSandbox(nodeList) {
    const SchemaViewer = { nodes: new Map((nodeList || []).map(n => [n.id, n])) };
    return new Function('SchemaViewer',
        `${fromNameBlock}\n${leafBlock}\nreturn { apiSampleFromName, apiSampleLeaf };`
    )(SchemaViewer);
}

// Sandbox vacío para pruebas que no necesitan contexto de padre
const { apiSampleFromName, apiSampleLeaf } = makeSandbox([]);

let failures = 0;
const expect = (label, actual, wanted) => {
    const ok = JSON.stringify(actual) === JSON.stringify(wanted);
    if (!ok) {
        failures++;
        console.log(`FAIL  ${label}`);
        console.log(`      esperado: ${JSON.stringify(wanted)}`);
        console.log(`      obtenido: ${JSON.stringify(actual)}`);
    } else {
        console.log(`PASS  ${label}`);
    }
};

// Helpers para construir nodos mínimos
const typeInfo = (overrides = {}) => Object.assign(
    { codes: [], jsonType: 'string', jsonFormat: '', datatypeName: '', pattern: '',
      minLength: null, maxLength: null, length: null, fractionDigits: null, totalDigits: null },
    overrides
);
const leafNode = (id, name, tag, dtypeOrOverrides = '') => ({
    id, name, tag, parentId: '',
    typeInfo: typeof dtypeOrOverrides === 'string'
        ? typeInfo({ datatypeName: dtypeOrOverrides })
        : typeInfo(dtypeOrOverrides),
});

// ── Datatypes ─────────────────────────────────────────────────────────────────
console.log('--- datatypes ---');
expect('IBAN (datatype)',       apiSampleFromName(leafNode('n','','','IBANIdentifier')),            'GB29NWBK60161331926819');
expect('BICFIIdentifier',       apiSampleFromName(leafNode('n','','','BICFIIdentifier')),           'BOFAGB22XXX');
expect('AnyBICIdentifier',      apiSampleFromName(leafNode('n','','','AnyBICIdentifier')),          'BOFAGB22XXX');
expect('LEIIdentifier',         apiSampleFromName(leafNode('n','','','LEIIdentifier')),             '5493001KJTIIGC8Y1R12');
expect('ActiveCurrencyCode',    apiSampleFromName(leafNode('n','','','ActiveCurrencyCode')),        'EUR');
expect('CurrencyCode',          apiSampleFromName(leafNode('n','','','CurrencyCode')),              'EUR');
expect('CountryCode',           apiSampleFromName(leafNode('n','','','CountryCode')),               'CO');
expect('UUIDv4Identifier',      apiSampleFromName(leafNode('n','','','UUIDv4Identifier')),          'a26e9a26-5e4a-4e5e-8c4e-2f4a9a0e5e4e');
expect('PhoneNumber (dtype)',    apiSampleFromName(leafNode('n','','','PhoneNumber')),              '+57 1 234 5678');
expect('EmailAddress (dtype)',   apiSampleFromName(leafNode('n','','','EmailAddress')),             'contacto@empresa.com');

// ── Nombres de campo exactos (sin contexto de padre) ──────────────────────────
console.log('\n--- nombres de campo sin contexto ---');
expect('MessageIdentification',     apiSampleFromName(leafNode('n','MessageIdentification','MsgId','')),      'MSGID-20240115-001');
expect('EndToEndIdentification',    apiSampleFromName(leafNode('n','EndToEndIdentification','EndToEndId','')), 'E2E-20240115-0001');
expect('TransactionIdentification', apiSampleFromName(leafNode('n','TransactionIdentification','TxId','')),   'TXN-20240115-0001');
expect('NumberOfTransactions',      apiSampleFromName(leafNode('n','NumberOfTransactions','NbOfTxs','')),     3);
expect('ControlSum',                apiSampleFromName(leafNode('n','ControlSum','CtrlSum','')),               3750.00);
expect('InstructedAmount',          apiSampleFromName(leafNode('n','InstructedAmount','InstdAmt','')),        1250.00);
expect('Currency',                  apiSampleFromName(leafNode('n','Currency','Ccy','')),                     'EUR');
expect('Country',                   apiSampleFromName(leafNode('n','Country','Ctry','')),                     'CO');
expect('TownName',                  apiSampleFromName(leafNode('n','TownName','TwnNm','')),                   'Bogotá');
expect('PostCode',                  apiSampleFromName(leafNode('n','PostCode','PstCd','')),                   '110111');
expect('Unstructured',              apiSampleFromName(leafNode('n','Unstructured','Ustrd','')),               'Pago factura 2024-001');
expect('IBAN (nombre)',              apiSampleFromName(leafNode('n','IBAN','IBAN','')),                        'GB29NWBK60161331926819');
expect('AnyBIC (nombre)',            apiSampleFromName(leafNode('n','AnyBIC','AnyBIC','')),                    'BOFAGB22XXX');
expect('LEI (nombre)',               apiSampleFromName(leafNode('n','LEI','LEI','')),                          '5493001KJTIIGC8Y1R12');

// ── Name / Nm: sensible al contexto del padre ─────────────────────────────────
console.log('\n--- Name/Nm sensible al contexto del padre ---');
expect('Name sin contexto → empresa genérica',
    apiSampleFromName(leafNode('n','Name','Nm',''), ''),                              'Empresa ABC S.A.S.');
expect('Name en BranchIdentification → sucursal',
    apiSampleFromName(leafNode('n','Name','Nm',''), 'BranchIdentification'),          'Sucursal Centro');
expect('Name en FinancialInstitutionIdentification → banco',
    apiSampleFromName(leafNode('n','Name','Nm',''), 'FinancialInstitutionIdentification'), 'Banco de Bogotá');
expect('Name en CreditorAgent (Agent) → banco corresponsal',
    apiSampleFromName(leafNode('n','Name','Nm',''), 'CreditorAgent'),                 'Banco Corresponsal');
expect('Name en ContactDetails → persona',
    apiSampleFromName(leafNode('n','Name','Nm',''), 'ContactDetails'),                'Juan Pérez');
expect('Name en SchemeName (Scheme) → SWIFT',
    apiSampleFromName(leafNode('n','Name','Nm',''), 'SchemeName'),                    'SWIFT');
expect('Nm (tag) en Branch → sucursal',
    apiSampleFromName(leafNode('n','','Nm',''), 'BranchIdentification'),              'Sucursal Centro');

// ── ShortName: también sensible al contexto ───────────────────────────────────
console.log('\n--- ShortName sensible al contexto ---');
expect('ShortName sin contexto → ABC',
    apiSampleFromName(leafNode('n','ShortName','ShrtNm',''), ''),                     'ABC');
expect('ShortName en Branch → sigla de sucursal',
    apiSampleFromName(leafNode('n','ShortName','ShrtNm',''), 'BranchIdentification'), 'SCE');
expect('ShortName en FinancialInstitution → sigla banco',
    apiSampleFromName(leafNode('n','ShortName','ShrtNm',''), 'FinancialInstitutionIdentification'), 'BDEB');

// ── Identification / Id: sensible al contexto del padre ───────────────────────
console.log('\n--- Identification/Id sensible al contexto del padre ---');
expect('Identification sin contexto → ID genérico',
    apiSampleFromName(leafNode('n','Identification','Id',''), ''),                    'ID-20240115-001');
expect('Identification en BranchIdentification → código sucursal',
    apiSampleFromName(leafNode('n','Identification','Id',''), 'BranchIdentification'),'SUC-001');
expect('Identification en AccountIdentification → cuenta',
    apiSampleFromName(leafNode('n','Identification','Id',''), 'AccountIdentification'),'ACC-20240115-001');
expect('Identification en FinancialInstitutionIdentification → BIC',
    apiSampleFromName(leafNode('n','Identification','Id',''), 'FinancialInstitutionIdentification'), 'BOFAGB22XXX');
expect('Identification en SchemeName → IBAN (tipo de esquema)',
    apiSampleFromName(leafNode('n','Identification','Id',''), 'SchemeName'),          'IBAN');
expect('Id (tag) en Branch → SUC-001',
    apiSampleFromName(leafNode('n','','Id',''), 'BranchIdentification'),              'SUC-001');

// ── Fallback XML tag (sin contexto de padre) ───────────────────────────────────
console.log('\n--- fallback por tag XML ---');
expect('tag MsgId',      apiSampleFromName(leafNode('n','','MsgId','')),      'MSGID-20240115-001');
expect('tag UETR',       apiSampleFromName(leafNode('n','','UETR','')),       'a26e9a26-5e4a-4e5e-8c4e-2f4a9a0e5e4e');
expect('tag Ccy',        apiSampleFromName(leafNode('n','','Ccy','')),        'EUR');
expect('tag Ctry',       apiSampleFromName(leafNode('n','','Ctry','')),       'CO');
expect('tag NbOfTxs',    apiSampleFromName(leafNode('n','','NbOfTxs','')),    3);
expect('tag CtrlSum',    apiSampleFromName(leafNode('n','','CtrlSum','')),    3750.00);

// ── Campos sin coincidencia → null ────────────────────────────────────────────
console.log('\n--- campo desconocido → null ---');
expect('campo genérico sin nombre ni datatype', apiSampleFromName(leafNode('n','','','')), null);
expect('campo con nombre no catalogado',        apiSampleFromName(leafNode('n','SomeOtherField','SoF','Max35Text')), null);

// ── apiSampleLeaf: CodeSet tiene prioridad ─────────────────────────────────────
console.log('\n--- apiSampleLeaf: CodeSet tiene prioridad ---');
{
    const node = leafNode('n','Currency','Ccy', { codes: [{ code: 'USD' }], jsonType: 'string', jsonFormat: '', datatypeName: '' });
    expect('CodeSet gana sobre nombre/dtype', apiSampleLeaf(node), 'USD');
}

// ── apiSampleLeaf: resuelve contexto via SchemaViewer ─────────────────────────
console.log('\n--- apiSampleLeaf: resuelve contexto via SchemaViewer ---');
{
    const parent = { id: 'p1', name: 'BranchIdentification' };
    const child  = leafNode('c1', 'Name', 'Nm', '');
    child.parentId = 'p1';
    const { apiSampleLeaf: sl } = makeSandbox([parent, child]);
    expect('Name con padre BranchIdentification → Sucursal Centro', sl(child), 'Sucursal Centro');
}
{
    const parent = { id: 'p2', name: 'FinancialInstitutionIdentification' };
    const child  = leafNode('c2', 'Name', 'Nm', '');
    child.parentId = 'p2';
    const { apiSampleLeaf: sl } = makeSandbox([parent, child]);
    expect('Name con padre FinancialInstitutionIdentification → Banco de Bogotá', sl(child), 'Banco de Bogotá');
}
{
    const parent = { id: 'p3', name: 'BranchIdentification' };
    const child  = leafNode('c3', 'Identification', 'Id', '');
    child.parentId = 'p3';
    const { apiSampleLeaf: sl } = makeSandbox([parent, child]);
    expect('Identification con padre BranchIdentification → SUC-001', sl(child), 'SUC-001');
}

// ── apiSampleLeaf: nombre/dtype gana sobre fallback genérico ───────────────────
console.log('\n--- apiSampleLeaf: nombre/dtype gana sobre fallback genérico ---');
{
    const node = leafNode('n','MessageIdentification','MsgId','Max35Text');
    expect('MessageIdentification → MSGID-…', apiSampleLeaf(node), 'MSGID-20240115-001');
}

// ── apiSampleLeaf: fallbacks genéricos cuando no hay coincidencia ─────────────
console.log('\n--- apiSampleLeaf: fallbacks genéricos ---');
expect('date-time', apiSampleLeaf(leafNode('n','','',{ jsonFormat: 'date-time', jsonType: 'string', codes: [], datatypeName: '' })), '2024-01-15T09:30:00Z');
expect('date',      apiSampleLeaf(leafNode('n','','',{ jsonFormat: 'date',      jsonType: 'string', codes: [], datatypeName: '' })), '2024-01-15');
expect('time',      apiSampleLeaf(leafNode('n','','',{ jsonFormat: 'time',      jsonType: 'string', codes: [], datatypeName: '' })), '09:30:00');
expect('number',    apiSampleLeaf(leafNode('n','','',{ jsonType: 'number',      jsonFormat: '',     codes: [], datatypeName: '' })), 0);
expect('boolean',   apiSampleLeaf(leafNode('n','','',{ jsonType: 'boolean',     jsonFormat: '',     codes: [], datatypeName: '' })), true);
expect('datatypeName sin match', apiSampleLeaf(leafNode('n','','','Max35Text')), '<Max35Text>');
expect('sin nada',  apiSampleLeaf(leafNode('n','','','')), 'string');

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de apiSampleFromName / apiSampleLeaf pasaron');
process.exit(failures ? 1 : 0);
