# ISO 20022 MDR Navigator

Herramienta de una sola página para explorar un **Message Definition Report** de
ISO 20022 de forma interactiva. Funciona íntegramente en el navegador: los
documentos se procesan en el cliente y **nunca se suben a ningún servidor**.

## Las dos partes de un MDR

| | Parte 1 (`.docx`) | Parte 2 (`.pdf`) |
|---|---|---|
| Responde a | El **porqué** | El **qué** |
| Contiene | Contexto de negocio, alcance funcional, actores, diagramas de flujo | Estructura completa, campos, cardinalidad, tipos, reglas |
| Dirigido a | Analistas de negocio, Product Managers | Desarrolladores, Arquitectos |

Se puede cargar una sola parte o las dos. Con ambas cargadas, cada identificador
de mensaje (`camt.052.001.14`) que aparezca en la narrativa de negocio se
convierte en un enlace directo a su estructura técnica.

## Qué ofrece

**Parte 1 — Negocio**
- Índice navegable de las secciones, con búsqueda sobre títulos y prosa
- Lectura paso a paso con progreso, migas de pan y anterior/siguiente
- Diagramas de flujo como vista previa, con visor de zoom y desplazamiento
- Flujos reconstruidos en pasos numerados con los actores de cada paso
- Actores del MDR con su definición literal
- Ejemplos XML colapsables y tablas con cabecera fija

**Parte 2 — Técnico**
- Árbol de building blocks con despliegue progresivo
- Explorador de elementos con multiplicidad, tipos, CodeSets y constraints
- Visor de esquema JSON del mensaje, con presencia y grupos `SelectOneOf`
- Exportación a Excel del diccionario de mensajes y CodeSets

**Traducción al español** de la prosa del MDR, con un glosario ISO 20022 propio
que corrige los errores típicos de los traductores genéricos (*party* → «parte»,
no «partido»; *securities* → «valores») y respeta la concordancia de género.

## Uso

Abre `index.html` en el navegador. No hace falta instalar nada.

Necesita conexión a internet para:
1. Descargar tres librerías públicas al abrir: pdf.js, JSZip y SheetJS.
2. La traducción al español, que consulta APIs públicas.

Si alguna librería no se puede descargar (por ejemplo, un proxy que bloquee
`cdnjs.cloudflare.com`), la pantalla de carga indica cuál falta y qué se ve
afectado, en lugar de fallar sin explicación.

## Desarrollo

El proyecto es un único archivo HTML con el CSS y el JavaScript embebidos, para
que se pueda compartir tal cual. La carpeta `scripts/` contiene verificaciones
que se ejecutan con Node y no forman parte de la página.

```bash
npm install   # solo para poder ejecutar las verificaciones
npm run check
```

`npm run check` valida cinco cosas:

| Verificación | Qué comprueba |
|---|---|
| `check-syntax` | El script embebido se parsea sin errores |
| `check-handlers` | Cada handler `onclick`, helper, referencia DOM en caché e id del markup existe de verdad |
| `check-translation` | Diccionario de frases, glosario, concordancia de género y enmascarado de identificadores |
| `check-reset` | Volver al inicio limpia todo el estado del parseo y libera los blobs de los diagramas |
| `check-docx-parser` | Ejecuta el parser DOCX real contra un MDR de ejemplo y valida secciones, diagramas, tablas, actores y flujos |

`check-docx-parser` necesita un `.docx` de ejemplo en la raíz; si no lo
encuentra, se omite sin fallar. Los documentos MDR no se versionan: están
excluidos en `.gitignore` porque son publicaciones con derechos de ISO 20022.

## Privacidad

Todo el procesamiento del PDF y del Word ocurre en el navegador. Lo único que
sale a la red son las librerías de los CDN y, si se activa la traducción, los
fragmentos de texto que se envían a las APIs de traducción.
