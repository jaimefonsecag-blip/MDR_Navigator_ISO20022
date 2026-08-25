// resetMdrState() must clear every accumulator the parser writes into. If a new
// field is added to the MDR store and forgotten here, a second MDR would be
// merged into the first one, so the two lists are compared statically.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

// Top-level keys of `const MDR = { ... }`.
const storeStart = script.indexOf('const MDR = {');
const storeBody = script.slice(storeStart, script.indexOf('\n};', storeStart));
const storeKeys = [];
let depth = 0;
storeBody.split('\n').slice(1).forEach(line => {
    const key = depth === 0 && line.match(/^\s{4}([A-Za-z_$][\w$]*)\s*:/);
    if (key) storeKeys.push(key[1]);
    depth += (line.match(/[{[]/g) || []).length - (line.match(/[}\]]/g) || []).length;
});

const resetStart = script.indexOf('function resetMdrState()');
const resetBody = script.slice(resetStart, script.indexOf('\n}', resetStart));

// Fields intentionally preserved across loads, with the reason.
const PRESERVED = {
    translation: 'the translated-text cache is reused on purpose; its queue is drained explicitly'
};

// Part 1 holds blob URLs for the diagrams; not revoking them leaks memory for
// the whole session, so the reset is verified separately.
const part1Start = script.indexOf('const PART1 = {');
const part1Body = script.slice(part1Start, script.indexOf('\n};', part1Start));
const part1Keys = [];
part1Body.split('\n').slice(1).forEach(line => {
    const key = line.match(/^\s{4}([A-Za-z_$][\w$]*)\s*:/);
    if (key) part1Keys.push(key[1]);
});
const part1Missing = part1Keys.filter(key => !resetBody.includes(`PART1.${key}`));
if (part1Missing.length) {
    console.error(`\nresetMdrState() does NOT clear: ${part1Missing.map(k => `PART1.${k}`).join(', ')}`);
    process.exit(1);
}
if (!resetBody.includes('revokeObjectURL')) {
    console.error('\nresetMdrState() never revokes the Part 1 diagram blob URLs');
    process.exit(1);
}
console.log(`PART1 fields cleared: ${part1Keys.length} (${part1Keys.join(', ')})`);

const missing = storeKeys.filter(key => !PRESERVED[key] && !resetBody.includes(`MDR.${key}`));

console.log(`MDR store fields: ${storeKeys.length} (${storeKeys.join(', ')})`);
console.log(`preserved on purpose: ${Object.keys(PRESERVED).join(', ') || 'none'}`);

if (missing.length) {
    console.error('\nresetMdrState() does NOT clear:');
    missing.forEach(key => console.error(`  - MDR.${key}`));
    process.exit(1);
}

// The translation queue must still be drained even though the cache is kept.
const drains = ['generation', 'queue', 'active', 'pending', 'failed', 'inFlight']
    .filter(field => !resetBody.includes(field));
if (drains.length) {
    console.error(`\nresetMdrState() leaves translation state dirty: ${drains.join(', ')}`);
    process.exit(1);
}

console.log('resetMdrState() clears every parser accumulator');
