// Verifies the ISO 20022 terminology layer without touching the network: the
// phrase dictionary, the Spanish-side glossary, identifier masking and the
// cosmetic polish are pure functions, so they are exercised directly.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

// Pull just the terminology block out of the page and evaluate it in isolation.
const start = script.indexOf('// ===== ISO 20022 DOMAIN TERMINOLOGY =====');
const end = script.indexOf('function chunkForTranslation');
if (start === -1 || end === -1) {
    console.error('terminology block not found in index.html');
    process.exit(1);
}
const block = script.slice(start, end);

const api = new Function(`${block}
return { lookupDomainPhrase, applyDomainGlossary, polishDomainSpanish,
         protectTechnicalTerms, restoreTechnicalTerms, hasTranslatableProse,
         MDR_PHRASE_DICTIONARY };`)();

const { lookupDomainPhrase, applyDomainGlossary, polishDomainSpanish,
    protectTechnicalTerms, restoreTechnicalTerms, hasTranslatableProse } = api;

let failures = 0;
function expect(label, actual, wanted) {
    const ok = actual === wanted;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) {
        console.log(`      esperado: ${wanted}`);
        console.log(`      obtenido: ${actual}`);
    }
}

// The full pipeline that translateText() applies to an engine response.
const post = text => polishDomainSpanish(applyDomainGlossary(text));

console.log('--- phrase dictionary (no network) ---');
expect('definición reportada por el usuario',
    lookupDomainPhrase('Unique identification of the party.'),
    'Identificación única de la parte.');
expect('sin punto final se respeta',
    lookupDomainPhrase('Unique identification of the party'),
    'Identificación única de la parte');
expect('frase desconocida no inventa traducción',
    lookupDomainPhrase('Some sentence the MDR never uses.'),
    '');

console.log('\n--- glosario: party mal traducido por el motor ---');
expect('del partido -> de la parte',
    post('Identificación única del partido.'),
    'Identificación única de la parte.');
expect('el partido -> la parte',
    post('El partido que debe el importe.'),
    'La parte que debe el importe.');
expect('los partidos -> las partes',
    post('Los partidos involucrados en la operación.'),
    'Las partes involucradas en la operación.');
expect('al partido -> a la parte',
    post('Importe pagado al partido.'),
    'Importe pagado a la parte.');
expect('fiesta -> parte',
    post('Nombre de la fiesta.'),
    'Nombre de la parte.');

console.log('\n--- glosario: securities y otros términos ---');
expect('las seguridades -> los valores',
    post('Cantidad de las seguridades entregadas.'),
    'Cantidad de los valores entregados.');
expect('cuenta de seguridad -> cuenta de valores',
    post('Identificación de la cuenta de seguridad.'),
    'Identificación de la cuenta de valores.');
expect('balance -> saldo',
    post('Balance de la cuenta al cierre.'),
    'Saldo de la cuenta al cierre.');
expect('tenedor -> titular',
    post('El tenedor de la cuenta.'),
    'El titular de la cuenta.');
expect('dia laborable -> dia habil',
    post('Debe liquidarse el siguiente día laborable.'),
    'Debe liquidarse el siguiente día hábil.');

console.log('\n--- protección de identificadores técnicos ---');
const sample = 'The <SctiesStmtQry> element contains MessageHeader9 typed as Max35Text for BIC.';
const masked = protectTechnicalTerms(sample);
expect('los identificadores salen del texto', /QQZ\d/.test(masked.masked), true);
expect('no queda el tag original en el texto enmascarado', masked.masked.includes('<SctiesStmtQry>'), false);
const restored = restoreTechnicalTerms(masked.masked, masked.tokens);
expect('restauración completa', restored.complete, true);
expect('restauración devuelve el original', restored.text, sample);
expect('placeholder perdido se detecta',
    restoreTechnicalTerms('texto sin marcadores', masked.tokens).complete, false);

console.log('\n--- pulido ---');
expect('quita espacio antes de puntuación', post('Importe de la cuenta .'), 'Importe de la cuenta.');
expect('capitaliza la primera letra', post('identificación de la parte.'), 'Identificación de la parte.');

// Reported case: the identifier column of Part 1 showed "Sem.002" once the view
// was translated, because the cell travelled to the engine as if it were prose.
console.log('\n--- identificadores ISO abreviados ---');
const idMask = protectTechnicalTerms('semt.002');
expect('semt.002 sale del texto enmascarado', idMask.masked, 'QQZ1');
expect('semt.002 vuelve intacto', restoreTechnicalTerms(idMask.masked, idMask.tokens).text, 'semt.002');
const inProse = protectTechnicalTerms('The SecuritiesStatementQuery message semt.021 is sent.');
expect('el identificador dentro de la prosa tambien se protege',
    /QQZ\d/.test(inProse.masked) && !inProse.masked.includes('semt.021'), true);
expect('la prosa con identificador se restaura completa',
    restoreTechnicalTerms(inProse.masked, inProse.tokens).text,
    'The SecuritiesStatementQuery message semt.021 is sent.');

console.log('\n--- lo que no tiene nada que traducir no se envia ---');
[
    ['semt.002', false],
    ['pacs.008.001.08', false],
    ['<Prtry>', false],
    ['Max35Text', false],
    ['BIC', false],
    ['acmt.001', false],
    ['C12', false],
    ['AccountOpeningInstruction', false],
    ['Unique identification of the party.', true],
    ['Party', true],
    ['Sent by the account owner to open an account.', true],
    ['The semt.021 message is sent by the account owner.', true]
].forEach(([text, wanted]) =>
    expect(`${wanted ? 'traduce' : 'omite  '} ${JSON.stringify(text)}`, hasTranslatableProse(text), wanted));

console.log(`\n${failures ? `${failures} prueba(s) fallida(s)` : 'todas las pruebas pasaron'}`);
process.exit(failures ? 1 : 0);
