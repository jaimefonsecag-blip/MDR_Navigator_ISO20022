// The combined workspace puts the business half and the technical half on the
// same screen, each in its own container. That only holds if every renderer writes
// into its own pane: a single leftover $contentPanel in a Part 1 renderer would
// make the Word overwrite the structure of the message. The wiring is verified
// statically, since it cannot be exercised without a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';
const markup = html.slice(0, html.indexOf('<script>\n// ==='));

let failures = 0;
const expect = (label, ok, detail) => {
    if (ok) { console.log(`PASS  ${label}`); return; }
    failures++;
    console.log(`FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
};

// Body of a top-level function declaration, by brace matching.
function bodyOf(name) {
    const at = script.indexOf(`function ${name}(`);
    if (at === -1) return '';
    let depth = 0;
    let start = -1;
    for (let index = script.indexOf('{', at); index < script.length; index++) {
        const char = script[index];
        if (char === '{') { if (depth === 0) start = index; depth++; }
        else if (char === '}') { depth--; if (depth === 0) return script.slice(start, index + 1); }
    }
    return '';
}

console.log('=== estructura de la pantalla ===');
const panes = ['workspace', 'bizPane', 'techPane', 'part1Panel', 'contentPanel', 'bizCrumb', 'techCrumb'];
panes.forEach(id => expect(`existe #${id}`, markup.includes(`id="${id}"`)));
const techPaneAt = markup.indexOf('id="techPane"');
const contentAt = markup.indexOf('id="contentPanel"');
const bizPaneAt = markup.indexOf('id="bizPane"');
const part1At = markup.indexOf('id="part1Panel"');
expect('#contentPanel vive dentro de #techPane', techPaneAt !== -1 && contentAt > techPaneAt);
expect('#part1Panel vive dentro de #bizPane', bizPaneAt !== -1 && part1At > bizPaneAt);
expect('el negocio queda a la izquierda del tecnico', bizPaneAt < techPaneAt);
expect('el panel de negocio arranca oculto (un solo documento)',
    /id="bizPane"[^>]*class="[^"]*hidden/.test(markup));

console.log('\n=== cada mitad escribe en su propio panel ===');
const part1Renderers = ['showPart1Overview', 'openPart1Section'];
part1Renderers.forEach(name => {
    const body = bodyOf(name);
    expect(`${name}() existe`, Boolean(body));
    expect(`  ${name}() pinta en partPanel(1)`, body.includes('partPanel(1).innerHTML'));
    expect(`  ${name}() no toca $contentPanel`, !body.includes('$contentPanel'),
        'el Word sobreescribiria la vista tecnica');
    expect(`  ${name}() usa su propio rastro`, body.includes('partCrumb(1)'));
    expect(`  ${name}() no toca $breadcrumb`, !body.includes('$breadcrumb'));
    expect(`  ${name}() traduce su panel`, body.includes('applyTranslationToContainer(partPanel(1))'));
});
const messageBody = bodyOf('navigateToMessage');
expect('navigateToMessage() usa el rastro de la mitad tecnica', messageBody.includes('partCrumb(2)'));
expect('navigateToMessage() no escribe en el rastro comun', !messageBody.includes('$breadcrumb'));
expect('el traductor alcanza las dos mitades',
    bodyOf('translationTargets').includes('part1Panel'));

console.log('\n=== la pestaña unica no vuelve a partirse ===');
const switchBody = bodyOf('setNavPart');
expect('setNavPart() no reemplaza el contenido cuando la pantalla esta partida',
    switchBody.includes('Workspace.split'), 'volveria a comportarse como dos pestañas');
expect('showNavigator() aplica el modo antes de pintar',
    bodyOf('showNavigator').includes('applyWorkspaceMode()'));
expect('showNavigator() abre la vista combinada con las dos partes',
    bodyOf('showNavigator').includes('openCombinedWorkspace()'));
// Un solo documento sigue abriendose solo: la vista combinada no es un requisito.
expect('con un solo documento abre la parte cargada',
    /setNavPart\(availability\[2\] \? 2 : 1\)/.test(bodyOf('showNavigator')));
expect('el navegador se habilita con una sola parte cargada',
    /state !== 'none'/.test(bodyOf('refreshOpenNavigatorButton')));
expect('solo se bloquea si hay dos partes incompatibles',
    /state === 'both' && !PAIRING\.compatible/.test(bodyOf('refreshOpenNavigatorButton')));
expect('goHome() devuelve la pantalla a un solo panel',
    bodyOf('goHome').includes('applyWorkspaceMode()'));
expect('splitActive() exige las dos partes cargadas',
    /availability\[1\]/.test(bodyOf('splitActive')) && /availability\[2\]/.test(bodyOf('splitActive')));

console.log('\n=== sincronizacion entre mitades ===');
['syncBusinessToMessage', 'syncMessageToSection'].forEach(name => {
    const body = bodyOf(name);
    expect(`${name}() existe`, Boolean(body));
    expect(`  ${name}() se protege del bucle`,
        body.includes('Workspace.syncing') && body.includes('Workspace.syncing = true')
        && body.includes('Workspace.syncing = false'));
    expect(`  ${name}() solo actua con la pantalla partida`, body.includes('!Workspace.split'));
});
expect('abrir un mensaje trae su seccion de negocio',
    messageBody.includes('syncBusinessToMessage('));
expect('abrir una seccion trae la estructura del mensaje',
    bodyOf('openPart1Section').includes('syncMessageToSection('));

console.log('\n=== la pantalla de carga cabe y se puede recorrer ===');
const styles = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const uploadRule = (styles.match(/#uploadScreen \{[^}]*\}/) || [''])[0];
// Con overflow:hidden el boton "Abrir el navegador" quedaba fuera de la pantalla en
// un portatil y no habia forma de llegar a el sin reducir el zoom.
expect('la pantalla de carga no recorta su contenido',
    !/overflow:\s*hidden/.test(uploadRule), uploadRule);
expect('se puede desplazar en vertical', /overflow-y:\s*auto/.test(uploadRule), uploadRule);
// Centrar con align-items:center recorta la parte de arriba cuando no cabe.
expect('centra sin recortar (margin:auto en el contenedor)',
    /\.upload-container \{[^}]*margin:auto/.test(styles));
expect('el boton de abrir acompana el borde inferior',
    /\.btn-open-nav:not\(\.hidden\) \{[^}]*position:sticky/.test(styles));
expect('hay ajuste para pantallas bajas', /@media \(max-height: 860px\)/.test(styles));
expect('el boton se trae a la vista al quedar listo',
    bodyOf('refreshOpenNavigatorButton').includes('scrollIntoView'));

console.log('\n=== traduccion de las dos mitades ===');
const selectorsAt = script.indexOf('const TRANSLATABLE_SELECTORS');
const selectors = script.slice(selectorsAt, script.indexOf('].join', selectorsAt));
expect('el boton de traducir alcanza los dos paneles',
    bodyOf('translationTargets').includes('contentPanel')
    && bodyOf('translationTargets').includes('part1Panel'));
expect('el reintento vuelve a recorrer los dos paneles',
    bodyOf('retryFailedTranslations').includes('translationTargets()'));
expect('el observador vigila el scroll de las dos mitades',
    /'mainContent', 'contentPanel', 'part1Panel'/.test(bodyOf('initTranslationObserver')));
// A rate limit used to consume the attempts of each text and leave half the
// screen in English until the user pressed "Reintentar".
expect('la cola espera el limite de la API en vez de gastar intentos',
    bodyOf('drainTranslationQueue').includes('translationCooldownMs() > 0')
    && bodyOf('drainTranslationQueue').includes('scheduleTranslationWake()'));
expect('la espera se reanuda sola', bodyOf('scheduleTranslationWake').includes('drainTranslationQueue()'));
expect('apagar la traduccion cancela la espera',
    bodyOf('toggleTranslation').includes('cancelTranslationWake()'));
expect('los textos sin prosa no entran en la cola',
    bodyOf('enqueueTranslationNode').includes('hasTranslatableProse'));
[['.p1-text', 'prosa del Word'], ['.p1-table tbody td', 'celdas de tabla'],
 ['.p1-step-title', 'pasos del flujo'], ['.bc-steps li strong', 'pasos en la vista tecnica'],
 ['.scope-usage-text', 'alcance y uso'], ['.definition-text', 'definiciones tecnicas'],
 // El panel de contenido del Word: titulo de la seccion, su indice y sus apartados.
 ['.p1-section-title', 'titulo de la seccion del Word'],
 ['#p1Tree .bb-name', 'titulos del indice del Word'],
 ['.p1-child-name', 'apartados de la seccion'],
 ['.p1-table thead th', 'encabezados de las tablas del Word']
].forEach(([selector, what]) =>
    expect(`  traduce ${what} (${selector})`, selectors.includes(selector)));
expect('  la columna "Rol" del navegador no se traduce',
    selectors.includes('.p1-table thead th:not(.p1-role-col)'));
// El indice lateral se repinta en cada navegacion: traducirlo encolaria sus
// cientos de titulos una y otra vez.
expect('  el indice lateral queda fuera', !selectors.includes('.p1-outline-item'));
// The definition the PDF lends to the Word travels with a translatable class.
expect('  traduce la definicion del PDF mostrada en el Word',
    /class="tb-def scope-usage-text"/.test(bodyOf('renderTechnicalBridgePanel')));
expect('las etiquetas escritas por el navegador quedan fuera',
    selectors.includes(':not(.is-role)') && !selectors.includes('.mdr-role-tag')
    && !selectors.includes('.p1-concept'));

console.log('\n=== enlaces entre las dos mitades ===');
expect('los enlaces del contexto de negocio abren la seccion, no el indice',
    !/openPart1Section\('\$\{[^}]+\}'\);setNavPart\(1\)/.test(script),
    'setNavPart(1) volveria a pintar la portada encima de la seccion');
expect('existe el punto de entrada unico showBusinessSection()',
    Boolean(bodyOf('showBusinessSection')));
expect('jumpToPart2() no cambia de parte cuando ya se ven las dos',
    bodyOf('jumpToPart2').includes('!Workspace.split'));

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas del espacio de trabajo pasaron');
process.exit(failures ? 1 : 0);
