// check-api-sample.js
//
// Verifica que apiSampleFromName devuelva ejemplos contextuales según el
// nombre del campo, el tag XML y el datatype ISO 20022, y que apiSampleLeaf
// los use correctamente, sin romper el fallback a CodeSets ni a los tipos
// genéricos.

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

const { apiSampleFromName, apiSampleLeaf } = new Function(
    `${fromNameBlock}\n${leafBlock}\nreturn { apiSampleFromName, apiSampleLeaf };`
)();

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
const leafNode = (name, tag, dtypeOrOverrides = '') => ({
    name, tag,
    typeInfo: typeof dtypeOrOverrides === 'string'
        ? typeInfo({ datatypeName: dtypeOrOverrides })
        : typeInfo(dtypeOrOverrides),
});

// ── Datatypes ─────────────────────────────────────────────────────────────────
console.log('--- datatypes ---');
expect('IBAN (datatype)',       apiSampleFromName(leafNode('', '', 'IBANIdentifier')),            'GB29NWBK60161331926819');
expect('BICFIIdentifier',       apiSampleFromName(leafNode('', '', 'BICFIIdentifier')),           'BOFAGB22XXX');
expect('AnyBICIdentifier',      apiSampleFromName(leafNode('', '', 'AnyBICIdentifier')),          'BOFAGB22XXX');
expect('LEIIdentifier',         apiSampleFromName(leafNode('', '', 'LEIIdentifier')),             '5493001KJTIIGC8Y1R12');
expect('ActiveCurrencyCode',    apiSampleFromName(leafNode('', '', 'ActiveCurrencyCode')),        'EUR');
expect('CurrencyCode',          apiSampleFromName(leafNode('', '', 'CurrencyCode')),              'EUR');
expect('CountryCode',           apiSampleFromName(leafNode('', '', 'CountryCode')),               'CO');
expect('UUIDv4Identifier',      apiSampleFromName(leafNode('', '', 'UUIDv4Identifier')),          'a26e9a26-5e4a-4e5e-8c4e-2f4a9a0e5e4e');
expect('PhoneNumber (dtype)',    apiSampleFromName(leafNode('', '', 'PhoneNumber')),              '+57 1 234 5678');
expect('EmailAddress (dtype)',   apiSampleFromName(leafNode('', '', 'EmailAddress')),             'contacto@empresa.com');

// ── Nombres de campo exactos ───────────────────────────────────────────────────
console.log('\n--- nombres de campo ---');
expect('MessageIdentification',      apiSampleFromName(leafNode('MessageIdentification', 'MsgId', '')),      'MSGID-20240115-001');
expect('EndToEndIdentification',     apiSampleFromName(leafNode('EndToEndIdentification', 'EndToEndId', '')), 'E2E-20240115-0001');
expect('TransactionIdentification',  apiSampleFromName(leafNode('TransactionIdentification', 'TxId', '')),   'TXN-20240115-0001');
expect('NumberOfTransactions',       apiSampleFromName(leafNode('NumberOfTransactions', 'NbOfTxs', '')),     3);
expect('ControlSum',                 apiSampleFromName(leafNode('ControlSum', 'CtrlSum', '')),               3750.00);
expect('InstructedAmount',           apiSampleFromName(leafNode('InstructedAmount', 'InstdAmt', '')),        1250.00);
expect('Name (tag Nm)',               apiSampleFromName(leafNode('Name', 'Nm', '')),                          'Empresa ABC S.A.S.');
expect('Currency',                   apiSampleFromName(leafNode('Currency', 'Ccy', '')),                      'EUR');
expect('Country',                    apiSampleFromName(leafNode('Country', 'Ctry', '')),                      'CO');
expect('TownName',                   apiSampleFromName(leafNode('TownName', 'TwnNm', '')),                    'Bogotá');
expect('PostCode',                   apiSampleFromName(leafNode('PostCode', 'PstCd', '')),                    '110111');
expect('Unstructured',               apiSampleFromName(leafNode('Unstructured', 'Ustrd', '')),                'Pago factura 2024-001');
expect('IBAN (nombre)',               apiSampleFromName(leafNode('IBAN', 'IBAN', '')),                         'GB29NWBK60161331926819');
expect('AnyBIC (nombre)',             apiSampleFromName(leafNode('AnyBIC', 'AnyBIC', '')),                     'BOFAGB22XXX');
expect('LEI (nombre)',                apiSampleFromName(leafNode('LEI', 'LEI', '')),                           '5493001KJTIIGC8Y1R12');

// ── Fallback XML tag ───────────────────────────────────────────────────────────
console.log('\n--- fallback por tag XML ---');
expect('tag MsgId',      apiSampleFromName(leafNode('', 'MsgId', '')),      'MSGID-20240115-001');
expect('tag UETR',       apiSampleFromName(leafNode('', 'UETR', '')),       'a26e9a26-5e4a-4e5e-8c4e-2f4a9a0e5e4e');
expect('tag Ccy',        apiSampleFromName(leafNode('', 'Ccy', '')),        'EUR');
expect('tag Ctry',       apiSampleFromName(leafNode('', 'Ctry', '')),       'CO');
expect('tag NbOfTxs',    apiSampleFromName(leafNode('', 'NbOfTxs', '')),    3);
expect('tag CtrlSum',    apiSampleFromName(leafNode('', 'CtrlSum', '')),    3750.00);

// ── Campos sin coincidencia → null ────────────────────────────────────────────
console.log('\n--- campo desconocido → null ---');
expect('campo genérico sin nombre ni datatype', apiSampleFromName(leafNode('', '', '')), null);
expect('campo con nombre no catalogado',        apiSampleFromName(leafNode('SomeOtherField', 'SoF', 'Max35Text')), null);

// ── apiSampleLeaf: CodeSet tiene prioridad ─────────────────────────────────────
console.log('\n--- apiSampleLeaf: CodeSet tiene prioridad ---');
{
    const node = leafNode('Currency', 'Ccy', { codes: [{ code: 'USD' }], jsonType: 'string', jsonFormat: '', datatypeName: '' });
    expect('CodeSet gana sobre nombre/dtype', apiSampleLeaf(node), 'USD');
}

// ── apiSampleLeaf: named tiene prioridad sobre fallback genérico ───────────────
console.log('\n--- apiSampleLeaf: nombre/dtype gana sobre fallback genérico ---');
{
    const node = leafNode('MessageIdentification', 'MsgId', 'Max35Text');
    expect('MessageIdentification → MSGID-…', apiSampleLeaf(node), 'MSGID-20240115-001');
}

// ── apiSampleLeaf: fallbacks genéricos cuando no hay coincidencia ─────────────
console.log('\n--- apiSampleLeaf: fallbacks genéricos ---');
expect('date-time', apiSampleLeaf(leafNode('', '', { jsonFormat: 'date-time', jsonType: 'string', codes: [], datatypeName: '' })), '2024-01-15T09:30:00Z');
expect('date',      apiSampleLeaf(leafNode('', '', { jsonFormat: 'date',      jsonType: 'string', codes: [], datatypeName: '' })), '2024-01-15');
expect('time',      apiSampleLeaf(leafNode('', '', { jsonFormat: 'time',      jsonType: 'string', codes: [], datatypeName: '' })), '09:30:00');
expect('number',    apiSampleLeaf(leafNode('', '', { jsonType: 'number',      jsonFormat: '',     codes: [], datatypeName: '' })), 0);
expect('boolean',   apiSampleLeaf(leafNode('', '', { jsonType: 'boolean',     jsonFormat: '',     codes: [], datatypeName: '' })), true);
expect('datatypeName sin match', apiSampleLeaf(leafNode('', '', 'Max35Text')), '<Max35Text>');
expect('sin nada',  apiSampleLeaf(leafNode('', '', '')), 'string');

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de apiSampleFromName / apiSampleLeaf pasaron');
process.exit(failures ? 1 : 0);
