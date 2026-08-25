// The navigator wires its UI through inline on* attributes, including ones built
// inside template strings. A handler naming a function that does not exist only
// fails when the user clicks it, so it is verified statically here.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

const declared = new Set();
for (const match of script.matchAll(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) declared.add(match[1]);
for (const match of script.matchAll(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(match[1]);

const ALLOWED = new Set(['event', 'window', 'document', 'console', 'alert', 'Number', 'String', 'Boolean', 'if']);

// 1. Every function named by an inline handler must be declared.
const calls = new Map();
for (const match of html.matchAll(/\son[a-z]+\s*=\s*(["'])([\s\S]*?)\1/g)) {
    // The lookbehind skips method calls such as event.preventDefault().
    for (const call of match[2].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = call[1];
        if (ALLOWED.has(name)) continue;
        calls.set(name, (calls.get(name) || 0) + 1);
    }
}
const missingFns = [...calls.keys()].filter(name => !declared.has(name)).sort();

// 2. Every schema* / MDR helper the script calls must be declared too, which
//    catches leftovers after removing a feature.
const referenced = new Map();
for (const match of script.matchAll(/(?<![.\w$])((?:schema|Schema)[A-Za-z_$][\w$]*)\s*\(/g)) {
    referenced.set(match[1], (referenced.get(match[1]) || 0) + 1);
}
const missingHelpers = [...referenced.keys()].filter(name => !declared.has(name)).sort();

// 3. Cached DOM references ($name) must be declared. A renamed element left
//    goHome() calling a removed $fileInput, which threw and silently stopped the
//    upload cards from being reset.
const declaredRefs = new Set(
    [...script.matchAll(/\bconst\s+(\$[A-Za-z_][\w$]*)\s*=/g)].map(match => match[1]));
const usedRefs = new Map();
for (const match of script.matchAll(/(?<![.\w$])(\$[A-Za-z_][\w$]*)\b/g)) {
    usedRefs.set(match[1], (usedRefs.get(match[1]) || 0) + 1);
}
const missingRefs = [...usedRefs.keys()].filter(name => !declaredRefs.has(name)).sort();

// 4. Element ids the script reads must exist in the markup.
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
const lookedUp = new Set([...script.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map(match => match[1]));
const missingIds = [...lookedUp].filter(id => !ids.has(id)).sort();

console.log(`inline handlers -> ${calls.size} distinct functions`);
console.log(`schema helpers called -> ${referenced.size}`);
console.log(`cached DOM refs used -> ${usedRefs.size} (declared ${declaredRefs.size})`);
console.log(`element ids looked up -> ${lookedUp.size}`);

let failed = false;
const report = (label, list, format) => {
    if (!list.length) return;
    failed = true;
    console.error(`\n${label}`);
    list.forEach(item => console.error(`  - ${format(item)}`));
};
report('MISSING functions used by inline handlers (ReferenceError on click):',
    missingFns, name => `${name}()  used ${calls.get(name)}x`);
report('MISSING schema helpers still referenced by the script:',
    missingHelpers, name => `${name}()  used ${referenced.get(name)}x`);
report('UNDECLARED DOM references (ReferenceError at runtime):',
    missingRefs, name => `${name}  used ${usedRefs.get(name)}x`);
report('MISSING element ids in the markup:', missingIds, id => `#${id}`);

if (!failed) console.log('\nall inline handlers, schema helpers and element ids resolve');
process.exit(failed ? 1 : 0);
