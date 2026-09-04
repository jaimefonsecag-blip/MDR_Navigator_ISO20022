// Reads the real ISO external code sets workbook with the page's own parser, so a
// change in the published layout (renamed sheet, reordered columns) is caught here
// instead of leaving every external CodeSet empty in the browser.
// SheetJS only runs in the browser, so the sheet is turned into the same
// rows-of-arrays shape it produces and fed through the page's functions.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

// The copy published with the page is the one to verify: it is what every visitor
// downloads. A local quarterly download is only the fallback for this check.
const PUBLISHED = 'external-codesets.xlsx';
const workbookFile = existsSync(join(root, PUBLISHED))
    ? PUBLISHED
    : (readdirSync(root).find(name => /external[-_]?codesets.*\.xlsx$/i.test(name)) || '');
if (!workbookFile) {
    console.log('SKIP: no hay Excel de codigos externos en el workspace');
    process.exit(0);
}

// ===== minimal zip reader: an .xlsx is a zip of XML parts =====
function readZipEntries(buffer) {
    const entries = new Map();
    let at = 0;
    for (;;) {
        at = buffer.indexOf('PK\u0003\u0004', at, 'latin1');
        if (at === -1) break;
        const method = buffer.readUInt16LE(at + 8);
        const compressed = buffer.readUInt32LE(at + 18);
        const nameLength = buffer.readUInt16LE(at + 26);
        const extraLength = buffer.readUInt16LE(at + 28);
        const name = buffer.subarray(at + 30, at + 30 + nameLength).toString('latin1');
        const start = at + 30 + nameLength + extraLength;
        if (compressed > 0) {
            const raw = buffer.subarray(start, start + compressed);
            try {
                entries.set(name, method === 8 ? inflateRawSync(raw).toString('utf8') : raw.toString('utf8'));
            } catch { /* not needed for this check */ }
        }
        at = start + compressed;
    }
    return entries;
}

const zip = readZipEntries(readFileSync(join(root, workbookFile)));
const decode = value => String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const sharedStrings = [...(zip.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(([, body]) => decode([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')));

const columnIndex = letters => [...letters].reduce((sum, letter) =>
    sum * 26 + (letter.charCodeAt(0) - 64), 0) - 1;

// One sheet -> rows of arrays, exactly what XLSX.utils.sheet_to_json({header:1}) gives.
function sheetRows(path) {
    const xml = zip.get(path) || '';
    return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(([, body]) => {
        const cells = [];
        [...body.matchAll(/<c[^>]*r="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)].forEach(([cell, letters]) => {
            const type = (cell.match(/\st="([^"]+)"/) || [])[1] || 'n';
            const raw = (cell.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
            let value = '';
            if (type === 's') value = sharedStrings[Number(raw)] ?? '';
            else if (type === 'inlineStr') value = decode([...cell.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
            else if (raw !== undefined) value = decode(raw);
            cells[columnIndex(letters)] = value;
        });
        for (let index = 0; index < cells.length; index++) if (cells[index] === undefined) cells[index] = '';
        return cells;
    });
}

// Sheet name -> part, from the workbook and its relationships.
const rels = new Map([...(zip.get('xl/_rels/workbook.xml.rels') || '')
    .matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(([, id, target]) => [id, target.replace(/^\/?/, '')]));
const sheetNames = [];
const sheetsByName = new Map();
[...(zip.get('xl/workbook.xml') || '').matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)]
    .forEach(([, name, rid]) => {
        const target = rels.get(rid) || '';
        sheetNames.push(decode(name));
        sheetsByName.set(decode(name), `xl/${target.replace(/^\.\.\//, '')}`);
    });

// The stub the page's parser talks to.
const rowsCache = new Map();
const XLSX = {
    SheetNames: sheetNames,
    Sheets: Object.fromEntries(sheetNames.map(name => [name, { __name: name }])),
    utils: {
        sheet_to_json(sheet) {
            const name = sheet.__name;
            if (!rowsCache.has(name)) rowsCache.set(name, sheetRows(sheetsByName.get(name)));
            return rowsCache.get(name);
        }
    }
};

const block = script.slice(
    script.indexOf('// ===== EXTERNAL CODE SETS'),
    script.indexOf('// ===== DOM REFERENCES ====='));
const api = new Function('XLSX', 'MDR', 'normalizeCatalogName', 'escapeHtml', 'libAvailable',
    'document', 'location', 'fetch', '$navScreen', 'navigateToMessage', `${block}
return { parseExternalCodeSets, externalCodesColumnMap, externalCodesPublication,
         EXTERNAL_CODES_PUBLISHED_FILE };`)(
    XLSX,
    { externalCodeSets: { loaded: false, byName: new Map() }, codeSetsByName: {}, currentMessage: null },
    value => String(value || '').replace(/\s+/g, '').toLowerCase(),
    String, () => true,
    { getElementById: () => null }, { protocol: 'file:' }, () => Promise.reject(new Error('sin red')),
    { classList: { contains: () => true } }, () => {});

let failures = 0;
const expect = (label, ok, detail) => {
    if (ok) { console.log(`PASS  ${label}`); return; }
    failures++;
    console.log(`FAIL  ${label}${detail === undefined ? '' : ` -> ${detail}`}`);
};

console.log(`=== ${workbookFile} ===`);
console.log(`  hojas: ${sheetNames.join(', ')}`);

expect('el libro trae la hoja AllCodeSets',
    sheetNames.some(name => name.replace(/\s+/g, '').toLowerCase() === 'allcodesets'), sheetNames.join('|'));

const parsed = api.parseExternalCodeSets(XLSX);
console.log(`  code sets: ${parsed.sets} | codigos: ${parsed.codes} | hoja: ${parsed.sheetName}`);
expect('lee la hoja AllCodeSets', parsed.sheetName === 'AllCodeSets', parsed.sheetName);
expect('encuentra los code sets (>100)', parsed.sets > 100, parsed.sets);
expect('encuentra los codigos (>3000)', parsed.codes > 3000, parsed.codes);

// The case the user asked for.
const account = parsed.byName.get('externalaccountidentification1code');
expect('mapea ExternalAccountIdentification1Code', Boolean(account));
if (account) {
    console.log(`      ${account.name}: ${account.codes.map(code => code.code).join(', ')}`);
    expect('  trae sus 4 codigos', account.codes.length === 4, account.codes.length);
    expect('  con el valor en la columna B',
        account.codes.map(code => code.code).join(',') === 'AIIN,BBAN,CUID,UPIC',
        account.codes.map(code => code.code).join(','));
    expect('  con nombre y definicion',
        account.codes.every(code => code.name && code.definition),
        JSON.stringify(account.codes[0]));
    expect('  queda marcado como externo y proveniente del Excel',
        account.external === true && account.fromExternalFile === true);
}

// A code set the MDR of Payments needs.
const purpose = parsed.byName.get('externalpurpose1code');
expect('mapea ExternalPurpose1Code', Boolean(purpose) && purpose.codes.length > 50,
    purpose ? purpose.codes.length : 'no esta');

// ISO retires values: showing an obsolete code as usable would be wrong.
const obsolete = [...parsed.byName.values()].flatMap(set => set.codes)
    .filter(code => /obsolete/i.test(code.status));
expect('conserva el estado de los codigos retirados', obsolete.length > 0, obsolete.length);
const replaced = [...parsed.byName.values()].flatMap(set => set.codes).filter(code => code.replacedBy);
expect('conserva el codigo que reemplaza al retirado', replaced.length > 0, replaced.length);

expect('lee la fecha de publicacion del libro',
    /\d{4}/.test(api.externalCodesPublication(XLSX)), api.externalCodesPublication(XLSX));

console.log('\n=== mapeo de columnas ===');
const byHeader = api.externalCodesColumnMap(['Code Set', 'Code Value', 'Code Name', 'Code Definition', 'Requester', 'Status', 'Last Update', 'Creation Date', 'Replaced By']);
expect('reconoce las columnas por su encabezado',
    byHeader.set === 0 && byHeader.code === 1 && byHeader.name === 2
    && byHeader.definition === 3 && byHeader.status === 5 && byHeader.replacedBy === 8,
    JSON.stringify(byHeader));
const reordered = api.externalCodesColumnMap(['Status', 'Code Definition', 'Code Set', 'Code Value']);
expect('sigue las columnas si ISO las reordena',
    reordered.set === 2 && reordered.code === 3 && reordered.definition === 1 && reordered.status === 0,
    JSON.stringify(reordered));
const unknown = api.externalCodesColumnMap(['algo', 'otra cosa']);
expect('sin encabezados reconocibles usa A y B',
    unknown.set === 0 && unknown.code === 1, JSON.stringify(unknown));

console.log('\n=== publicacion junto a la pagina ===');
expect('el nombre que la pagina busca sola es fijo',
    api.EXTERNAL_CODES_PUBLISHED_FILE === 'external-codesets.xlsx', api.EXTERNAL_CODES_PUBLISHED_FILE);

// A file:// page cannot fetch its neighbours, so the attempt must be conditional
// and silent: it is an optional convenience, never an error to report.
const autoBody = script.slice(script.indexOf('async function autoLoadPublishedExternalCodes'),
    script.indexOf('// Fills in the values of every external CodeSet'));
expect('solo intenta la carga automatica sobre http(s)', /location\.protocol/.test(autoBody));
expect('no vuelve a cargar si ya hay codigos', /if \(MDR\.externalCodeSets\.loaded\) return;/.test(autoBody));
// The workbook is replaced every quarter: a cache that never revalidates would
// keep serving the old codes for ever.
expect('no fija la cache del libro trimestral',
    !/cache:\s*['"](?:force-cache|only-if-cached)['"]/.test(autoBody),
    (autoBody.match(/cache:\s*['"][^'"]+['"]/) || [])[0]);

expect('la copia publicada esta en el repo', workbookFile === PUBLISHED,
    `se verifico ${workbookFile}`);
const gitignore = existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8') : '';
expect('el .gitignore publica esa copia y no las demas',
    /^\*\.xlsx$/m.test(gitignore) && /^!external-codesets\.xlsx$/m.test(gitignore));

console.log('\n=== no es un paso de la interfaz ===');
const markup = html.slice(0, html.indexOf('<script>\n// ==='));
expect('la pantalla de carga no pide el Excel',
    !/id="externalCodesPanel"/.test(markup) && !/id="dropZoneExternalCodes"/.test(markup));
expect('el selector de archivo existe pero fuera de la interfaz',
    /id="fileInputExternalCodes"[^>]*class="input-offscreen"/.test(markup));
expect('nadie busca ya el estado que se quito',
    !/getElementById\('externalCodesState'\)/.test(script));

console.log('\n=== donde se usan los codigos ===');
const body = name => {
    const at = script.indexOf(`function ${name}(`);
    if (at === -1) return '';
    let depth = 0;
    let start = -1;
    for (let index = script.indexOf('{', at); index < script.length; index++) {
        if (script[index] === '{') { if (depth === 0) start = index; depth++; }
        else if (script[index] === '}') { depth--; if (depth === 0) return script.slice(start, index + 1); }
    }
    return '';
};
expect('el arbol JSON consulta los codigos externos',
    body('schemaCodeSetFor').includes('externalCodeSetFor('));
expect('el panel de detalle del CodeSet los consulta',
    body('showCodeSet').includes('externalCodeSetFor('));
expect('un campo cuyo CodeSet no resolvio el MDR los consulta',
    body('showCodeSetForElement').includes('externalCodeSetFor('));
expect('el MDR ya cargado se rellena al llegar el Excel',
    body('loadExternalCodeSetsFromBuffer').includes('hydrateExternalCodeSets()'));
expect('un MDR cargado despues tambien se rellena',
    /resolveCodeSetMappings\(\);[\s\S]{0,200}hydrateExternalCodeSets\(\);/.test(script));
expect('los valores del Excel no se confunden con los del MDR',
    body('hydrateExternalCodeSets').includes('fromExternalFile = true'));
expect('la tabla de codigos marca los retirados',
    body('codeTableHtml').includes('is-obsolete') && body('codeTableHtml').includes('replacedBy'));

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de codigos externos pasaron');
process.exit(failures ? 1 : 0);
