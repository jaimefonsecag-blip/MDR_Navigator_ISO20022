// Reported: a collapsed row in the JSON schema viewer showed "…" for its
// property count, which read as "maybe there's nothing in here" and
// discouraged opening it — confirmed by a screenshot of a schema where every
// closed row underneath an open one showed "{ … }". schemaRenderNode() now
// resolves one level ahead (just enough to know the count, not to render or
// open it) so a collapsed row already says "{ 3 propiedades }". This also
// covers the companion report that "Expandir" left nested properties closed:
// that button now calls schemaExpandAllFull(), which ignores the depth
// selector entirely instead of capping at its default of 4.
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

// schemaStructureBlock() sits between these chunks and is stubbed instead of
// extracted, the same way check-schema.js stubs it: it is the one function
// here that reaches into the full building-block catalogue, which this check
// has no need to build just to exercise the look-ahead and rendering logic.
// SCHEMA_NODE_BUDGET is likewise injected as a parameter (so a test can lower
// it) rather than taken from its own "const" line inside the extracted code.
const chunkA0 = extract('const SCHEMA_SIMPLE_TYPES', 'const SCHEMA_NODE_BUDGET', 'tipos de dato del esquema');
const chunkA1 = extract('const SCHEMA_TABLE_CACHE', 'function schemaStructureBlock', 'tabla de indices y creacion de nodos');
const chunkB = extract('function schemaComponentName', 'function schemaRenderNode', 'resolucion de hijos y helpers de fila');
const chunkC = extract('function schemaRenderNode', 'function schemaRenderCodesHtml', 'renderizado de un nodo');
const chunkA = `${chunkA0}\n${chunkA1}`;

// Each test below builds its own sandbox (its own SchemaViewer.nodes map and
// its own stubbed schemaStructureBlock) so state never leaks between cases.
function makeSandbox(budget) {
    const sv = { nodes: new Map(), nextId: 1, maxDepth: 4 };
    let blockOf = () => null;
    const boxCalls = [];
    const built = new Function(
        'escapeHtml', 'MDR', 'schemaStructureBlock', 'blockContextSection', 'schemaApiCheckboxHtml',
        'calculateElementLevels', 'normalizeCatalogName', 'SchemaViewer', 'SCHEMA_NODE_BUDGET',
        `${chunkA}\n${chunkB}\n${chunkC}
        return { schemaCreateNode, schemaNodeChildren, schemaRenderNode, schemaBlockIndex };`
    )(
        value => String(value === undefined ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        { messages: {}, codeSetsByName: {} },
        (msgId, element) => blockOf(element),
        () => '',
        node => { boxCalls.push(node.id); return ''; },
        elements => new Map(elements.map(el => [el, 0])),
        value => String(value || '').replace(/\s+/g, '').toLowerCase(),
        sv,
        budget === undefined ? 6000 : budget
    );
    return { ...built, SchemaViewer: sv, setBlock: fn => { blockOf = fn; } };
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

console.log('--- una fila cerrada ya conoce su cantidad de propiedades ---');
{
    const sandbox = makeSandbox();
    sandbox.setBlock(element => element.tag === 'RefIssr' ? {
        tag: 'RefIssr', name: 'ReferenceIssuer', section: '',
        elements: [
            { name: 'AnyBIC', tag: 'AnyBIC', mult: '[1..1]', type: 'Text' },
            { name: 'ProprietaryIdentification', tag: 'PrtryId', mult: '[1..1]', type: 'Text' },
            { name: 'NameAndAddress', tag: 'NmAndAdr', mult: '[1..1]', type: 'Text' }
        ]
    } : null);
    const node = sandbox.schemaCreateNode({
        msgId: 'm1', element: { name: 'ReferenceIssuer', tag: 'RefIssr', mult: '[0..1]', type: '' },
        depth: 1, ancestors: new Set()
    });
    const html = sandbox.schemaRenderNode(node);
    expect('el nodo nunca fue abierto (loaded queda en true solo por la vista previa)', node.loaded, true);
    expect('la fila muestra la cantidad real, no puntos suspensivos',
        /3 propiedades/.test(html), true);
    expect('no dice "…" para este nodo', /&hellip;/.test(html), false);
    expect('los hijos NO se renderizaron todavia (solo se contaron)',
        /AnyBIC|ProprietaryIdentification|NameAndAddress/.test(html), false);
    expect('el contenedor de hijos sigue marcado como no cargado (no se abrio)',
        /data-loaded="false"/.test(html), true);
}

console.log('\n--- una estructura que no resuelve nada dice "0 propiedades", no "…" ---');
{
    const sandbox = makeSandbox();
    sandbox.setBlock(() => null);
    const node = sandbox.schemaCreateNode({
        msgId: 'm1', element: { name: 'Unresolvable', tag: 'Unresolvable', mult: '[0..1]', type: '' },
        depth: 1, ancestors: new Set()
    });
    const html = sandbox.schemaRenderNode(node);
    expect('se avisa que no tiene nada dentro en vez de dejarlo ambiguo',
        /0 propiedades/.test(html), true);
}

console.log('\n--- una estructura recursiva se marca desde la primera vista, sin abrirla ---');
{
    const sandbox = makeSandbox();
    sandbox.setBlock(element => element.tag === 'Loopy'
        // A block's own self-referencing header row (same tag/name as the block)
        // is filtered out by schemaBlockIndex, so the child listed here has to be
        // a different tag or the block would look empty before recursion is even
        // checked.
        ? { tag: 'Loopy', name: 'Loopy', section: '', blockKey: 'loop-key', elements: [{ name: 'SomeChild', tag: 'SmCh', mult: '[1..1]', type: 'Text' }] }
        : null);
    const node = sandbox.schemaCreateNode({
        msgId: 'm1', element: { name: 'Loopy', tag: 'Loopy', mult: '[0..1]', type: '' },
        depth: 1, ancestors: new Set(['loop-key'])
    });
    const html = sandbox.schemaRenderNode(node);
    expect('la insignia "recursivo" aparece sin necesidad de abrir el nodo',
        /sch-recursive/.test(html) && /recursivo/.test(html), true);
}

console.log('\n--- una fila hoja simple no intenta resolver nada ---');
{
    const sandbox = makeSandbox();
    let calls = 0;
    sandbox.setBlock(() => { calls++; return null; });
    const node = sandbox.schemaCreateNode({
        msgId: 'm1', element: { name: 'Reference', tag: 'Ref', mult: '[1..1]', type: 'Text' },
        depth: 1, ancestors: new Set()
    });
    sandbox.schemaRenderNode(node);
    expect('un campo simple (no complejo) nunca pregunta por su estructura', calls, 0);
}

console.log('\n--- el presupuesto de tamano sigue protegiendo la vista previa ---');
{
    const sandbox = makeSandbox(0); // budget already exhausted
    sandbox.setBlock(element => element.tag === 'RefIssr' ? {
        tag: 'RefIssr', name: 'ReferenceIssuer', section: '',
        elements: [{ name: 'AnyBIC', tag: 'AnyBIC', mult: '[1..1]', type: 'Text' }]
    } : null);
    const node = sandbox.schemaCreateNode({
        msgId: 'm1', element: { name: 'ReferenceIssuer', tag: 'RefIssr', mult: '[0..1]', type: '' },
        depth: 1, ancestors: new Set()
    });
    const html = sandbox.schemaRenderNode(node);
    expect('con el presupuesto agotado, la vista previa se salta y vuelve a mostrar "…"',
        /&hellip;/.test(html), true);
}

console.log('\n--- "Expandir todo" no depende del selector de nivel ---');
{
    const expandStart = script.indexOf('function schemaExpandAllFull()');
    const expandEnd = script.indexOf('function schemaToggleNameMode');
    if (expandStart === -1 || expandEnd === -1) {
        failures++;
        console.log('FAIL  no se encontro schemaExpandAllFull() en index.html');
    } else {
        const block = script.slice(expandStart, expandEnd);
        let depthSet;
        const fakeSelect = { value: '4' };
        const fakeDocument = { getElementById: id => (id === 'schemaDepth' ? fakeSelect : null) };
        const fakeSchemaViewer = { maxDepth: 4 };
        const runner = new Function('document', 'SchemaViewer', 'schemaExpandAll', `${block}\nreturn schemaExpandAllFull;`)(
            fakeDocument, fakeSchemaViewer, depth => { depthSet = depth; }
        );
        runner();
        expect('fuerza la profundidad a "todo" (25), no a lo seleccionado (4)', depthSet, 25);
        expect('SchemaViewer.maxDepth queda sincronizado', fakeSchemaViewer.maxDepth, 25);
        expect('el selector "Nivel" refleja "Todo" para no contradecir lo que se ve',
            fakeSelect.value, '25');
    }
}

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de vista previa del esquema pasaron');
process.exit(failures ? 1 : 0);
