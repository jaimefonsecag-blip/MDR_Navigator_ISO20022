// The pairing rule depends entirely on reading the MDR file name correctly, so
// the parser is tested against real published names, including the messy ones:
// hyphenated domains, inconsistent casing, composite domains, month-based
// periods, "_v2_0" versions and browser "(1)" duplicates.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const script = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/) || [])[1] || '';

const start = script.indexOf('// ===== MDR FILE NAMING =====');
const end = script.indexOf('// ===== END MDR FILE NAMING =====');
if (start === -1 || end === -1) {
    console.error('No se encontro el bloque de nombres MDR en index.html');
    process.exit(1);
}
const api = new Function(`${script.slice(start, end)}
return { parseMdrFileName, mdrDomainKey, compareMdrFiles };`)();
const { parseMdrFileName, compareMdrFiles } = api;

let failures = 0;
const check = (label, ok, detail) => {
    if (!ok) { failures++; console.log(`FAIL  ${label}${detail !== undefined ? ` -> ${detail}` : ''}`); }
    else console.log(`PASS  ${label}`);
};

// ---- real published names: [file, expected part, expected domain key] ----
const REAL = [
    ['ISO20022_MDRPart1_InvestmentFunds_2024_2025_v2.docx', 1, 'investmentfunds'],
    ['ISO20022_MDRPart2_Investment-Funds_2025_2026_v2.pdf', 2, 'investmentfunds'],
    ['ISO20022_MDRPart1_InvestmentFunds_2025_2026_v2.docx', 1, 'investmentfunds'],
    ['ISO20022_MDRPart1_BankToCustomerCashManagement_2024_2025_v2.docx', 1, 'banktocustomercashmanagement'],
    ['ISO20022_MDRPart2_BankToCustomerCashManagement_2024_2025_v1.pdf', 2, 'banktocustomercashmanagement'],
    ['ISO20022_MDRPart2_BanktoCustomerCashManagement_2025_2026_v1.pdf', 2, 'banktocustomercashmanagement'],
    ['ISO20022_MDRPart1_CashManagement_2024_2025_v2.docx', 1, 'cashmanagement'],
    ['ISO20022_MDRPart2_CashManagement_2024_2025_v1.pdf', 2, 'cashmanagement'],
    ['iso20022_mdrpart1_collateralmanagement_2021_2022.docx', 1, 'collateralmanagement'],
    ['ISO20022_MDRPart1_CorporateActions_2024_2025_v2_0.docx', 1, 'corporateactions'],
    ['ISO20022_MDRPart2_CorporateActions_2024_2025_v1.pdf', 2, 'corporateactions'],
    ['ISO20022_MDRPart1_AccountSwitching_2025_2026_v2 (1).docx', 1, 'accountswitching'],
    ['ISO20022_MDRPart1_GeneralMeeting_2024_2025_v2.docx', 1, 'generalmeeting'],
    ['ISO20022_MDRPart2_GeneralMeeting_2024_2025_v1.pdf', 2, 'generalmeeting'],
    ['ISO20022_MDRPart1_PaymentsInitiation_2023_2024_v2.docx', 1, 'paymentsinitiation'],
    ['ISO20022_MDRPart2_PaymentsInitiation_2023_2024_v1.pdf', 2, 'paymentsinitiation'],
    ['ISO20022_MDRPart1_PaymentsClearingAndSettlement_2025_2026_v2.docx', 1, 'paymentsclearingandsettlement'],
    ['ISO20022_MDRPart2_PaymentsClearingAndSettlement_2024_2025_v1.pdf', 2, 'paymentsclearingandsettlement'],
    ['ISO20022_MDRPart1_SettlementAndReconciliation_2024_2025_v2.docx', 1, 'settlementandreconciliation'],
    ['ISO20022_MDRPart2_SettlementAndReconciliation_2025_2026_v1.pdf', 2, 'settlementandreconciliation'],
    ['ISO20022_MDRPart2_BankAccountManagement_2023_2024_v1.pdf', 2, 'bankaccountmanagement'],
    // composite domains
    ['ISO20022_MDRPart1_Target2Securities_Administration_2023_2024_v2.docx', 1, 'target2securitiesadministration'],
    ['ISO20022_MDRPart2_Target2Securities_Administration_2023_2024_v1.pdf', 2, 'target2securitiesadministration'],
    ['ISO20022_MDRPart1_Target2Securities_LinkReferenceData_v2.docx', 1, 'target2securitieslinkreferencedata'],
    ['ISO20022_MDRPart2_Target2Securities_LinkReferenceData_v1.pdf', 2, 'target2securitieslinkreferencedata'],
    ['ISO20022_MDRPart1_Target2Securities_CollateralManagementReferenceData_v2.docx', 1, 'target2securitiescollateralmanagementreferencedata'],
    ['ISO20022_MDRPart2_Target2Securities_SettlementRestrictions_v1.pdf', 2, 'target2securitiessettlementrestrictions'],
    // month-based periods
    ['ISO20022_MDRPart2_FITRR_TradeRepositoryReporting_May2024_v1.pdf', 2, 'fitrrtraderepositoryreporting'],
    ['ISO20022_MDRPart2_Target2Securities_March_2026_v1_0.pdf', 2, 'target2securities'],
    ['ISO20022_MDR_Target2Securities_BusinessFileHeader_June2024_v1.pdf', 2, 'target2securitiesbusinessfileheader']
];

console.log('=== nombres reales publicados ===');
REAL.forEach(([name, part, domain]) => {
    const parsed = parseMdrFileName(name);
    const ok = parsed.ok && parsed.part === part && parsed.domainKey === domain;
    check(`${name.slice(0, 62)}`, ok,
        parsed.ok ? `part=${parsed.part} domain="${parsed.domainKey}"` : `no reconocido (${parsed.reason})`);
});

console.log('\n=== emparejamiento: mismo dominio ===');
const pair = (a, b) => compareMdrFiles(parseMdrFileName(a), parseMdrFileName(b));

// The user's own pair: hyphen difference and different years.
let result = pair('ISO20022_MDRPart1_InvestmentFunds_2024_2025_v2.docx',
                  'ISO20022_MDRPart2_Investment-Funds_2025_2026_v2.pdf');
check('InvestmentFunds vs Investment-Funds -> compatible', result.compatible, result.reason);
check('  avisa de que el periodo no coincide', result.warnings.some(w => /periodo|año/i.test(w)),
    JSON.stringify(result.warnings));

result = pair('ISO20022_MDRPart1_InvestmentFunds_2025_2026_v2.docx',
              'ISO20022_MDRPart2_Investment-Funds_2025_2026_v2.pdf');
check('mismo dominio y mismo periodo -> sin avisos', result.compatible && !result.warnings.length,
    JSON.stringify(result.warnings));

result = pair('ISO20022_MDRPart1_BanktoCustomerCashManagement_2024_2025_v2.docx',
              'ISO20022_MDRPart2_BankToCustomerCashManagement_2024_2025_v1.pdf');
check('diferencia de mayusculas -> compatible', result.compatible, result.reason);

console.log('\n=== emparejamiento: dominios distintos deben bloquear ===');
result = pair('ISO20022_MDRPart1_InvestmentFunds_2024_2025_v2.docx',
              'ISO20022_MDRPart2_CorporateActions_2024_2025_v1.pdf');
check('InvestmentFunds vs CorporateActions -> incompatible', !result.compatible, result.reason);
check('  el motivo nombra los dos dominios',
    /investment/i.test(result.reason) && /corporate/i.test(result.reason), result.reason);

result = pair('ISO20022_MDRPart1_CashManagement_2024_2025_v2.docx',
              'ISO20022_MDRPart2_BankToCustomerCashManagement_2024_2025_v1.pdf');
check('CashManagement vs BankToCustomerCashManagement -> incompatible', !result.compatible, result.reason);

result = pair('ISO20022_MDRPart1_Target2Securities_Administration_2023_2024_v2.docx',
              'ISO20022_MDRPart2_Target2Securities_SettlementRestrictions_v1.pdf');
check('dos subdominios de Target2Securities -> incompatible', !result.compatible, result.reason);

console.log('\n=== la parte debe coincidir con la extension ===');
let parsed = parseMdrFileName('ISO20022_MDRPart1_InvestmentFunds_2024_2025_v2.pdf');
check('Parte 1 en .pdf se detecta como inconsistente', parsed.ok && parsed.partMismatch === true,
    JSON.stringify({ ok: parsed.ok, partMismatch: parsed.partMismatch }));
parsed = parseMdrFileName('ISO20022_MDRPart2_InvestmentFunds_2024_2025_v1.docx');
check('Parte 2 en .docx se detecta como inconsistente', parsed.ok && parsed.partMismatch === true,
    JSON.stringify({ ok: parsed.ok, partMismatch: parsed.partMismatch }));

console.log('\n=== nombres que no siguen la convencion ===');
[['informe.pdf', 'sin prefijo ISO20022'],
 ['ISO20022_BusinessAreas.pdf', 'sin MDRPart'],
 ['introtoiso20022.pdf', 'documento no MDR'],
 ['swift_iso_20022_for_dummies_6th_edition_dec_2022.pdf', 'libro, no MDR']
].forEach(([name, why]) => {
    const outcome = parseMdrFileName(name);
    check(`rechaza "${name.slice(0, 44)}" (${why})`, !outcome.ok, JSON.stringify(outcome));
});

// A file whose part cannot be read from the name falls back to the extension.
parsed = parseMdrFileName('ISO20022_MDR_Target2Securities_BusinessFileHeader_June2024_v1.pdf');
check('sin numero de parte, la extension decide (pdf -> 2)', parsed.ok && parsed.part === 2 && parsed.partFromExtension,
    JSON.stringify({ part: parsed.part, fromExt: parsed.partFromExtension }));

console.log(failures ? `\n${failures} prueba(s) fallida(s)` : '\ntodas las pruebas de nombres pasaron');
process.exit(failures ? 1 : 0);
