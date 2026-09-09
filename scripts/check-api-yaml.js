// Reported three bugs in the OpenAPI YAML output:
//
//  1. properties: "[object Object]" — when a complex node has no selected
//     children, apiOwnSchema() still set body.properties = {} (an empty JS
//     object). The YAML serializer (apiYamlNode) only recursed into child
//     objects whose Object.keys().length > 0, so an empty {} fell through to
//     apiYamlScalar(), which called String({}) = "[object Object]".
//     Fixed: apiYamlNode now recurses into any object (null excluded), and
//     apiOwnSchema omits the "properties" key entirely when no children are
//     selected (an empty object is not useful in an OpenAPI schema).
//
//  2. The "No se marcó ningún campo interno..." note was added to the
//     description when no children were selected. Now the note is simply
//     dropped: a clean "type: object" with only the field's definition (if
//     any) is emitted instead.
//
//  3. The SelectOneOf group note ("Grupo de elección N (SelectOneOf)…") was
//     appended to every leaf field's description. Users don't want this
//     implementation detail in their generated YAML; removed.

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

// Pull exactly the blocks the YAML path touches, leaving everything else stubbed.
const yamlBlock   = extract('function apiYamlScalar', 'function apiHighlightYamlScalar', 'apiYamlScalar/apiYamlNode/apiToYaml');
const appendBlock = extract('function apiAppendNote',  'function apiLeafSchema',          'apiAppendNote');
const leafBlock   = extract('function apiLeafSchema',  'function apiIsRequired',           'apiLeafSchema');
const ownBlock    = extract('function apiOwnSchema',   'function apiPropertySchema',       'apiOwnSchema');

// We only test the parts relevant to the reported bugs; schemaComponentInfo,
// apiNodeChain, apiFieldLabel, apiPropertySchema and the rest are not needed.
function makeSandbox(nodes, selectedMap) {
    const API_ENUM_INLINE_LIMIT = 20;
    const SchemaViewer = { nodes: new Map(nodes.map(n => [n.id, n])) };
    const ApiBuilder   = { selected: selectedMap };

    // Minimal stubs for helpers that apiOwnSchema calls but we don't exercise here.
    const apiUniqueKey        = (obj, name) => { const b = name || 'f'; let k = b, i = 2; while (k in obj) k = `${b}_${i++}`; return k; };
    const apiIsRequired       = node => Boolean(node.required);
    const apiFieldLabel       = node => node.name || node.id;
    // Returns a simple placeholder so apiOwnSchema can populate its properties map
    // without needing a fully wired recursive call.
    const apiPropertySchema   = (selNode) => (selNode.node.complex ? { type: 'object' } : { type: 'string' });
    const schemaComponentInfo = () => null;                          // treat all nodes as inline

    const built = new Function(
        'SchemaViewer', 'ApiBuilder', 'API_ENUM_INLINE_LIMIT',
        'apiUniqueKey', 'apiIsRequired', 'apiFieldLabel', 'apiPropertySchema', 'schemaComponentInfo',
        `${yamlBlock}\n${appendBlock}\n${leafBlock}\n${ownBlock}
        return { apiToYaml, apiOwnSchema, apiLeafSchema };`
    )(SchemaViewer, ApiBuilder, API_ENUM_INLINE_LIMIT,
      apiUniqueKey, apiIsRequired, apiFieldLabel, apiPropertySchema, schemaComponentInfo);

    return built;
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

const leaf = (id, overrides) => Object.assign(
    { id, complex: false, required: true, isOr: false, orGroup: 0, isArray: false,
      parentId: '', name: id, definition: '', typeInfo: { jsonType: 'string', jsonFormat: '', pattern: '',
      minLength: null, maxLength: null, length: null, fractionDigits: null,
      codes: [], datatypeName: '', totalDigits: null } },
    overrides
);
const complex = (id, overrides) => Object.assign(
    { id, complex: true, required: true, isOr: false, orGroup: 0, isArray: false,
      parentId: '', name: id, definition: '' },
    overrides
);

// ── Bug 1 & 2: un nodo complejo sin hijos seleccionados ───────────────────────
console.log('--- nodo complejo sin hijos seleccionados ---');
{
    const parent = complex('SchemeName', { definition: 'Name of the identification scheme.' });
    const { apiOwnSchema } = makeSandbox([parent], new Map());

    const selNode = { id: 'SchemeName', node: parent, children: new Map() };
    const schema = apiOwnSchema(selNode);

    expect('type sigue siendo object', schema.type, 'object');
    expect('description toma la definition del nodo', schema.description, 'Name of the identification scheme.');
    expect('NO aparece la clave "properties" cuando no hay hijos', 'properties' in schema, false);
    expect('NO aparece "required" cuando no hay hijos', 'required' in schema, false);
}

// ── Bug 1: el serializador YAML no produce "[object Object]" ─────────────────
console.log('\n--- el YAML de un objeto vacío es "{}", no "[object Object]" ---');
{
    const { apiToYaml } = makeSandbox([], new Map());
    const yaml = apiToYaml({ props: {} });
    expect('"props: {}" en lugar de "props: \\"[object Object]\\""',
        yaml.trim(), 'props: {}');
}

// ── El YAML de un objeto con hijos sigue funcionando ──────────────────────────
console.log('\n--- objeto con propiedades renderiza correctamente ---');
{
    const { apiToYaml } = makeSandbox([], new Map());
    const yaml = apiToYaml({ root: { a: 'uno', b: 2 } });
    // Must contain both keys
    expect('contiene a: uno', yaml.includes('a: uno'), true);
    expect('contiene b: 2',   yaml.includes('b: 2'),   true);
}

// ── Bug 2: ninguna nota "No se marcó" en la description ──────────────────────
console.log('\n--- ninguna nota "No se marcó" en la description ---');
{
    const parent = complex('SomeName', { definition: '' });
    const { apiOwnSchema } = makeSandbox([parent], new Map());
    const schema = apiOwnSchema({ id: 'SomeName', node: parent, children: new Map() });
    const hasNote = String(schema.description || '').includes('No se marcó');
    expect('description NO contiene la nota de campo sin propiedades', hasNote, false);
}

// ── Bug 3: la nota SelectOneOf ya no aparece en la description del leaf ───────
console.log('\n--- la nota SelectOneOf no aparece en la description del leaf ---');
{
    const orLeaf = leaf('AnyBIC', { isOr: true, orGroup: 1, definition: 'BIC del participante.' });
    const { apiLeafSchema } = makeSandbox([orLeaf], new Map());
    const schema = apiLeafSchema(orLeaf);
    const hasOrNote = String(schema.description || '').includes('SelectOneOf');
    expect('description NO contiene la nota SelectOneOf', hasOrNote, false);
    expect('description sí conserva la definition del nodo', schema.description, 'BIC del participante.');
}

// ── Un nodo SelectOneOf sin definition no genera description vacío ─────────────
console.log('\n--- SelectOneOf sin definition: sin description en el schema ---');
{
    const orLeaf = leaf('LEI', { isOr: true, orGroup: 1, definition: '' });
    const { apiLeafSchema } = makeSandbox([orLeaf], new Map());
    const schema = apiLeafSchema(orLeaf);
    expect('sin definition el campo description no aparece', 'description' in schema, false);
}

// ── Un nodo complejo con hijos sigue incluyendo properties y required ─────────
console.log('\n--- nodo complejo CON hijos: properties y required presentes ---');
{
    const parent  = complex('GroupHeader', { definition: '' });
    const child1  = leaf('MsgId', { required: true  });
    const child2  = leaf('NbOfTxs', { required: false });
    const { apiOwnSchema } = makeSandbox([parent, child1, child2], new Map());

    const childrenMap = new Map([
        ['MsgId',   { id: 'MsgId',   node: child1, children: new Map() }],
        ['NbOfTxs', { id: 'NbOfTxs', node: child2, children: new Map() }],
    ]);
    const selNode = { id: 'GroupHeader', node: parent, children: childrenMap };
    const schema = apiOwnSchema(selNode);

    expect('properties sí aparece cuando hay hijos', 'properties' in schema, true);
    expect('MsgId está en properties', 'MsgId' in schema.properties, true);
    expect('NbOfTxs está en properties', 'NbOfTxs' in schema.properties, true);
    expect('required incluye solo MsgId', schema.required, ['MsgId']);
}

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de YAML del generador OpenAPI pasaron');
process.exit(failures ? 1 : 0);
