// Smoke test für das einmalige Durchnummerieren der Altbestands-Findings
// (renumberLegacyFindings() in public/companies.js). Der Server kennt diese
// Nachvergabe nicht — sie ist ein Lesevorgang der Oberfläche —, also spielt der
// Test die Schleife des Frontends gegen den echten Server nach und prüft genau
// das, was an ihr schiefgehen kann: dass die Nummern in Ladereihenfolge vergeben
// werden, dass der sonst unveränderte PUT weder die am CAP-Item gepflegte Frist
// noch das CAP-Item selbst abräumt, und dass ein zweiter Durchlauf nichts mehr tut.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acaudit-smoke-'));
const PORT = 8399;
const BASE = `http://127.0.0.1:${PORT}`;

let cookie = '';
const req = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, payload };
};

let failures = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const orders = items => items.map(i => i.sort_order).join(', ');

// Wortgleiche Nachbildung von renumberLegacyFindings(): dieselbe Zählung wie der
// `+`-Button (max+1, Untergrenze 1), dieselben durchgereichten Felder, und
// `cap_deadline` bleibt bewusst außen vor.
const renumberLegacyFindings = async (checklistItems) => {
  const stale = checklistItems.filter(item => (item.sort_order ?? 0) === 0);
  if (!stale.length) return 0;
  let next = checklistItems.reduce((max, ci) => Math.max(max, ci.sort_order ?? 0), 0) + 1;
  for (const item of stale) {
    const saved = (await req('PUT', `/api/checklist-items/${item.id}`, {
      section: item.section || 'THEORETICAL',
      sort_order: next,
      regulation_ref: item.regulation_ref || '',
      compliance_check: item.compliance_check || '',
      evaluation: item.evaluation || '',
      auditor_comment: item.auditor_comment || '',
      document_ref: item.document_ref || '',
    })).payload;
    Object.assign(item, saved);
    next++;
  }
  return stale.length;
};

(async () => {
  const server = spawn('node', ['server.js'], {
    env: { ...process.env, DATA_DIR, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise(resolve => server.stdout.on('data', d => {
    if (d.toString().includes('running on')) resolve();
  }));

  const login = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=audit2024',
    redirect: 'manual'
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  // ── seed: Abteilung + Behördenaudit mit seinem einen Bericht ──
  const company = (await req('POST', '/api/companies', { name: 'Smoke Air GmbH', city: 'Bremen' })).payload;
  const dept = (await req('POST', `/api/companies/${company.id}/departments`,
    { name: 'CAMO', regulation: 'Part-CAMO' })).payload;
  const plan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2026, plan_type: 'AUTHORITY' })).payload;
  const lineId = plan.authority_line_id;

  // ── Altbestand: drei Findings, alle auf sort_order 0, eines davon mit Level,
  //    eigener Frist, Findingbericht Nr. und damit einem CAP-Item ──
  const add = async body => (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { sort_order: 0, ...body })).payload;
  const f1 = await add({ regulation_ref: '145.A.30', compliance_check: 'Erstes Finding' });
  const f2 = await add({
    regulation_ref: '145.A.35', compliance_check: 'Zweites Finding',
    document_ref: 'LBA-2024-17', evaluation: 'L2', cap_deadline: '2026-03-31'
  });
  const f3 = await add({ regulation_ref: '145.A.40', compliance_check: 'Drittes Finding' });
  check('Altbestand steht auf lauter Nullen',
    orders([f1, f2, f3]) === '0, 0, 0', orders([f1, f2, f3]));

  const capBefore = ((await req('GET', `/api/audit-plans/${plan.id}/cap-items`)).payload.items || [])
    .find(c => c.checklist_item_id === f2.id);
  check('  → das Finding mit Level hat ein CAP-Item mit der Frist der Behörde',
    !!capBefore && capBefore.deadline === '2026-03-31', capBefore && capBefore.deadline);

  // ── 1. Erster Ladevorgang nummeriert durch ──
  let items = (await req('GET', `/api/audit-plan-lines/${lineId}/checklist-items`)).payload;
  const written = await renumberLegacyFindings(items);
  check('erster Ladevorgang schreibt je Finding ein Update', written === 3, String(written));

  items = (await req('GET', `/api/audit-plan-lines/${lineId}/checklist-items`)).payload;
  check('  → die Findingliste zeigt durchgehende Nummern statt Nullen',
    orders(items) === '1, 2, 3', orders(items));
  check('  → in Ladereihenfolge, also chronologisch',
    items.map(i => i.compliance_check).join(' | ') === 'Erstes Finding | Zweites Finding | Drittes Finding',
    items.map(i => i.compliance_check).join(' | '));

  // ── 2. Der sonst unveränderte PUT lässt CAP-Item und Frist stehen ──
  const capAfter = ((await req('GET', `/api/audit-plans/${plan.id}/cap-items`)).payload.items || [])
    .find(c => c.checklist_item_id === f2.id);
  check('das CAP-Item überlebt die Nachvergabe',
    !!capAfter && capAfter.id === capBefore.id, capAfter && capAfter.id);
  check('  → mit unveränderter Frist (kein cap_deadline im Body)',
    !!capAfter && capAfter.deadline === '2026-03-31', capAfter && capAfter.deadline);
  const f2After = items.find(i => i.id === f2.id);
  check('  → Level und Findingbericht Nr. bleiben unangetastet',
    f2After.evaluation === 'L2' && f2After.document_ref === 'LBA-2024-17',
    `${f2After.evaluation} / ${f2After.document_ref}`);

  // ── 3. Zweiter Ladevorgang ist ein No-op ──
  const again = await renumberLegacyFindings(items);
  check('zweiter Ladevorgang schreibt nichts mehr', again === 0, String(again));

  // ── 4. Ein neues Finding zählt hinter dem Altbestand weiter ──
  const fresh = (await req('POST', `/api/audit-plan-lines/${lineId}/checklist-items`,
    { sort_order: 4, compliance_check: 'Neues Finding' })).payload;
  check('der +-Button trifft auf keine vergebene Nummer', fresh.sort_order === 4, String(fresh.sort_order));

  // ── 5. Gemischter Bestand: nur die Nullen bekommen neue Nummern ──
  const mixedPlan = (await req('POST', `/api/departments/${dept.id}/audit-plans`,
    { year: 2027, plan_type: 'AUTHORITY' })).payload;
  const mixedLine = mixedPlan.authority_line_id;
  await req('POST', `/api/audit-plan-lines/${mixedLine}/checklist-items`,
    { sort_order: 0, compliance_check: 'Altbestand' });
  await req('POST', `/api/audit-plan-lines/${mixedLine}/checklist-items`,
    { sort_order: 1, compliance_check: 'Bereits vergeben' });
  await req('POST', `/api/audit-plan-lines/${mixedLine}/checklist-items`,
    { sort_order: 2, compliance_check: 'Bereits vergeben' });
  let mixed = (await req('GET', `/api/audit-plan-lines/${mixedLine}/checklist-items`)).payload;
  await renumberLegacyFindings(mixed);
  mixed = (await req('GET', `/api/audit-plan-lines/${mixedLine}/checklist-items`)).payload;
  check('gemischter Bestand: die vergebenen Nummern bleiben, die 0 zählt hinten weiter',
    orders(mixed) === '1, 2, 3'
      && mixed.find(i => i.sort_order === 3).compliance_check === 'Altbestand',
    orders(mixed));

  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})();
