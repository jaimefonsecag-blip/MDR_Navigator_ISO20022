// build-dist.js
//
// Genera dist/index.html a partir del index.html fuente:
//   1. Copia el HTML tal cual (CSS, markup y atributos intactos).
//   2. Extrae el bloque <script> embebido, lo ofusca con javascript-obfuscator
//      y lo reinserta, de modo que el resultado es funcionalmente idéntico
//      pero el código JS es prácticamente ilegible.
//
// Uso: node scripts/build-dist.js
// El archivo de salida (dist/index.html) es el que se sube a GitHub Pages.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const here   = dirname(fileURLToPath(import.meta.url));
const root   = join(here, '..');
const src    = join(root, 'index.html');
const outDir = join(root, 'dist');
const out    = join(outDir, 'index.html');

console.log('► Leyendo index.html …');
const html = readFileSync(src, 'utf8');

// Encuentra el único bloque <script> embebido (sin atributo src)
const scriptRe = /(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/;
const match = html.match(scriptRe);
if (!match) {
    console.error('No se encontró un bloque <script> embebido en index.html');
    process.exit(1);
}
const [full, openTag, jsCode, closeTag] = match;

console.log(`► JS encontrado: ${(jsCode.length / 1024).toFixed(0)} KB — ofuscando …`);

const result = JavaScriptObfuscator.obfuscate(jsCode, {
    // Ofuscación sólida sin inflar demasiado el archivo
    compact:                          true,
    identifierNamesGenerator:         'hexadecimal',
    renameGlobals:                    false,   // no renombrar variables globales (rompe event handlers)
    renameProperties:                 false,   // idem para propiedades de objetos
    simplify:                         true,

    // Transforma literales de string a un array cifrado en base64
    stringArray:                      true,
    stringArrayEncoding:              ['base64'],
    stringArrayCallsTransform:        true,
    stringArrayCallsTransformThreshold: 0.75,
    stringArrayIndexShift:            true,
    stringArrayRotate:                true,
    stringArrayShuffle:               true,
    stringArrayThreshold:             0.75,
    stringArrayWrappersCount:         2,
    stringArrayWrappersChainedCalls:  true,
    stringArrayWrappersType:          'function',

    // Opciones que aumentan mucho el tamaño — desactivadas
    controlFlowFlattening:            false,
    deadCodeInjection:                false,
    selfDefending:                    false,
    debugProtection:                  false,
    unicodeEscapeSequence:            false,
    numbersToExpressions:             false,

    target: 'browser',
});

const obfuscatedJs = result.getObfuscatedCode();
console.log(`► JS ofuscado: ${(obfuscatedJs.length / 1024).toFixed(0)} KB`);

const distHtml = html.replace(full, `${openTag}${obfuscatedJs}${closeTag}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(out, distHtml, 'utf8');

const kb = (distHtml.length / 1024).toFixed(0);
console.log(`\n✓ dist/index.html generado (${kb} KB)`);
console.log('  → Este es el archivo que subes a GitHub Pages / compartes con usuarios.');
console.log('  → El código fuente legible sigue en index.html (mantenlo en repo privado).');
