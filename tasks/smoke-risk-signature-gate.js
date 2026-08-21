// Smoke test für das Gate des Unterschriftenblocks im Risikoanalyse-PDF
// (renderRiskAnalysisPdf() in pdf/risk.js).
//
// Geprüft wird genau die Grenze: Ort/Datum-Zeile, Unterschriftslinie, Name und
// die Funktionsbezeichnung `Safety Manager` hängen am `signed_at` der
// Risikoanalyse — ohne Freigabe ist sie ein Entwurf, und ein Kasten mit Namen
// und Signaturbild behauptete eine Freigabe, die niemand erteilt hat.
//
// Der eigentliche Regressionsfall ist das gedruckte **Datum**: vor der Korrektur
// stand dort `new Date()`, also der Tag des Ausdrucks, was jeden Entwurf auf den
// Tag seines Ausdrucks datierte — an einem einzelnen Testlauf leicht zu
// übersehen, weil ein heutiges Datum plausibel aussieht. Deshalb ein `signed_at`,
// das sicher nicht der heutige Tag ist (und es auch nie sein wird), exakt dieses
// Datum als Erwartung, UND die Gegenprobe, dass der heutige Tag nirgends auf dem
// Blatt steht.
//
// Der Test bootet den echten Server IN-PROCESS und legt sich vor dem Laden der
// Routen einen Spy auf renderRiskAnalysisPdf: routes/risk-analysis.js
// destrukturiert die Funktion beim Require, ein späteres Patchen käme zu spät.
// Der Spy ruft den echten Renderer auf und spiegelt zusätzlich doc.text(),
// doc.image() und die Linienzüge — im fertigen PDF ist der Text komprimiert und
// nicht mehr zu lesen, geprüft wird also, was wirklich gezeichnet wird.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8403;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.DATA_DIR = DATA_DIR;
process.env.PORT = String(PORT);

const riskPdf = require('../pdf/risk');
const realRender = riskPdf.renderRiskAnalysisPdf;
let renderCalls = [];
riskPdf.renderRiskAnalysisPdf = (doc, args) => {
  const call = { args, texts: [], images: [], lines: [] };
  const realText = doc.text.bind(doc);
  doc.text = (txt, ...rest) => {
    call.texts.push(String(txt));
    return realText(txt, ...rest);
  };
  // Das Signaturbild ist das einzige, was der Block zeichnet statt zu schreiben —
  // ohne diesen Spy bliebe eine leere Zelle vom vollen Kasten ununterscheidbar.
  const realImage = doc.image.bind(doc);
  doc.image = (src, x, y, ...rest) => {
    call.images.push({ x, y });
    return realImage(src, x, y, ...rest);
  };
  // Die Unterschriftslinie ist der dritte Bestandteil des Kastens und trägt
  // überhaupt keinen Text. Sie ist an ihrer Geometrie eindeutig zu erkennen:
  // waagerecht, 200pt lang, am linken Rand — Tabellentrenner laufen über die
  // ganze Tabellenbreite, die Matrixlinien sind kurz und weiß.
  const realMoveTo = doc.moveTo.bind(doc);
  const realLineTo = doc.lineTo.bind(doc);
  let pending = null;
  doc.moveTo = (x, y) => { pending = { x, y }; return realMoveTo(x, y); };
  doc.lineTo = (x, y) => {
    if (pending) call.lines.push({ x1: pending.x, y1: pending.y, x2: x, y2: y });
    return realLineTo(x, y);
  };
  renderCalls.push(call);
  const out = realRender(doc, args);
  doc.text = realText;
  doc.image = realImage;
  doc.moveTo = realMoveTo;
  doc.lineTo = realLineTo;
  return out;
};

require('../server');

// Ohne Unterschriftenblock hat niemand ein Bild zu zeichnen, also darf auch kein
// BLOB gelesen werden — das ist am Statement zu sehen und nicht am Blatt, genau
// wie der has_signature-Guard in tasks/smoke-cap-form-pdf.js.
const { stmts } = require('../db');
const realSigStmt = stmts.getPersonSignature;
let sigReads = [];
stmts.getPersonSignature = {
  get: (id) => { sigReads.push(id); return realSigStmt.get(id); },
};

let cookie = '';
const req = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, payload: type.includes('json') ? await res.json() : await res.text() };
};

const pdf = async (url) => {
  renderCalls = [];
  sigReads = [];
  const res = await fetch(BASE + url, { headers: { Cookie: cookie }, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  // Ein Wurf mitten im Renderer liefert trotzdem 200 mit gültigem %PDF-Kopf —
  // doc.pipe(res) läuft, bevor gezeichnet wird. Erst %%EOF zeigt den Abschluss.
  const text = buf.toString('latin1');
  return {
    status: res.status,
    ok: res.status === 200 && buf.slice(0, 4).toString() === '%PDF' && text.slice(-40).includes('%%EOF'),
    bytes: buf.length,
    call: renderCalls[0] || { texts: [], images: [], lines: [] },
    sigReads,
  };
};

let failures = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};

const drew = (call, label) => call.texts.some(t => t === label);
// Die Unterschriftslinie: waagerecht, am linken Rand (40) und 200pt lang.
const drewSigLine = (call) => call.lines.some(l => l.x1 === 40 && l.x2 === 240 && l.y1 === l.y2);

const CITY = 'Bremen';
// Ein Freigabedatum, das an keinem Testlauf der heutige Tag sein kann.
const SIGNED_AT = '2019-03-14';
const SIGNED_DE = '14.03.2019';
const TODAY_DE = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
})();

(async () => {
  await new Promise(r => setTimeout(r, 400));

  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=audit2024',
    redirect: 'manual'
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  // ── seed: Firma mit Ort, Abteilung mit QM samt hinterlegter Unterschrift ──
  // Kein Firmenlogo: so ist jedes gezeichnete Bild zwingend das Signaturbild.
  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: CITY })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`,
    { name: 'CAMO', regulation: 'Part-CAMO' })).payload;
  const qm = (await req('POST', `/api/companies/${company.id}/persons`,
    { role: 'QM', department_id: dept.id, first_name: 'Petra', last_name: 'Prüfer', email: 'qm@example.org' })).payload;
  // 1×1-PNG — der Inhalt ist gleichgültig, geprüft wird, DASS gezeichnet wird.
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await req('PUT', `/api/persons/${qm.id}/signature`, { signature: PNG });
  const QM_NAME = 'Petra Prüfer';

  const cr = (await req('POST', `/api/departments/${dept.id}/change-requests`,
    { title: 'Neuer Hangar', description: 'Verlagerung der Instandhaltung' })).payload;
  const ra = (await req('POST', `/api/change-requests/${cr.id}/risk-analysis`,
    { title: 'Risikoanalyse Hangarverlagerung', author: 'Anton Autor', safety_manager: QM_NAME })).payload;
  // Der Verantwortliche der Risikozeile ist bewusst NICHT der QM: seine Spalte
  // druckt den Namen als Tabellenzelle, und ein Name, der ohnehin in der Tabelle
  // steht, wäre als Beweis für den Unterschriftenkasten wertlos.
  await req('POST', `/api/risk-analysis/${ra.id}/items`, {
    risk_type: 'Betrieb', description: 'Werkzeug am alten Standort',
    consequence: 'Verzögerte Instandhaltung',
    initial_probability: 3, initial_severity: 4,
    responsible_person: 'Rita Risiko', mitigation_topic: 'Inventur',
    treatment: 'Vollständige Umlagerung vor Betriebsaufnahme',
    residual_probability: 2, residual_severity: 2,
  });

  // ── 1. Entwurf (ohne signed_at): kein Unterschriftenblock ──
  const stored = (await req('GET', `/api/risk-analysis/${ra.id}`)).payload;
  check('die frische Risikoanalyse ist ein Entwurf (signed_at leer)',
    !stored.signed_at, `signed_at = ${JSON.stringify(stored.signed_at)}`);

  const draft = await pdf(`/api/risk-analysis/${ra.id}/pdf`);
  check('Entwurf: das PDF läuft vollständig durch', draft.ok, `${draft.status}, ${draft.bytes} bytes`);
  check('  → keine Ort/Datum-Zeile',
    !draft.call.texts.some(t => t.startsWith(CITY + ', ')),
    draft.call.texts.filter(t => t.startsWith(CITY + ', ')).join(' | ') || 'keine');
  check('  → keine Unterschriftslinie', !drewSigLine(draft.call), `${draft.call.lines.length} Linie(n) insgesamt`);
  check('  → kein Name des Unterzeichners',
    !drew(draft.call, QM_NAME), drew(draft.call, QM_NAME) ? 'gezeichnet' : 'nicht gezeichnet');
  check('  → keine Funktionsbezeichnung "Safety Manager"',
    !drew(draft.call, 'Safety Manager'),
    drew(draft.call, 'Safety Manager') ? 'gezeichnet' : 'nicht gezeichnet');
  check('  → kein Signaturbild', draft.call.images.length === 0, `${draft.call.images.length} Bild(er)`);
  check('  → ausdrücklich KEIN getPersonSignature-Read: ein Bild ohne Kasten hat niemand zu zeichnen',
    draft.sigReads.length === 0, `${draft.sigReads.length} Read(s)`);
  // Gegenprobe zum Regressionsfall: der Entwurf trägt auch sonst kein Datum,
  // insbesondere nicht das heutige.
  check('  → und nirgends ein Datum, schon gar nicht das heutige',
    !draft.call.texts.some(t => t.includes(TODAY_DE)), `heute = ${TODAY_DE}`);

  // ── 2. Freigegeben (mit signed_at): der Block steht, mit dem Datum der Freigabe ──
  await req('PUT', `/api/risk-analysis/${ra.id}`,
    Object.assign({}, stored, { signed_at: SIGNED_AT }));
  const signedRow = (await req('GET', `/api/risk-analysis/${ra.id}`)).payload;
  check('die Freigabe ist gespeichert', signedRow.signed_at === SIGNED_AT, String(signedRow.signed_at));

  const signed = await pdf(`/api/risk-analysis/${ra.id}/pdf`);
  check('freigegebene Risikoanalyse: das PDF läuft vollständig durch',
    signed.ok, `${signed.status}, ${signed.bytes} bytes`);
  check('  → die Ort/Datum-Zeile trägt das Datum AUS signed_at',
    drew(signed.call, `${CITY}, ${SIGNED_DE}`),
    signed.call.texts.filter(t => t.startsWith(CITY + ', ')).join(' | ') || 'keine Ort/Datum-Zeile');
  // Der eigentliche Regressionsfall: stünde dort wieder new Date(), liefe der
  // Test an jedem anderen Tag grün, an dem SIGNED_AT zufällig heute wäre — was
  // es nie ist — und die Zeile darüber allein wäre der Beweis nicht.
  check('  → und ausdrücklich NICHT den Tag des Ausdrucks',
    !signed.call.texts.some(t => t.includes(TODAY_DE)),
    `heute = ${TODAY_DE}, gezeichnet: ${signed.call.texts.filter(t => /\d\d\.\d\d\.\d{4}/.test(t)).join(' | ') || 'kein Datum'}`);
  check('  → die Unterschriftslinie steht', drewSigLine(signed.call), '200pt am linken Rand');
  check('  → der Name des Unterzeichners steht', drew(signed.call, QM_NAME), QM_NAME);
  check('  → die Funktionsbezeichnung "Safety Manager" steht',
    drew(signed.call, 'Safety Manager'), 'gezeichnet');
  check('  → das Signaturbild wird gelesen und gezeichnet',
    signed.sigReads.length === 1 && signed.sigReads[0] === qm.id && signed.call.images.length === 1,
    `${signed.sigReads.length} Read(s), ${signed.call.images.length} Bild(er)`);

  // ── 3. Freigabe wieder geräumt: der Block entfällt erneut ──
  // `signed_at || null` in PUT /api/risk-analysis/:id räumt den leeren String
  // auf NULL — der Weg, auf dem eine versehentliche Freigabe zurückgenommen wird.
  await req('PUT', `/api/risk-analysis/${ra.id}`,
    Object.assign({}, signedRow, { signed_at: '' }));
  const clearedRow = (await req('GET', `/api/risk-analysis/${ra.id}`)).payload;
  check('die Freigabe ist wieder geräumt', !clearedRow.signed_at, String(clearedRow.signed_at));

  const cleared = await pdf(`/api/risk-analysis/${ra.id}/pdf`);
  check('zurückgenommene Freigabe: das PDF läuft vollständig durch',
    cleared.ok, `${cleared.status}, ${cleared.bytes} bytes`);
  check('  → der Unterschriftenblock ist wieder vollständig weg',
    !cleared.call.texts.some(t => t.startsWith(CITY + ', '))
      && !drewSigLine(cleared.call)
      && !drew(cleared.call, QM_NAME)
      && !drew(cleared.call, 'Safety Manager')
      && cleared.call.images.length === 0,
    `${cleared.call.images.length} Bild(er)`);
  check('  → und auch kein getPersonSignature-Read mehr',
    cleared.sigReads.length === 0, `${cleared.sigReads.length} Read(s)`);

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
