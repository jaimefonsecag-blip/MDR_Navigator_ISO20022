// Reported: in "Cómo funciona el flujo" some steps showed "sin indicar" for the
// counterpart even though the sentence names it plainly ("... sends a PriceReport
// message to the report user."). The cause was that "user" was missing from the
// generic head-noun list that turns a phrase like "the report user" into a
// recognised actor — the same class of gap recurs with any other MDR whose flow
// is built around a role noun this list did not yet cover. This check exercises
// the exact reported sentences plus a few synthetic "other domain" cases.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

const flowBlock = script.slice(
    script.indexOf('// ===== Flow explanation ====='),
    script.indexOf('function part1BlockHtml'));
if (flowBlock.length < 100) {
    console.error('No se encontro el bloque de reconstruccion de flujo en index.html');
    process.exit(1);
}

const PART1 = { roles: [] };
const api = new Function('PART1', 'escapeHtml', `${flowBlock}
return { part1BuildFlow, part1FindActors, part1StepFromSentence, part1CompleteHops };`)(
    PART1, String);

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

const section = (...sentences) => ({ blocks: sentences.map(text => ({ kind: 'text', text })) });

console.log('--- caso reportado: Investment Funds price reporting ---');
const reported = section(
    'A report provider sends a PriceReport message to the report user.',
    "Subsequently, the report provider cancels one the prices in the previously sent PriceReport by sending a Price Report Cancellation message (CompletePriceCancellation is 'false' or '0')."
);
const reportedFlow = api.part1BuildFlow(reported);
expect('se reconstruyen los dos pasos', reportedFlow ? reportedFlow.steps.length : 0, 2);
expect('paso 1: identifica al report user como destino directamente en la frase',
    reportedFlow && reportedFlow.steps[0].to, 'Report User');
expect('paso 1: el destino no queda marcado como inferido (la frase lo dice)',
    Boolean(reportedFlow && reportedFlow.steps[0].inferredTo), false);
expect('paso 2: sin "to" en la frase, se completa por ser la unica contraparte posible',
    reportedFlow && reportedFlow.steps[1].to, 'Report User');
expect('paso 2: ese destino si queda marcado como inferido',
    Boolean(reportedFlow && reportedFlow.steps[1].inferredTo), true);
expect('ningun paso queda "sin indicar" en este caso',
    reportedFlow ? reportedFlow.steps.every(step => step.from && step.to) : false, true);

console.log('\n--- otros dominios: sustantivos genericos de contraparte ---');
[
    ['the loan servicer sends a LoanNotification message to the loan borrower.', 'Loan Borrower'],
    ['the card issuer sends a SettlementReport message to the online merchant.', 'Online Merchant'],
    ['the insurer sends a ClaimNotification message to the applicant.', 'Applicant'],
    ['the account servicer sends a StatementReport message to the account holder.', 'Account Holder'],
    ['the lender sends a LoanNotification message to the loan guarantor.', 'Loan Guarantor']
].forEach(([sentence, expectedTo]) => {
    const step = api.part1StepFromSentence(sentence);
    expect(`reconoce "${expectedTo}" como destino en "${sentence.slice(0, 40)}..."`,
        step && step.to, expectedTo);
});

console.log('\n--- alias del mismo actor en distintas frases (Transferor / Old Plan Manager) ---');
// Reported separately: "The transferor replies with a TransferCancellationStatus
// Report..." kept showing "sin indicar" even though earlier steps of the same
// flow clearly show who it replies to — because the document also calls that
// same party "Old Plan Manager" elsewhere, the flow ends up naming more than
// two distinct strings and the old "exactly two actors" rule gave up.
const aliasFlow = section(
    'The instructing party sends a PortfolioTransferInstruction message to the transferor.',
    'The instructing party sends a PortfolioTransferCancellationRequest message to the transferor.',
    'The transferor replies with a TransferCancellationStatusReport message with the appropriate status, for example, Accepted (PACK).',
    'The old plan manager sends a PortfolioTransferRejection message.'
);
const aliasResult = api.part1BuildFlow(aliasFlow);
expect('se reconstruyen los cuatro pasos', aliasResult ? aliasResult.steps.length : 0, 4);
expect('paso 3: "transferor" sin destino se completa pidiendole prestado el otro extremo a un paso ya resuelto',
    aliasResult && aliasResult.steps[2].to, 'Instructing Party');
expect('paso 3: ese destino queda marcado como inferido', Boolean(aliasResult && aliasResult.steps[2].inferredTo), true);
expect('paso 4: un tercer alias sin ninguna pareja resuelta que lo respalde no se inventa un destino',
    aliasResult && aliasResult.steps[3].to, '');

console.log('\n--- no adivina cuando dos pasos resueltos no estan de acuerdo ---');
// If different fully-named steps disagree on who "transferor" talks to, that is
// a genuine ambiguity in the document — guessing one of them would be worse
// than leaving it unindicated.
const conflictFlow = section(
    'The instructing party sends a PortfolioTransferInstruction message to the transferor.',
    'The custodian sends a PortfolioTransferInstruction message to the transferor.',
    'The transferor replies with a TransferCancellationStatusReport message with the appropriate status, for example, Accepted (PACK).'
);
const conflictResult = api.part1BuildFlow(conflictFlow);
expect('paso 3: sin un unico candidato consistente, sigue sin destino',
    conflictResult && conflictResult.steps[2].to, '');

console.log('\n--- no se vuelve mas permisivo de mas ---');
// A bare "the user" (no qualifying word) stays too vague to name an actor, the
// same way "the party" or "the agent" already did before this fix.
expect('"the user" solo (sin calificador) sigue sin reconocerse como actor',
    api.part1FindActors('The user must confirm the request.').some(a => a.name === 'user'), false);
expect('"the same party" sigue descartado por vago',
    api.part1FindActors('The instruction is copied to the same party.').some(a => /same/.test(a.name)), false);

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de contrapartes del flujo pasaron');
process.exit(failures ? 1 : 0);
