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

// ===== the CodeSet tag on the row =====
// Reported: the code sets of the external codes were not visible in the JSON tree,
// only inside the hover card, so there was no way to reach their values.
console.log('\n--- etiqueta del set de codigos en la fila ---');
const tagBlock = script.slice(
    script.indexOf('// The name of the CodeSet a field points at'),
    script.indexOf('function schemaRenderNode'));
const tagApi = loaded => new Function('escapeHtml', 'MDR', `${tagBlock}
return { schemaCodeSetTagHtml };`)(
    value => String(value === undefined ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    { externalCodeSets: { loaded } });

const codeSetNode = (datatypeName, codes, extra) => ({
    id: 'schn1', element: { codeSetName: datatypeName }, enumCodes: codes || [],
    typeInfo: { datatypeName, kind: 'codeset', codes: codes || [], ...(extra || {}) }
});

const withValues = tagApi(true).schemaCodeSetTagHtml(codeSetNode('ExternalPurpose1Code',
    [{ code: 'CASH' }, { code: 'SALA' }, { code: 'TAXS' }]));
expect('muestra el nombre del set en la fila', /ExternalPurpose1Code/.test(withValues), true);
expect('dice cuantos codigos tiene', /3 códigos/.test(withValues), true);
expect('se puede pulsar para verlos', /schemaOpenCodeSet\('schn1'\)/.test(withValues), true);
expect('con valores no queda en ambar', !/is-pending/.test(withValues), true);

const pending = tagApi(false).schemaCodeSetTagHtml(codeSetNode('ExternalCashAccountType1Code', []));
expect('sin valores tambien se muestra el set',
    /ExternalCashAccountType1Code/.test(pending) && /sin valores/.test(pending), true);
expect('sin valores queda marcado como pendiente', /is-pending/.test(pending), true);
expect('sin catalogo cargado invita a cargarlo',
    /cargar el catálogo/i.test(pending), true);
const pendingLoaded = tagApi(true).schemaCodeSetTagHtml(codeSetNode('ExternalCashAccountType1Code', []));
expect('con catalogo cargado explica que ese set no viene',
    /no incluye este set/.test(pendingLoaded), true);

// What must not carry the tag.
expect('un datatype que no es CodeSet no lleva etiqueta',
    tagApi(true).schemaCodeSetTagHtml({
        id: 'schn2', element: {}, enumCodes: [],
        typeInfo: { datatypeName: 'Max35Text', kind: 'text', codes: [] }
    }), '');
expect('un CodeSet que el parser no resolvio no lleva etiqueta',
    tagApi(true).schemaCodeSetTagHtml(codeSetNode('CodeSet_Purpose_Prtry', [])), '');
expect('sin nombre no lleva etiqueta',
    tagApi(true).schemaCodeSetTagHtml(codeSetNode('', [])), '');

console.log('\n--- integracion de la etiqueta ---');
expect('la fila simple la pinta',
    /schemaKeyHtml\(node\)}<span class="sch-type"[\s\S]{0,200}schemaCodeSetTagHtml\(node\)/.test(script), true);
expect('la fila desplegable la pinta cuando es un enum',
    /isEnum \? schemaCodeSetTagHtml\(node\) : ''/.test(script), true);
expect('el buscador encuentra el nombre del set',
    /SCHEMA_HIGHLIGHT_TARGETS = '[^']*\.sch-codeset-name/.test(script), true);
expect('la leyenda explica la etiqueta',
    /class="sch-codeset sch-legend-item"/.test(html), true);
expect('al llegar el catalogo se reconstruye el esquema abierto',
    /if \(SchemaViewer\.open\) schemaReopen\(\);/.test(script), true);
expect('reconstruye tambien la vista de un building block',
    /SchemaViewer\.blockRef = blockRef;/.test(script), true);

// The values open in the dedicated window, not expanded below the field in the tree.
const openTagBlock = script.slice(
    script.indexOf('function schemaOpenCodeSet'),
    script.indexOf('function schemaRenderNode'));
expect('la etiqueta abre la ventana de codigos, no despliega en el arbol',
    openTagBlock.includes('openCodeSetViewer(') && !openTagBlock.includes('schemaToggleNode('), true);
expect('la ventana de codigos queda por encima del esquema abierto',
    /#codeSetOverlay \{ z-index:210/.test(html), true);
expect('con el set abierto, Escape no cierra el esquema por debajo',
    /!SchemaViewer\.open \|\| confirmDialogIsOpen\(\) \|\| CodeSetViewer\.open/.test(script), true);

// ===== hovering a single code =====
// The definition of a value comes from column D of the ISO workbook (or from the
// MDR for an internal CodeSet) and is shown translated.
console.log('\n--- definicion del codigo al pasar el cursor ---');
const codeTipBlock = script.slice(
    script.indexOf('// What a single value means'),
    script.indexOf('function schemaShowCodeTip'));
const codeTipApi = new Function('escapeHtml', `${codeTipBlock}
return { schemaCodeTipHtml };`)(
    value => String(value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

const sampleCode = {
    code: 'BBAN', name: 'BBANIdentifier', set: 'ExternalAccountIdentification1Code',
    definition: 'Basic Bank Account Number (BBAN) - identifier used nationally by financial institutions.',
    status: 'Registered', replacedBy: ''
};
const done = codeTipApi.schemaCodeTipHtml(sampleCode, 'done', 'Número de cuenta bancaria básico, usado a nivel nacional.');
expect('la tarjeta identifica el codigo', /"BBAN"/.test(done) && /BBANIdentifier/.test(done), true);
expect('muestra la definicion en espanol', /Número de cuenta bancaria básico/.test(done), true);
expect('la marca como espanol', /sch-tip-lang">es</.test(done), true);
expect('conserva el original en ingles para verificar',
    /Basic Bank Account Number/.test(done), true);
expect('dice a que set pertenece', /ExternalAccountIdentification1Code/.test(done), true);

const pendingTip = codeTipApi.schemaCodeTipHtml(sampleCode, 'pending', '');
expect('mientras traduce lo dice', /Traduciendo la definición/.test(pendingTip), true);
const failedTip = codeTipApi.schemaCodeTipHtml(sampleCode, 'failed', '');
expect('si falla la traduccion muestra el original',
    /no se pudo traducir/i.test(failedTip) && /Basic Bank Account Number/.test(failedTip), true);
const emptyTip = codeTipApi.schemaCodeTipHtml({ code: 'XXXX', name: '', set: '', definition: '' }, 'empty', '');
expect('sin definicion lo dice y no inventa nada',
    /no incluye una definición/.test(emptyTip) && !/sch-tip-orig/.test(emptyTip), true);

const retired = codeTipApi.schemaCodeTipHtml(
    { code: 'CASH', name: 'CashManagement', set: 'ExternalPurpose1Code', definition: 'Old value.', status: 'Obsolete', replacedBy: 'CCRD' },
    'done', 'Valor antiguo.');
expect('avisa de un codigo retirado', /Obsolete/.test(retired), true);
expect('dice por que codigo se reemplaza', /CCRD/.test(retired), true);

console.log('\n--- cableado del cursor sobre el codigo ---');
expect('cada valor sabe a que nodo y posicion pertenece',
    /data-code-node="\$\{node\.id\}" data-code-index="\$\{index\}"/.test(script), true);
expect('el cursor sobre un valor abre su tarjeta, no la del campo',
    /closest\('\.sch-enum-code'\)/.test(script) && /schemaShowCodeTip\(codeRow/.test(script), true);
expect('campo y codigo comparten el mismo motor de traduccion',
    /function schemaTipShow\(/.test(script)
    && /schemaTipShow\(node\.id, node\.definition/.test(script)
    && /schemaTipShow\(`\$\{node\.id\}:code:\$\{index\}`, code\.definition/.test(script), true);
expect('un valor retirado se ve tachado en el arbol',
    /sch-enum-code\$\{obsolete \? ' is-obsolete' : ''\}/.test(script), true);

console.log('\n--- se muestra al pasar el cursor ---');
const tipStart = script.indexOf('function schemaTipHtml');
const tipBody = script.slice(tipStart, script.indexOf('\n}', tipStart));
expect('el tooltip pide el componente del nodo', /schemaComponentInfo\(node\)/.test(tipBody), true);
expect('el tooltip pinta el nombre del componente', /component\.name/.test(tipBody), true);
expect('el tooltip dice de que se trata',
    /MessageComponent/.test(tipBody), true);

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas del esquema pasaron');
process.exit(failures ? 1 : 0);
