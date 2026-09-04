// Runs the page's own DOCX parser against the real MDR Part 1 file, so a change
// to the style mapping or the section walk is caught here instead of in the
// browser. The parser only needs DOMParser + a zip reader, both stubbed below.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

const docx = join(root, 'ISO20022_MDRPart1_InvestmentFunds_2024_2025_v2.docx');
if (!existsSync(docx)) {
    console.log('SKIP: no hay DOCX de ejemplo en el workspace');
    process.exit(0);
}

// The extracted package is produced by the analysis step; fall back to skipping
// rather than failing the whole check suite when it is not present.
const extracted = join(process.env.TEMP || '/tmp', 'mdrpart1');
if (!existsSync(join(extracted, 'word', 'document.xml'))) {
    console.log('SKIP: falta el paquete extraido en TEMP (ejecuta la extraccion primero)');
    process.exit(0);
}

// Pull the parser functions out of the page and give them a DOM.
const start = script.indexOf('const PART1 = {');
const end = script.indexOf('async function loadPart1Docx');
if (start === -1 || end === -1) {
    console.error('No se encontro el bloque del parser DOCX en la pagina');
    process.exit(1);
}
const block = script.slice(start, end);

const { DOMParser } = await import('@xmldom/xmldom').catch(() => ({ DOMParser: null }));
if (!DOMParser) {
    console.log('SKIP: falta @xmldom/xmldom (npm i -D @xmldom/xmldom) para parsear fuera del navegador');
    process.exit(0);
}

// yieldToBrowser() lives with the UI helpers, outside the extracted block.
const api = new Function('DOMParser', 'escapeHtml', 'yieldToBrowser', `${block}
return { PART1, docxBuildSections, docxNumberSections, docxBuildTree, docxExtractRoles,
         docxStyleOf, docxHeadingLevel, DOCX_NS_W, DOCX_STYLE_KINDS };`)(
    DOMParser, String, () => Promise.resolve());

// The flow analysis lives with the reader, further down the page.
const flowBlock = script.slice(
    script.indexOf('// ===== Flow explanation ====='),
    script.indexOf('function part1BlockHtml'));
const flowApi = new Function('PART1', 'escapeHtml', `${flowBlock}
return { part1BuildFlow, part1FindActors, part1ActorVocabulary, part1RoleDefinition,
         part1FlowFromProse, part1StepFromSentence };`)(
    api.PART1, String);

// The request/response tagging of MessageDefinition tables.
const roleBlock = script.slice(
    script.indexOf('// ===== Message role ====='),
    script.indexOf('function togglePart1Sample'));
const roleApi = new Function('escapeHtml', 'normalizeBlockSearch', 'part1TextHtml', `${roleBlock}
return { mdrMessageRole, mdrMessageKey, mdrMessageRoleTagHtml,
         part1MessageNameColumn, part1TableHtml };`)(
    String, value => String(value || '').toLowerCase().trim(), String);

// The notes that explain a category of the standard ("Instruction Messages") live
// with the section renderer.
const conceptBlock = script.slice(
    script.indexOf('// ===== Concept notes ====='),
    script.indexOf('function openPart1Section'));
const conceptApi = new Function('escapeHtml', 'normalizeBlockSearch', `${conceptBlock}
return { part1ConceptNote, part1ConceptNoteHtml, P1_CONCEPT_NOTES };`)(
    String, value => String(value || '').toLowerCase().trim());

const documentXml = readFileSync(join(extracted, 'word', 'document.xml'), 'utf8');
const parsed = new DOMParser().parseFromString(documentXml, 'text/xml');
const body = parsed.getElementsByTagNameNS(api.DOCX_NS_W, 'body')[0];
if (!body) { console.error('No se encontro <w:body>'); process.exit(1); }

// Fake image map: every relId resolves, so diagram blocks are produced.
const images = { get: id => ({ url: `blob:${id}`, target: `media/${id}.png` }) };

const sections = await api.docxBuildSections(body, images);
api.docxNumberSections(sections);
const tree = api.docxBuildTree(sections);
const roles = api.docxExtractRoles(sections);

const count = kind => sections.reduce((sum, s) => sum + s.blocks.filter(b => b.kind === kind).length, 0);
const totals = {
    sections: sections.length,
    text: count('text'), bullet: count('bullet'), caption: count('caption'),
    diagram: count('diagram'), xml: count('xml'), table: count('table'),
    roots: tree.length, roles: roles.length
};
console.log('=== salida del parser ===');
Object.entries(totals).forEach(([key, value]) => console.log(`  ${key.padEnd(10)} ${value}`));

let failures = 0;
const expect = (label, ok, detail) => {
    if (!ok) { failures++; console.log(`FAIL  ${label}${detail ? ` -> ${detail}` : ''}`); }
    else console.log(`PASS  ${label}`);
};

// Grounded in the real document: 348 headings, 143 PNG refs, 66 tables.
expect('encuentra secciones (>300)', sections.length > 300, sections.length);
expect('encuentra diagramas (>=140)', totals.diagram >= 140, totals.diagram);
expect('encuentra tablas (>=60)', totals.table >= 60, totals.table);
expect('agrupa ejemplos XML en bloques, no por linea', totals.xml > 0 && totals.xml < 3000, totals.xml);
expect('produce prosa de negocio', totals.text > 400, totals.text);
expect('extrae los BusinessRoles', roles.length >= 5, roles.length);
expect('el arbol tiene raices de nivel 1', tree.length > 0 && tree.every(s => s.level === 1), tree.length);
expect('descarta el indice propio del documento (TOC)',
    !sections.some(s => /^toc/i.test(s.title)), 'hay secciones TOC');
expect('numera las secciones', sections.slice(1, 30).every(s => /^\d/.test(s.number)));
expect('ninguna seccion sin titulo', sections.every(s => s.title && s.title.trim().length > 0));

const known = ['Introduction', 'Scope and Functionality', 'BusinessRoles and Participants',
    'BusinessProcess Description', 'BusinessTransactions'];
known.forEach(title => expect(`contiene la seccion "${title}"`,
    sections.some(s => s.title.trim() === title)));

// ===== actors =====
console.log('\n=== actores ===');
expect('los actores traen definicion real, no marcas "X"',
    roles.length >= 14 && roles.every(r => r.definition.length > 12 && !/^x$/i.test(r.definition)),
    `${roles.length} actores`);
expect('distingue participantes de roles de negocio',
    new Set(roles.map(r => r.group)).size === 2,
    [...new Set(roles.map(r => r.group))].join('|'));
['Instructing Party', 'Executing Party', 'Intermediary', 'Custodian', 'Fund Manager']
    .forEach(name => expect(`define "${name}"`, roles.some(r => r.name === name)));

// ===== flow analysis =====
console.log('\n=== analisis de flujo ===');
// The flow helpers read the actor vocabulary from the shared PART1 store.
api.PART1.roles = roles;
api.PART1.__actorVocab = null;

const byTitle = (number) => sections.find(s => s.number === number);

// chapter 6: Step / Description / Initiator table.
const accountMod = byTitle('6.1.2');
const tableFlow = accountMod ? flowApi.part1BuildFlow(accountMod) : null;
expect('6.1.2 Account Modification produce un flujo', Boolean(tableFlow));
if (tableFlow) {
    expect('  origen: tabla de pasos', tableFlow.source === 'table', tableFlow.source);
    expect('  4 pasos', tableFlow.steps.length === 4, tableFlow.steps.length);
    expect('  cada paso tiene titulo y descripcion',
        tableFlow.steps.every(s => s.title && s.description));
    expect('  separa "Executing Party / Registering Party" en dos actores',
        tableFlow.steps.some(s => s.actors.length === 2), JSON.stringify(tableFlow.steps.map(s => s.actors)));
    expect('  lista participantes con sus pasos',
        tableFlow.participants.length >= 3 && tableFlow.participants.every(p => p.steps.length > 0),
        tableFlow.participants.map(p => `${p.name}:${p.steps.join('/')}`).join(' '));
    expect('  Instructing Party trae definicion del MDR',
        Boolean((tableFlow.participants.find(p => /instructing/i.test(p.name)) || {}).definition));
    console.log('      ' + tableFlow.participants.map(p => `${p.name} [${p.steps.join(',')}]`).join('  |  '));
}

// chapter 7: prose "A sends a X message to B".
const direct = sections.find(s => s.number === '7.1.1.1');
const proseFlow = direct ? flowApi.part1BuildFlow(direct) : null;
expect('7.1.1.1 Direct produce un flujo', Boolean(proseFlow));
if (proseFlow) {
    expect('  origen: prosa', proseFlow.source === 'prose', proseFlow.source);
    expect('  3 intercambios', proseFlow.steps.length === 3, proseFlow.steps.length);
    expect('  todo paso identifica al emisor',
        proseFlow.steps.every(s => s.from), proseFlow.steps.map(s => s.from).join(' | '));
    // Not every sentence names a receiver ("may send X ... in response to Y"),
    // so one is never invented: the arrow is simply left open.
    expect('  cuando hay receptor, es distinto del emisor',
        proseFlow.steps.every(s => !s.to || s.to !== s.from),
        proseFlow.steps.map(s => `${s.from}->${s.to || '(sin receptor)'}`).join(' | '));
    expect('  la mayoria de pasos nombra receptor',
        proseFlow.steps.filter(s => s.to).length >= 2,
        `${proseFlow.steps.filter(s => s.to).length}/${proseFlow.steps.length}`);
    expect('  captura el nombre del mensaje',
        proseFlow.steps.every(s => /^[A-Z][A-Za-z]+$/.test(s.message)),
        proseFlow.steps.map(s => s.message).join(' '));
    expect('  receptor completo, no truncado ("Account Servicer")',
        proseFlow.steps.some(s => /account servicer/i.test(s.to)),
        proseFlow.steps.map(s => s.to).join(' | '));
    proseFlow.steps.forEach(s => console.log(`      ${s.number}. ${s.from} --${s.message}--> ${s.to}`));
}

// Coverage across the whole document.
const flows = sections.map(s => flowApi.part1BuildFlow(s)).filter(Boolean);
console.log(`\n  secciones con flujo reconstruido: ${flows.length}`);
expect('reconstruye flujos en buena parte del documento', flows.length >= 150, flows.length);
expect('ningun flujo sin participantes', flows.every(f => f.participants.length > 0));
expect('ningun paso con numero repetido',
    flows.every(f => new Set(f.steps.map(s => s.number)).size === f.steps.length));

const proseSteps = flows.filter(f => f.source === 'prose').flatMap(f => f.steps);
const complete = proseSteps.filter(s => s.from && s.to).length;
console.log(`  pasos de prosa completos: ${complete}/${proseSteps.length}`);
expect('la gran mayoria de los pasos nombra ambos extremos del salto',
    complete / proseSteps.length >= 0.85, `${complete}/${proseSteps.length}`);
// A determiner inside the name means a sentence fragment was taken for an actor.
const badActor = flows.flatMap(f => f.participants.map(p => p.name))
    .find(name => /\b(?:the|an|a|this|that|which|is|are|be|same|other)\b/i.test(name));
expect('ningun actor inventado a partir de un fragmento de frase', !badActor, badActor);

// ===== other domains: the actors are read from the document, not from a list =====
// Reported case: Payments Part 1, "PaymentReturn Initiated by Debtor Agent". None
// of these actors exists in the Investment Funds vocabulary loaded above.
console.log('\n=== flujo de un dominio distinto (Payments) ===');
const payments = { blocks: [
    { kind: 'text', text: 'The Debtor Agent sends a PaymentReturn message to the Clearing and Settlement Agent.' },
    { kind: 'text', text: 'The Clearing and Settlement Agent sends the PaymentReturn message to the Creditor Agent. The Creditor Agent then sends a PaymentReturn message to the Creditor.' },
    { kind: 'bullet', text: 'The Forwarding Agent forwards the FIToFICustomerCreditTransfer message to the Intermediary Agent.' },
    { kind: 'text', text: 'A PaymentStatusReport message is sent by the Instructed Agent to the Instructing Agent.' },
    { kind: 'text', text: 'The Creditor Agent receives the CustomerCreditTransferInitiation message from the Initiating Party.' },
    { kind: 'text', text: 'This message is exchanged as part of the business process.' }
] };
const paymentFlow = flowApi.part1FlowFromProse(payments);
expect('reconstruye el flujo de Payments', Boolean(paymentFlow));
if (paymentFlow) {
    (paymentFlow.steps || []).forEach(s =>
        console.log(`      ${s.number}. ${s.from || '(sin emisor)'} --${s.message}--> ${s.to || '(SIN RECEPTOR)'}`));
    expect('  6 intercambios, uno por frase con mensaje',
        paymentFlow.steps.length === 6, paymentFlow.steps.length);
    expect('  ningun extremo del salto queda vacio',
        paymentFlow.steps.every(s => s.from && s.to),
        paymentFlow.steps.filter(s => !s.from || !s.to).map(s => s.description).join(' // '));
    expect('  receptor multipalabra completo ("Clearing and Settlement Agent")',
        paymentFlow.steps[0].to === 'Clearing and Settlement Agent', paymentFlow.steps[0].to);
    expect('  el mismo actor multipalabra tambien se detecta como emisor',
        paymentFlow.steps[1].from === 'Clearing and Settlement Agent', paymentFlow.steps[1].from);
    expect('  "Forwarding Agent" no se confunde con el verbo',
        paymentFlow.steps[3].from === 'Forwarding Agent', paymentFlow.steps[3].from);
    expect('  entiende la voz pasiva ("is sent by ... to ...")',
        paymentFlow.steps[4].from === 'Instructed Agent' && paymentFlow.steps[4].to === 'Instructing Agent',
        `${paymentFlow.steps[4].from} -> ${paymentFlow.steps[4].to}`);
    expect('  invierte el salto cuando la frase usa "receives ... from"',
        paymentFlow.steps[5].from === 'Initiating Party' && paymentFlow.steps[5].to === 'Creditor Agent',
        `${paymentFlow.steps[5].from} -> ${paymentFlow.steps[5].to}`);
}
expect('una frase sin intercambio no produce paso',
    flowApi.part1StepFromSentence('This message is exchanged as part of the business process.') === null);
// Some MDRs write the participants in lower case inside the prose.
const lowerCaseStep = flowApi.part1StepFromSentence(
    'The debtor agent sends a PaymentReturn message to the clearing and settlement agent.');
expect('detecta actores escritos en minusculas',
    lowerCaseStep && lowerCaseStep.from === 'Debtor Agent'
        && lowerCaseStep.to === 'Clearing and Settlement Agent',
    lowerCaseStep ? `${lowerCaseStep.from} -> ${lowerCaseStep.to}` : 'sin paso');
expect('no toma "the same party" como actor',
    !flowApi.part1FindActors('The instruction is copied to the same party.').some(a => /same/.test(a.name)),
    JSON.stringify(flowApi.part1FindActors('The instruction is copied to the same party.')));

// ===== explanation of the categories of the standard =====
console.log('\n=== notas de concepto ===');
const noteFor = title => conceptApi.part1ConceptNote({ title });
['Instruction Messages', 'Instruction Message', 'Related Messages'].forEach(title =>
    expect(`explica "${title}"`, Boolean(noteFor(title))));
// The real document numbers Related Messages as 3.3.3, so the match cannot depend
// on the section number.
const relatedSection = sections.find(s => s.title.trim() === 'Related Messages');
expect('encuentra "Related Messages" en el documento real', Boolean(relatedSection),
    relatedSection ? relatedSection.number : 'no esta');
expect('la nota se asocia por titulo, no por numeracion',
    Boolean(relatedSection && conceptApi.part1ConceptNote(relatedSection)));
expect('una seccion de negocio normal no recibe nota',
    !conceptApi.part1ConceptNote({ title: 'Direct' })
    && !conceptApi.part1ConceptNote({ title: 'BusinessTransactions' }));
expect('cada nota trae titulo, resumen, entradilla y puntos',
    conceptApi.P1_CONCEPT_NOTES.every(note =>
        note.title && note.short && note.lead && note.points && note.points.length >= 2));
const noteHtml = conceptApi.part1ConceptNoteHtml({ title: 'Instruction Messages' });
expect('el HTML de la nota advierte que no es texto del MDR',
    /no forma parte del texto del MDR/.test(noteHtml));
// The notes are already written in Spanish, so they must not enter the translator.
expect('la nota no usa las clases que traduce el motor EN->ES',
    !/scope-usage-text|p1-text|p1-caption|p1-role-def|definition-text/.test(noteHtml),
    noteHtml.slice(0, 200));

// ===== request / response of each MessageDefinition =====
console.log('\n=== rol de los MessageDefinitions ===');
const roleOf = name => (roleApi.mdrMessageRole(name) || {}).kind || null;
const roleCases = [
    // Investment Funds
    ['AccountOpeningInstruction', 'request'],
    ['SubscriptionOrder', 'request'],
    ['SecuritiesStatementQuery', 'request'],
    ['TransferInCancellationRequest', 'request'],
    ['RequestForOrderStatusReport', 'request'],
    ['AccountDetailsConfirmation', 'response'],
    ['AccountManagementStatusReport', 'response'],
    ['SecuritiesRejectionMessage', 'response'],
    ['PriceReport', 'report'],
    ['AccountingStatementOfHoldings', 'report'],
    // Cash Management names the verb first, and the tail of the name means nothing
    // there: "ReturnStandingOrder" answers a Get, it does not place an order.
    ['GetLimit', 'request'],
    ['ReturnLimit', 'response'],
    ['GetStandingOrder', 'request'],
    ['ReturnStandingOrder', 'response'],
    ['ModifyStandingOrder', 'request'],
    ['DeleteReservation', 'request'],
    ['CreateMember', 'request'],
    ['CancelTransaction', 'request'],
    ['GetBusinessDayInformation', 'request'],
    ['ReturnBusinessDayInformation', 'response'],
    ['LiquidityCreditTransfer', 'request'],
    ['LiquidityDebitTransfer', 'request'],
    ['BackupPayment', 'request'],
    ['Receipt', 'response'],
    // Payments: the domain the tagging was asked for
    ['CustomerCreditTransferInitiation', 'request'],
    ['FIToFICustomerCreditTransfer', 'request'],
    ['FIToFICustomerDirectDebit', 'request'],
    ['PaymentReturn', 'request'],
    ['FIToFIPaymentCancellationRequest', 'request'],
    ['CustomerPaymentReversal', 'request'],
    ['FIToFIPaymentStatusReport', 'response'],
    ['PaymentStatusReport', 'response']
];
roleCases.forEach(([name, kind]) =>
    expect(`${name} -> ${kind}`, roleOf(name) === kind, roleOf(name) || 'sin clasificar'));
expect('no inventa rol cuando el nombre no lo dice',
    roleOf('ResolutionOfInvestigation') === null && roleOf('AccountHoldingInformation') === null,
    `${roleOf('ResolutionOfInvestigation')} / ${roleOf('AccountHoldingInformation')}`);
// "Additional..." no es el verbo "Add", y "Cancellation..." es un sustantivo: el
// verbo inicial solo cuenta cuando de verdad lo es.
expect('"AdditionalPaymentInformation" no se lee como el verbo Add',
    roleOf('AdditionalPaymentInformation') === null, roleOf('AdditionalPaymentInformation'));
expect('"CancellationStatusReport" es respuesta, no una orden de cancelar',
    roleOf('CancellationStatusReport') === 'response', roleOf('CancellationStatusReport'));
expect('el rol dice si el termino va al principio o al final',
    (roleApi.mdrMessageRole('GetLimit') || {}).basis === 'con el que empieza el nombre'
    && (roleApi.mdrMessageRole('AccountOpeningInstruction') || {}).basis === 'con el que termina el nombre',
    `${(roleApi.mdrMessageRole('GetLimit') || {}).basis} / ${(roleApi.mdrMessageRole('AccountOpeningInstruction') || {}).basis}`);
expect('ignora identificador y version dentro del nombre',
    roleApi.mdrMessageKey('SubscriptionOrder (setr.010) V08') === 'subscriptionorder',
    roleApi.mdrMessageKey('SubscriptionOrder (setr.010) V08'));

// Part 2 names the message with the version glued to it ("...InitiationV12"),
// which is what the message list and the message header of Part 2 receive.
console.log('  --- nombres tal como los da la Parte 2 (PDF) ---');
[
    ['CustomerCreditTransferInitiationV12', 'request'],
    ['CustomerDirectDebitInitiationV11', 'request'],
    ['CustomerPaymentReversalV12', 'request'],
    ['CustomerPaymentStatusReportV14', 'response'],
    ['AccountOpeningInstructionV08', 'request'],
    ['PriceReportV04', 'report']
].forEach(([name, kind]) =>
    expect(`  ${name} -> ${kind}`, roleOf(name) === kind, roleOf(name) || 'sin clasificar'));
const listTag = roleApi.mdrMessageRoleTagHtml('CustomerCreditTransferInitiationV12');
expect('  la etiqueta de la Parte 2 dice el termino en que se basa',
    /mdr-role-tag is-request/.test(listTag) && /Initiation/.test(listTag), listTag);
expect('  sin rol no se pinta etiqueta en la Parte 2',
    roleApi.mdrMessageRoleTagHtml('ResolutionOfInvestigationV10') === '',
    roleApi.mdrMessageRoleTagHtml('ResolutionOfInvestigationV10'));

// Coverage over the real tables: every message listed in a MessageDefinition table.
const messageCells = new Map();
let defTables = 0;
sections.forEach(section => section.blocks.forEach(block => {
    if (block.kind !== 'table' || !block.rows.length) return;
    const at = roleApi.part1MessageNameColumn(block.rows[0]);
    if (at === -1) return;
    defTables++;
    block.rows.slice(1).forEach(row => {
        const name = ((row.cells[at] || {}).text || '').trim();
        if (name) messageCells.set(name, roleOf(name));
    });
}));
const tagged = [...messageCells.values()].filter(Boolean).length;
console.log(`  tablas de MessageDefinition ${defTables} | mensajes ${messageCells.size} | con rol ${tagged}`);
expect('encuentra las tablas de MessageDefinition del documento', defTables >= 10, defTables);
expect('etiqueta casi todos los mensajes del documento',
    tagged / messageCells.size >= 0.9, `${tagged}/${messageCells.size}`);

// The extra column has to line up with the header of the table.
const defTable = sections.flatMap(s => s.blocks).find(block =>
    block.kind === 'table' && block.rows.length > 1 && roleApi.part1MessageNameColumn(block.rows[0]) === 0);
expect('hay una tabla de MessageDefinition para renderizar', Boolean(defTable));
if (defTable) {
    const tableHtml = roleApi.part1TableHtml(defTable);
    // "<thead" also starts with "<th", so the delimiter matters here.
    const headers = (tableHtml.match(/<th[ >]/g) || []).length;
    const firstRow = (tableHtml.match(/<tr>(?:(?!<\/tr>)[\s\S])*<\/tr>/g) || [])[1] || '';
    const cells = (firstRow.match(/<td/g) || []).length;
    expect('  anade una sola columna de rol al encabezado',
        headers === defTable.rows[0].cells.length + 1, headers);
    expect('  cada fila anade una sola celda de rol',
        cells === defTable.rows[1].cells.length + 1, cells);
    expect('  la celda de rol queda junto al nombre del mensaje',
        /<\/td><td class="is-role">/.test(firstRow), firstRow.slice(0, 200));
    expect('  la celda de rol se excluye del traductor con .is-role',
        /td class="is-role"/.test(tableHtml));
}
// A step table is not a list of messages: it must stay as the document has it.
const stepTable = (byTitle('6.1.2') || { blocks: [] }).blocks.find(block => block.kind === 'table');
expect('una tabla de pasos no recibe columna de rol',
    Boolean(stepTable) && !/is-role/.test(roleApi.part1TableHtml(stepTable)));

// ===== convergence: the Word section reaching into the PDF structure =====
console.log('\n=== convergencia negocio <-> tecnico ===');
const convergenceBlock = script.slice(
    script.indexOf('// ===== Convergence ====='),
    script.indexOf('// ISO 20022 message identifiers'));
// A minimal Part 2 catalogue with the real names of this domain.
const fakeMdr = { messages: {
    'acmt.001.001.08': { name: 'AccountOpeningInstructionV08', definition: 'Sent by the account owner to open an account.', buildingBlocks: { a: {}, b: {} }, elements: [1, 2, 3], constraints: { C1: {} } },
    'acmt.002.001.08': { name: 'AccountDetailsConfirmationV08', definition: '', buildingBlocks: {}, elements: [], constraints: {} },
    'setr.010.001.05': { name: 'SubscriptionOrderV05', definition: '', buildingBlocks: {}, elements: [], constraints: {} }
} };
const convergenceApi = new Function('PART1', 'MDR', 'escapeHtml', 'part1BuildFlow', 'mdrMessageRoleTagHtml',
    `${convergenceBlock}
return { CONVERGENCE, buildConvergence, technicalBridgeFor, renderTechnicalBridgePanel, businessContextFor };`)(
    api.PART1, fakeMdr, String, flowApi.part1BuildFlow, roleApi.mdrMessageRoleTagHtml);

const direct2 = byTitle('7.1.1.1');
expect('sin convergencia construida no se pinta el puente',
    convergenceApi.renderTechnicalBridgePanel(direct2) === '');

api.PART1.loaded = true;
api.PART1.sections = sections;
api.PART1.tree = tree;
convergenceApi.buildConvergence();
const conv = convergenceApi.CONVERGENCE;
console.log(`  mensajes ${conv.messages.length} | apartados enlazados ${conv.linkedSections}`);
expect('la convergencia queda construida', conv.built === true);
expect('enlaza apartados del Word con los mensajes del PDF', conv.linkedSections > 0, conv.linkedSections);
expect('el indice inverso existe', conv.bySection instanceof Map);

const bridge = convergenceApi.technicalBridgeFor(direct2);
expect('7.1.1.1 Direct enlaza con acmt.001.001.08',
    bridge.messages.some(item => item.msgId === 'acmt.001.001.08'),
    bridge.messages.map(item => item.msgId).join(', ') || 'ninguno');
expect('  el enlace es directo, no heredado', bridge.direct > 0, bridge.direct);

// A chapter that only groups subsections borrows their links.
const parent = sections.find(section => section.number === '7.1.1');
if (parent) {
    const parentBridge = convergenceApi.technicalBridgeFor(parent);
    expect('un capitulo hereda los enlaces de sus apartados',
        parentBridge.messages.length > 0, parentBridge.messages.length);
}

const bridgeHtml = convergenceApi.renderTechnicalBridgePanel(direct2);
expect('el puente nombra el mensaje y su identificador',
    /acmt\.001\.001\.08/.test(bridgeHtml) && /AccountOpeningInstructionV08/.test(bridgeHtml));
expect('el puente ofrece la estructura y el esquema JSON sin salir del Word',
    /jumpToPart2\('acmt\.001\.001\.08'\)/.test(bridgeHtml)
    && /openMessageSchema\('acmt\.001\.001\.08'\)/.test(bridgeHtml));
expect('el puente etiqueta el rol del mensaje',
    /mdr-role-tag is-request/.test(bridgeHtml), bridgeHtml.slice(0, 300));
expect('el puente muestra el tamano tecnico del mensaje',
    /building blocks/.test(bridgeHtml) && /campos/.test(bridgeHtml) && /constraints/.test(bridgeHtml));
expect('la definicion del PDF viaja al Word y es traducible',
    /class="tb-def scope-usage-text"/.test(bridgeHtml));
// The other direction still works from the same index.
const back = convergenceApi.businessContextFor('acmt.001.001.08');
expect('desde el mensaje se sigue viendo el contexto de negocio',
    Boolean(back) && back.sections.length > 0, back ? back.sections.length : 'sin contexto');

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas del parser pasaron');
process.exit(failures ? 1 : 0);
