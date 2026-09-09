// A 5000+ page Part 2 (Investment Funds) used to take a very long time to
// parse. Two spots turned into O(n^2)/O(n*m) scans as the document grew:
// registerBlockDefinition()/getBlockDefinition() did a linear .find() by id
// over an ever-growing array, and findDetailedElementDefinition() re-filtered
// and re-scored the ENTIRE block-definition catalogue for every CodeSet
// element in the document. Both were rewritten to use Maps built once and
// reused, and this check proves the indexed versions return exactly what the
// original full-scan logic would have, so the optimization never trades
// correctness for speed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

const start = script.indexOf('function normalizeCatalogName');
const end = script.indexOf('// Fallback when no detailed subsection resolves the datatype');
if (start === -1 || end === -1) {
    console.error('No se encontro el bloque de indexacion de definiciones en index.html');
    process.exit(1);
}
const block = script.slice(start, end);

const MDR = { blockDefinitions: [] };
const api = new Function('MDR', `${block}
return {
    normalizeCatalogName, catalogBaseName,
    registerBlockDefinition, getBlockDefinition,
    datatypeDefinitionIndex, findDetailedElementDefinition,
    blockDefinitionsById: () => BLOCK_DEFINITIONS_BY_ID
};`)(MDR);

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

// ===== registerBlockDefinition() / getBlockDefinition() =====
console.log('--- indice de building blocks por id ---');
MDR.blockDefinitions = [];
const first = api.registerBlockDefinition('6.1', 'Party', 'Pty', 12);
const again = api.registerBlockDefinition('6.1', 'Party', 'Pty', 12);
expect('la misma cabecera no duplica la entrada', MDR.blockDefinitions.length, 1);
expect('devuelve el mismo objeto la segunda vez', again === first, true);

const other = api.registerBlockDefinition('6.1', 'Party', 'Pty', 13);
expect('una pagina distinta si es una entrada nueva', MDR.blockDefinitions.length, 2);
expect('son objetos distintos', other === first, false);

expect('getBlockDefinition encuentra por id', api.getBlockDefinition(first.id) === first, true);
expect('getBlockDefinition no inventa nada para un id desconocido',
    api.getBlockDefinition('no-existe|0|x|y'), null);
expect('el mapa queda en sincronia con el arreglo',
    api.blockDefinitionsById().size, MDR.blockDefinitions.length);

// ===== findDetailedElementDefinition(): equivalence fuzz test =====
// bruteForceFind reproduces the pre-optimization algorithm exactly (a full
// scan of every definition, scored the same way) so it can serve as the
// reference the indexed version must match on randomized inputs.
function bruteForceFind(element, definitions) {
    const elementName = api.normalizeCatalogName(element.name);
    const elementBase = api.catalogBaseName(element.name);
    const elementTag = String(element.tag || '').toLowerCase();
    const detailPage = String(element.refPage || element.page || '');

    const scoredAll = definitions
        .filter(definition => definition.datatypeName)
        .map(definition => {
            const definitionName = api.normalizeCatalogName(definition.name);
            const definitionBase = api.catalogBaseName(definition.name);
            const definitionTag = String(definition.tag || '').toLowerCase();
            const nameMatch = Boolean(elementName && definitionName && elementName === definitionName);
            const baseMatch = Boolean(elementBase && definitionBase && elementBase === definitionBase);
            const tagMatch = Boolean(elementTag && definitionTag && elementTag === definitionTag);
            const pageMatch = Boolean(detailPage) && String(definition.page) === detailPage;
            const nearPageMatch = Boolean(detailPage) &&
                Math.abs(Number(definition.page) - Number(detailPage)) === 1;
            return {
                definition, pageMatch, nearPageMatch,
                score: (pageMatch ? 130 : 0) + (nearPageMatch ? 90 : 0) + (tagMatch ? 70 : 0) + (nameMatch ? 80 : 0) + (baseMatch ? 40 : 0),
                matches: (nameMatch || tagMatch)
            };
        }).filter(item => item.matches).sort((left, right) => right.score - left.score);

    const pageAware = scoredAll.filter(item => item.pageMatch || item.nearPageMatch);
    const scored = detailPage && pageAware.length ? pageAware : (detailPage ? [] : scoredAll);
    return scored.length ? scored[0].definition : null;
}

console.log('\n--- resolucion de datatype: version indexada vs escaneo completo ---');

const NAME_POOL = ['Code', 'Type', 'Purpose', 'Status', 'Reason', 'PurposeCode', 'Purpose1Code',
    'CashAccountType1Code', 'ExternalPurpose1Code', 'Identification', 'Amount', 'Date'];
const TAG_POOL = ['Cd', 'Tp', 'Purp', 'Sts', 'Rsn', 'Id', 'Amt', 'Dt', ''];
const SECTION_POOL = ['6.1', '6.2', '7.3.1', ''];

function pick(pool, rnd) { return pool[Math.floor(rnd() * pool.length)]; }

function makeRng(seed) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

const rnd = makeRng(20260909);
let mismatches = 0;
const FUZZ_ROUNDS = 400;
for (let round = 0; round < FUZZ_ROUNDS; round++) {
    const count = 1 + Math.floor(rnd() * 30);
    const definitions = [];
    for (let i = 0; i < count; i++) {
        const hasDatatype = rnd() > 0.15;
        definitions.push({
            name: pick(NAME_POOL, rnd),
            tag: pick(TAG_POOL, rnd),
            page: 1 + Math.floor(rnd() * 25),
            section: pick(SECTION_POOL, rnd),
            datatypeName: hasDatatype ? `Datatype${Math.floor(rnd() * 5)}` : ''
        });
    }
    const element = {
        name: pick(NAME_POOL, rnd),
        tag: pick(TAG_POOL, rnd),
        page: 1 + Math.floor(rnd() * 25),
        refPage: rnd() > 0.5 ? (1 + Math.floor(rnd() * 25)) : undefined
    };

    MDR.blockDefinitions = definitions;
    const indexed = api.findDetailedElementDefinition(element);
    const brute = bruteForceFind(element, definitions);
    if (indexed !== brute) {
        mismatches++;
        if (mismatches <= 3) {
            console.log(`FAIL  ronda ${round}: la version indexada difiere del escaneo completo`);
            console.log(`      elemento: ${JSON.stringify(element)}`);
            console.log(`      indexado: ${JSON.stringify(indexed)}`);
            console.log(`      escaneo : ${JSON.stringify(brute)}`);
        }
    }
}
expect(`${FUZZ_ROUNDS} casos aleatorios coinciden con el escaneo completo`, mismatches, 0);

// The index is rebuilt lazily; a definition appended after the first lookup
// (same array, same reference, longer now) must be picked up on the next call.
console.log('\n--- el indice se reconstruye cuando cambian las definiciones ---');
const growable = [{ name: 'Purpose', tag: 'Purp', page: 4, section: '', datatypeName: 'DatatypeA' }];
MDR.blockDefinitions = growable;
const beforeGrow = api.findDetailedElementDefinition({ name: 'Reason', tag: 'Rsn' });
expect('sin coincidencia todavia no encuentra nada', beforeGrow, null);
growable.push({ name: 'Reason', tag: 'Rsn', page: 9, section: '', datatypeName: 'DatatypeB' });
const afterGrow = api.findDetailedElementDefinition({ name: 'Reason', tag: 'Rsn' });
expect('tras agregar la definicion si la encuentra', Boolean(afterGrow) && afterGrow.datatypeName === 'DatatypeB', true);

// A definition without a datatypeName must never win, indexed or not.
console.log('\n--- filtros de exclusion ---');
MDR.blockDefinitions = [{ name: 'Purpose', tag: 'Purp', page: 1, section: '', datatypeName: '' }];
expect('una definicion sin datatype nunca es candidata',
    api.findDetailedElementDefinition({ name: 'Purpose', tag: 'Purp' }), null);

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de rendimiento del PDF pasaron');
process.exit(failures ? 1 : 0);
