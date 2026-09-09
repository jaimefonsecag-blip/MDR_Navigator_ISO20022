// Reported: in the OpenAPI builder, marking a field that belongs to a
// SelectOneOf group (e.g. AnyBIC / LEI - only one of the two is ever sent)
// let both members of the group get checked at once, producing a generated
// schema that contradicts the MDR's "exactly one of" rule. Checking a
// SelectOneOf member now clears any other member of that same choice that
// was already checked. This relies on every schema node knowing which node
// it was created under (node.parentId, added alongside this fix) because
// orGroup numbers are only unique among one parent's own children - two
// unrelated SelectOneOf groups elsewhere in the tree can both be "group 1".
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

const chainBlock = extract('function apiNodeChain', 'function apiFieldLabel', 'apiNodeChain()');
const toggleBlock = extract('function apiOrGroupSiblings', 'function apiSetRequired', 'apiOrGroupSiblings/apiUncheckNode/apiToggleSelect');

// A minimal stand-in for a materialized <div class="sch-node"> with its
// checkbox <input>, just enough for apiNodeChain (walks .sch-node ancestors)
// and apiUncheckNode (reads the checkbox back out) to do their real work.
function makeFakeDom(nodeIds) {
    const elements = new Map();
    nodeIds.forEach(id => {
        const input = { checked: true };
        elements.set(id, {
            id,
            classList: { contains: cls => cls === 'sch-node' },
            parentElement: null, // flat tree is enough: apiNodeChain only needs "this node exists"
            querySelector: selector => (selector === ':scope > .sch-row .sch-select-box input' ? input : null),
            input
        });
    });
    return {
        getElementById: id => elements.get(id) || null,
        elements
    };
}

function makeSandbox(nodes, fakeDocument) {
    const SchemaViewer = { nodes: new Map(nodes.map(n => [n.id, n])) };
    const ApiBuilder = { selected: new Map() };
    let renderCalls = 0;
    const apiRenderPanel = () => { renderCalls++; };
    const built = new Function(
        'document', 'SchemaViewer', 'ApiBuilder', 'apiRenderPanel',
        `${chainBlock}\n${toggleBlock}
        return { apiToggleSelect, apiOrGroupSiblings };`
    )(fakeDocument, SchemaViewer, ApiBuilder, apiRenderPanel);
    return { ...built, SchemaViewer, ApiBuilder, renderCallCount: () => renderCalls };
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

const node = (id, overrides) => Object.assign({ id, isOr: false, parentId: '', orGroup: 0 }, overrides);

console.log('--- marcar un campo de un SelectOneOf desmarca al otro miembro del mismo grupo ---');
{
    const anyBic = node('anyBic', { isOr: true, parentId: 'refIssuer', orGroup: 1 });
    const lei = node('lei', { isOr: true, parentId: 'refIssuer', orGroup: 1 });
    const dom = makeFakeDom(['anyBic', 'lei']);
    const sandbox = makeSandbox([anyBic, lei], dom);

    sandbox.apiToggleSelect('lei', true); // el usuario ya habia marcado LEI
    sandbox.apiToggleSelect('anyBic', true); // ahora marca AnyBIC tambien

    expect('AnyBIC queda marcado', sandbox.ApiBuilder.selected.has('anyBic'), true);
    expect('LEI se desmarca automaticamente (no pueden ir los dos)', sandbox.ApiBuilder.selected.has('lei'), false);
    expect('la casilla de LEI en el DOM tambien se destilda', dom.elements.get('lei').input.checked, false);
}

console.log('\n--- desmarcar sigue funcionando normalmente (no fuerza a marcar otro) ---');
{
    const anyBic = node('anyBic', { isOr: true, parentId: 'refIssuer', orGroup: 1 });
    const lei = node('lei', { isOr: true, parentId: 'refIssuer', orGroup: 1 });
    const dom = makeFakeDom(['anyBic', 'lei']);
    const sandbox = makeSandbox([anyBic, lei], dom);

    sandbox.apiToggleSelect('anyBic', true);
    sandbox.apiToggleSelect('anyBic', false);

    expect('ningun campo queda seleccionado tras desmarcar', sandbox.ApiBuilder.selected.size, 0);
}

console.log('\n--- grupos distintos bajo el mismo padre no se pisan entre si ---');
{
    // orGroup numbers restart per parent, so "grupo 1" and "grupo 2" here are
    // two independent SelectOneOf choices inside the same structure.
    const a1 = node('a1', { isOr: true, parentId: 'p1', orGroup: 1 });
    const a2 = node('a2', { isOr: true, parentId: 'p1', orGroup: 1 });
    const b1 = node('b1', { isOr: true, parentId: 'p1', orGroup: 2 });
    const dom = makeFakeDom(['a1', 'a2', 'b1']);
    const sandbox = makeSandbox([a1, a2, b1], dom);

    sandbox.apiToggleSelect('a1', true);
    sandbox.apiToggleSelect('b1', true);

    expect('a1 (grupo 1) sigue marcado', sandbox.ApiBuilder.selected.has('a1'), true);
    expect('b1 (grupo 2, mismo padre) no se ve afectado por marcar a1', sandbox.ApiBuilder.selected.has('b1'), true);
}

console.log('\n--- el mismo numero de grupo en padres distintos no se confunde ---');
{
    // Two unrelated SelectOneOf choices elsewhere in the tree can both be
    // "orGroup 1" - only nodes that share BOTH parentId and orGroup compete.
    const under1 = node('under1', { isOr: true, parentId: 'parentOne', orGroup: 1 });
    const under2 = node('under2', { isOr: true, parentId: 'parentTwo', orGroup: 1 });
    const dom = makeFakeDom(['under1', 'under2']);
    const sandbox = makeSandbox([under1, under2], dom);

    sandbox.apiToggleSelect('under1', true);
    sandbox.apiToggleSelect('under2', true);

    expect('marcar under1 no desmarca under2 (padres distintos)', sandbox.ApiBuilder.selected.has('under1'), true);
    expect('under2 tambien queda marcado', sandbox.ApiBuilder.selected.has('under2'), true);
}

console.log('\n--- un campo que no es SelectOneOf nunca desmarca a otros ---');
{
    const plainA = node('plainA');
    const plainB = node('plainB');
    const dom = makeFakeDom(['plainA', 'plainB']);
    const sandbox = makeSandbox([plainA, plainB], dom);

    sandbox.apiToggleSelect('plainA', true);
    sandbox.apiToggleSelect('plainB', true);

    expect('ambos campos normales quedan marcados a la vez', [...sandbox.ApiBuilder.selected.keys()].sort(), ['plainA', 'plainB']);
}

console.log('\n--- apiOrGroupSiblings no incluye al propio nodo ni a los que no califican ---');
{
    const anyBic = node('anyBic', { isOr: true, parentId: 'refIssuer', orGroup: 1 });
    const lei = node('lei', { isOr: true, parentId: 'refIssuer', orGroup: 1 });
    const other = node('other', { isOr: true, parentId: 'refIssuer', orGroup: 2 });
    const dom = makeFakeDom(['anyBic', 'lei', 'other']);
    const sandbox = makeSandbox([anyBic, lei, other], dom);
    const siblings = sandbox.apiOrGroupSiblings(sandbox.SchemaViewer.nodes.get('anyBic')).map(n => n.id).sort();
    expect('solo devuelve a LEI (mismo padre y grupo), no a si mismo ni al otro grupo', siblings, ['lei']);
}

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de exclusividad SelectOneOf pasaron');
process.exit(failures ? 1 : 0);
