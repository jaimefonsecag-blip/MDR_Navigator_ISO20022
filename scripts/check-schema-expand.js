// "Expandir todo" on a large JSON schema (thousands of nodes) could freeze the
// tab: the old loop re-scanned the WHOLE tree with querySelectorAll('.sch-node')
// on every one of up to 60 passes, so a deep/large schema meant dozens of
// full-tree DOM scans over an ever-growing tree. The rewrite walks level by
// level, carrying each level's own just-materialised children forward as the
// next frontier, visiting every node exactly once. This check proves the
// rewrite opens exactly the same nodes (and respects the same size budget) as
// the original full-rescan algorithm, across randomized synthetic trees.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

const start = script.indexOf('function schemaExpandAll(depthOverride)');
const end = script.indexOf('function schemaCollapseAll()');
if (start === -1 || end === -1) {
    console.error('No se encontro schemaExpandAll() en index.html');
    process.exit(1);
}
const newSource = script.slice(start, end);

// The pre-optimization algorithm, kept here verbatim as the reference the
// rewrite must match (the check-pdf-perf.js check does the same thing for the
// other optimization made in this same round of work).
const oldSource = `
function schemaExpandAllOld(depthOverride) {
    const pane = document.getElementById('schemaTreePane');
    if (!pane) return;
    const limit = Number(depthOverride === undefined ? SchemaViewer.maxDepth : depthOverride);
    SchemaViewer.truncated = false;
    for (let pass = 0; pass < 60; pass++) {
        const pending = Array.from(pane.querySelectorAll('.sch-node'))
            .filter(element => !element.classList.contains('is-open')
                && Number(element.dataset.depth) < limit
                && schemaChildrenContainer(element));
        if (!pending.length) break;
        if (SchemaViewer.nodes.size > SCHEMA_NODE_BUDGET) { SchemaViewer.truncated = true; break; }
        pending.forEach(element => {
            const node = SchemaViewer.nodes.get(element.id);
            if (!node) return;
            schemaMaterialize(node, element);
            schemaSetNodeState(element, true);
        });
    }
    schemaApplyFilter();
    schemaUpdateStatus();
}
`;

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

// ===== synthetic tree generation =====
function makeRng(seed) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

function buildTreeSpec(rnd, maxNodes, maxDepth) {
    const spec = new Map();
    let nextId = 1;
    const root = { id: 'root', depth: 0, isLeaf: false, childIds: [] };
    spec.set('root', root);
    const queue = [root];
    let count = 1;
    while (queue.length && count < maxNodes) {
        const parent = queue.shift();
        if (parent.isLeaf || parent.depth >= maxDepth) continue;
        const childCount = Math.floor(rnd() * 4);
        for (let i = 0; i < childCount && count < maxNodes; i++) {
            const id = `n${nextId++}`;
            const isLeaf = parent.depth + 1 >= maxDepth || rnd() < 0.3;
            const node = { id, depth: parent.depth + 1, isLeaf, childIds: [] };
            spec.set(id, node);
            parent.childIds.push(id);
            queue.push(node);
            count++;
        }
    }
    return spec;
}

// ===== fake DOM built from a tree spec =====
function instantiateDom(spec) {
    function makeElement(id) {
        const specNode = spec.get(id);
        const classes = new Set(['sch-node']);
        return {
            id,
            dataset: { depth: String(specNode.depth), loaded: undefined },
            classList: {
                contains: c => classes.has(c),
                toggle: (c, force) => {
                    const next = force === undefined ? !classes.has(c) : Boolean(force);
                    if (next) classes.add(c); else classes.delete(c);
                    return next;
                }
            },
            _container: specNode.isLeaf ? null : { dataset: { loaded: 'false' }, children: [] }
        };
    }

    const root = makeElement('root');
    root.classList.toggle('is-open', true);
    root._container.dataset.loaded = 'true';
    const nodesMap = new Map();
    root._container.children = spec.get('root').childIds.map(cid => {
        nodesMap.set(cid, { id: cid });
        return makeElement(cid);
    });

    const elementsById = new Map([['root', root]]);
    root._container.children.forEach(el => elementsById.set(el.id, el));

    return { root, nodesMap, elementsById, makeElement };
}

function collectSchNodes(element) {
    const results = [element];
    if (element._container) {
        element._container.children.forEach(child => results.push(...collectSchNodes(child)));
    }
    return results;
}

function runAlgorithm(source, fnName, spec, limit, budget) {
    const dom = instantiateDom(spec);
    const SchemaViewer = { nodes: dom.nodesMap, truncated: false, maxDepth: limit };
    const pane = {
        querySelectorAll: () => collectSchNodes(dom.root),
        querySelector: () => dom.root
    };
    const document = { getElementById: id => (id === 'schemaTreePane' ? pane : null) };

    const schemaChildrenContainer = element => element._container;
    const schemaSetNodeState = (element, expanded) => element.classList.toggle('is-open', expanded);
    const schemaMaterialize = (node, element) => {
        if (!element._container || element._container.dataset.loaded === 'true') return;
        const specNode = spec.get(node.id);
        element._container.children = specNode.childIds.map(cid => {
            SchemaViewer.nodes.set(cid, { id: cid });
            const el = dom.makeElement(cid);
            dom.elementsById.set(cid, el);
            return el;
        });
        element._container.dataset.loaded = 'true';
    };
    let filterCalls = 0, statusCalls = 0;
    const schemaApplyFilter = () => { filterCalls++; };
    const schemaUpdateStatus = () => { statusCalls++; };

    const runner = new Function(
        'document', 'SchemaViewer', 'SCHEMA_NODE_BUDGET',
        'schemaChildrenContainer', 'schemaSetNodeState', 'schemaMaterialize',
        'schemaApplyFilter', 'schemaUpdateStatus',
        `${source}\nreturn ${fnName};`
    )(document, SchemaViewer, budget, schemaChildrenContainer, schemaSetNodeState, schemaMaterialize, schemaApplyFilter, schemaUpdateStatus);

    runner(limit);

    const openIds = collectSchNodes(dom.root)
        .filter(el => el.classList.contains('is-open'))
        .map(el => el.id)
        .sort();
    return { openIds, truncated: SchemaViewer.truncated, nodeCount: SchemaViewer.nodes.size, filterCalls, statusCalls };
}

console.log('--- version nueva vs escaneo completo original ---');
const rnd = makeRng(20260909);
let mismatches = 0;
const ROUNDS = 150;
for (let round = 0; round < ROUNDS; round++) {
    const maxNodes = 5 + Math.floor(rnd() * 400);
    const maxDepth = 2 + Math.floor(rnd() * 6);
    const spec = buildTreeSpec(rnd, maxNodes, maxDepth);
    const limit = Math.floor(rnd() * (maxDepth + 2));
    // Budget sometimes small enough to force truncation, sometimes generous.
    const budget = rnd() < 0.3 ? Math.floor(rnd() * maxNodes) : 100000;

    const oldResult = runAlgorithm(oldSource, 'schemaExpandAllOld', spec, limit, budget);
    const newResult = runAlgorithm(newSource, 'schemaExpandAll', spec, limit, budget);

    const same = JSON.stringify(oldResult.openIds) === JSON.stringify(newResult.openIds)
        && oldResult.truncated === newResult.truncated;
    if (!same) {
        mismatches++;
        if (mismatches <= 3) {
            console.log(`FAIL  ronda ${round}: difiere (nodos=${maxNodes}, profundidad=${maxDepth}, limite=${limit}, budget=${budget})`);
            console.log(`      antiguo: ${JSON.stringify(oldResult)}`);
            console.log(`      nuevo  : ${JSON.stringify(newResult)}`);
        }
    }
}
expect(`${ROUNDS} arboles aleatorios abren exactamente los mismos nodos`, mismatches, 0);

console.log('\n--- la version nueva no vuelve a escanear el arbol completo ---');
// A handful of full-tree querySelectorAll() calls (one per pass) is exactly
// the cost being removed; the new version must only ever look at the pane
// once, to find the root.
{
    const spec = buildTreeSpec(makeRng(7), 300, 6);
    const dom = instantiateDom(spec);
    const SchemaViewer = { nodes: dom.nodesMap, truncated: false, maxDepth: 6 };
    let queryAllCalls = 0;
    let queryCalls = 0;
    const pane = {
        querySelectorAll: () => { queryAllCalls++; return collectSchNodes(dom.root); },
        querySelector: () => { queryCalls++; return dom.root; }
    };
    const document = { getElementById: id => (id === 'schemaTreePane' ? pane : null) };
    const schemaChildrenContainer = element => element._container;
    const schemaSetNodeState = (element, expanded) => element.classList.toggle('is-open', expanded);
    const schemaMaterialize = (node, element) => {
        if (!element._container || element._container.dataset.loaded === 'true') return;
        const specNode = spec.get(node.id);
        element._container.children = specNode.childIds.map(cid => {
            SchemaViewer.nodes.set(cid, { id: cid });
            const el = dom.makeElement(cid);
            return el;
        });
        element._container.dataset.loaded = 'true';
    };
    const runner = new Function(
        'document', 'SchemaViewer', 'SCHEMA_NODE_BUDGET',
        'schemaChildrenContainer', 'schemaSetNodeState', 'schemaMaterialize',
        'schemaApplyFilter', 'schemaUpdateStatus',
        `${newSource}\nreturn schemaExpandAll;`
    )(document, SchemaViewer, 100000, schemaChildrenContainer, schemaSetNodeState, schemaMaterialize, () => {}, () => {});
    runner(6);
    expect('nunca llama a querySelectorAll sobre el panel completo', queryAllCalls, 0);
    expect('solo consulta el panel una vez para ubicar la raiz', queryCalls, 1);
}

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de expansion del esquema pasaron');
process.exit(failures ? 1 : 0);
