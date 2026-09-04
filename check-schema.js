// The JSON schema viewer tells which reusable MessageComponent a structure points
// at ("Party" -> PartyIdentification36). That answer comes from the MDR line
// "<Block> contains <Type> on page N", and the danger is showing something that is
// not a component name at all ("±", "CodeSet"), so the resolution is tested here.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

const start = script.indexOf('// Which MessageComponent a structure points at');
const end = script.indexOf('// {Or ... Or} in the MDR marks a choice');
if (start === -1 || end === -1) {
    console.error('No se encontro el bloque de resolucion de MessageComponent en index.html');
    process.exit(1);
}
const block = script.slice(start, end);

// schemaStructureBlock() walks the whole catalogue; here it is a stub that returns
// whatever the case under test declares.
let stubBlock = null;
const api = new Function('schemaStructureBlock', `${block}
return { schemaComponentName, schemaComponentInfo };`)(() => stubBlock);

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

console.log('--- nombre del MessageComponent ---');
expect('toma el tipo declarado por "contains"',
    api.schemaComponentName({ containedTypeName: 'PartyIdentification36' }), 'PartyIdentification36');
expect('el declarado gana al resuelto',
    api.schemaComponentName({ containedTypeName: 'CashAccount40', typeName: 'OtherName9' }), 'CashAccount40');
expect('acepta el tipo resuelto cuando trae version',
    api.schemaComponentName({ typeName: 'PartyIdentification135' }), 'PartyIdentification135');
expect('"\u00b1" es la marca de complejo, no un componente',
    api.schemaComponentName({ containedTypeName: '\u00b1', typeName: '\u00b1' }), '');
expect('CodeSet es un datatype, no un componente',
    api.schemaComponentName({ containedTypeName: 'CodeSet' }), '');
expect('un tipo resuelto sin version no se inventa como componente',
    api.schemaComponentName({ typeName: 'Party' }), '');
expect('sin datos no devuelve nada', api.schemaComponentName(null), '');
expect('un bloque vacio no devuelve nada', api.schemaComponentName({}), '');

console.log('\n--- resolucion por nodo ---');
stubBlock = {
    containedTypeName: 'PartyIdentification36',
    containedTypePage: 412,
    section: '6.1.2.3',
    elements: [{}, {}, {}]
};
const complexNode = { complex: true, msgId: 'sese.023.001.11', element: {}, context: '' };
expect('un nodo complejo resuelve nombre, pagina, seccion y tamano',
    api.schemaComponentInfo(complexNode),
    { name: 'PartyIdentification36', page: 412, section: '6.1.2.3', fields: 3 });

// The block is resolved once: a second hover over the same row must not walk the
// catalogue again.
stubBlock = { containedTypeName: 'OtroComponente9', containedTypePage: 1, section: '', elements: [] };
expect('la respuesta queda memorizada en el nodo',
    api.schemaComponentInfo(complexNode).name, 'PartyIdentification36');

const leaf = { complex: false, msgId: 'sese.023.001.11', element: {}, context: '' };
expect('un campo simple no tiene componente', api.schemaComponentInfo(leaf), null);

stubBlock = null;
const unresolved = { complex: true, msgId: 'x', element: {}, context: '' };
expect('una estructura sin bloque resuelto no muestra componente',
    api.schemaComponentInfo(unresolved), null);

// ===== the sentence that names the component, in both wordings =====
// Reported case: "GroupHeader <GrpHdr> contains the following GroupHeader114
// elements" was ignored because only the wording that carries a page was read.
console.log('\n--- la frase "contains" del MDR ---');
const pickRegExp = name => {
    const found = script.match(new RegExp(`const ${name} = (/[\\s\\S]*?/[a-z]*);`));
    if (!found) { failures++; console.log(`FAIL  no se encontro ${name}`); return /$^/; }
    return new Function(`return ${found[1]}`)();
};
const referenceRe = pickRegExp('MDR_CONTAINS_REFERENCE_RE');
const inlineRe = pickRegExp('MDR_CONTAINS_INLINE_RE');

const componentOf = sentence => {
    const ref = sentence.match(referenceRe);
    if (ref) return { name: ref[1], page: Number(ref[2]) };
    const inline = sentence.match(inlineRe);
    return inline ? { name: inline[1], page: null } : null;
};

// Wordings taken from the two published PDFs in the workspace.
[
    ['GroupHeader <GrpHdr> contains the following GroupHeader114 elements',
        { name: 'GroupHeader114', page: null }],
    ['Party <Pty> contains one of the following Party50Choice elements',
        { name: 'Party50Choice', page: null }],
    ['SupplementaryData <SplmtryData> contains the following SupplementaryData1 elements',
        { name: 'SupplementaryData1', page: null }],
    // Not every component name closes with the version number.
    ['Quantity <Qty> contains the following QuantityAndAvailability elements',
        { name: 'QuantityAndAvailability', page: null }],
    ['InitiatingParty <InitgPty> contains the following elements (see "PartyIdentification272" on page 336 for details)',
        { name: 'PartyIdentification272', page: 336 }],
    ['Authorisation <Authstn> contains one of the following elements (see "Authorisation1Choice" on page 336 for details)',
        { name: 'Authorisation1Choice', page: 336 }]
].forEach(([sentence, wanted]) =>
    expect(`resuelve "${sentence.slice(0, 58)}..."`, componentOf(sentence), wanted));

// What must not be taken for a component name.
[
    'GroupHeader <GrpHdr> contains the following elements',
    'Authorisation <Authstn> contains one of the following elements',
    'If the message contains a branch of the InstructedAgent, then the party will claim reimbursement',
    'The identification contains 6-digits, but no check digit'
].forEach(sentence =>
    expect(`no inventa componente en "${sentence.slice(0, 46)}..."`, componentOf(sentence), null));

console.log('\n--- el parser guarda las dos formas ---');
const parseAt = script.indexOf('const containsCandidate = pendingContainsLine');
const parseBlock = script.slice(parseAt, script.indexOf('// Check for a detailed block header', parseAt));
expect('lee las dos redacciones', /MDR_CONTAINS_REFERENCE_RE/.test(parseBlock)
    && /MDR_CONTAINS_INLINE_RE/.test(parseBlock), true);
expect('guarda el componente en los dos casos', /componentTypeName = typeName/.test(parseBlock), true);
// containedTypeName drives the canonical-elements merge and must keep meaning
// "there is a page to follow", or a page-less reference would break the merge.
expect('solo la forma con pagina alimenta containedTypeName',
    /if \(typePage\) \{\s*\n\s*target\.containedTypeName = typeName;/.test(parseBlock), true);

console.log('\n--- se muestra al pasar el cursor ---');
const tipStart = script.indexOf('function schemaTipHtml');
const tipBody = script.slice(tipStart, script.indexOf('\n}', tipStart));
expect('el tooltip pide el componente del nodo', /schemaComponentInfo\(node\)/.test(tipBody), true);
expect('el tooltip pinta el nombre del componente', /component\.name/.test(tipBody), true);
expect('el tooltip dice de que se trata',
    /MessageComponent/.test(tipBody), true);

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas del esquema pasaron');
process.exit(failures ? 1 : 0);
