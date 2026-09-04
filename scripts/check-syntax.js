// Extracts the inline <script> from the navigator and parses it, so a syntax
// error is caught here instead of silently killing every handler in the browser.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'index.html');
const html = readFileSync(target, 'utf8');

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) {
    console.error('No inline <script> block found in index.html');
    process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'mdr-check-'));
let failed = false;

blocks.forEach((block, index) => {
    const code = block[1];
    const file = join(dir, `block-${index + 1}.js`);
    writeFileSync(file, code, 'utf8');
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log(`inline script #${index + 1}: OK (${code.length} chars)`);
    } catch (error) {
        failed = true;
        const output = `${error.stdout || ''}${error.stderr || ''}`;
        console.error(`inline script #${index + 1}: SYNTAX ERROR`);
        console.error(output.toString());
    }
});

process.exit(failed ? 1 : 0);
