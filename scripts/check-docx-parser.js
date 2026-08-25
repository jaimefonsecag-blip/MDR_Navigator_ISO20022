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
return { part1BuildFlow, part1FindActors, part1ActorVocabulary, part1RoleDefinition };`)(
    api.PART1, String);

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
expect('reconstruye flujos en buena parte del documento', flows.length >= 60, flows.length);
expect('ningun flujo sin participantes', flows.every(f => f.participants.length > 0));
expect('ningun paso con numero repetido',
    flows.every(f => new Set(f.steps.map(s => s.number)).size === f.steps.length));

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas del parser pasaron');
process.exit(failures ? 1 : 0);
