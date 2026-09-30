// Downloads every cited source into docs/evidence/sources/ so each number can be checked against the document.
// PDFs are downloaded directly (falling back to the Internet Archive); web pages are saved as dated PDF snapshots
// with headless Chrome. Usage: node docs/evidence/fetch_sources.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'sources');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const MANIFEST = [
  // --- problem statement
  { id: 'ia2019', kind: 'pdf', url: 'https://www.infrastructureaustralia.gov.au/sites/default/files/2019-08/Urban%20Transport%20Crowding%20and%20Congestion%20-%206.%20Melbourne%20and%20Geelong.pdf' },
  { id: 'bitre74', kind: 'pdf', url: 'https://www.bitre.gov.au/sites/default/files/is_074.pdf' },
  { id: 'fhwa_nrc', kind: 'page', url: 'https://ops.fhwa.dot.gov/program_areas/reduce-non-cong.htm' },
  { id: 'vago2025', kind: 'page', url: 'https://www.audit.vic.gov.au/report/managing-disruptions-affecting-victorias-public-transport-network' },
  { id: 'com_consent', kind: 'page', url: 'https://www.melbourne.vic.gov.au/consent-works-road-works' },
  { id: 'com_tmp', kind: 'page', url: 'https://www.melbourne.vic.gov.au/traffic-management-plans' },
  { id: 'worksafe_alert', kind: 'page', url: 'https://www.worksafe.vic.gov.au/safety-alerts/traffic-management-worker-killed-another-seriously-injured' },
  { id: 'vicroads_wrr', kind: 'pdf', url: 'https://www.vicroads.vic.gov.au/-/media/files/documents/business-and-industry/workingwithinroadreserve/working-within-road-reserve---web-doc-upd_jan-2020.ashx' },
  { id: 'tfnsw_rates', kind: 'pdf', url: 'https://www.transport.nsw.gov.au/system/files/media/documents/2025/ip-0033-gd03-guidelines-for-global-strategic-rates-for-project-cost-estimating.pdf' },
  // --- economics / environment
  { id: 'tfnsw_epv', kind: 'pdf', url: 'https://www.transport.nsw.gov.au/system/files/media/documents/2025/tfnsw-economic-parameter-values-jan-2025.pdf' },
  { id: 'atap_pv2', kind: 'pdf', url: 'https://www.atap.gov.au/sites/default/files/pv2_road_parameter_values.pdf' },
  { id: 'atap_pv5', kind: 'pdf', url: 'https://www.atap.gov.au/sites/default/files/documents/pv5-multi-modal-update-20240522.pdf' },
  { id: 'nga2025', kind: 'pdf', url: 'https://www.dcceew.gov.au/sites/default/files/documents/national-greenhouse-account-factors-2025.pdf' },
  { id: 'smit2014', kind: 'pdf', url: 'https://www.dcceew.gov.au/sites/default/files/documents/australian-motor-vehicle-emissions-inventory-2014_0.pdf' },
  // --- traffic engineering
  { id: 'fdot_bc791', kind: 'pdf', url: 'https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/research/reports/fdot-bc791-v2-rpt.pdf' },
  { id: 'act_tta', kind: 'pdf', url: 'https://www.planning.act.gov.au/__data/assets/pdf_file/0009/2348199/Appendix-G-Traffic-and-Transport-Assessment.pdf' },
  { id: 'mmdg', kind: 'pdf', url: 'https://www.mainroads.wa.gov.au/4a45b7/globalassets/technical-commercial/technical-library/road-and-traffic-engineering/smart-freeways/dot-vic-reference-document-managed-motorway-design-guide-mmdg-volume-1-role-traffic-theory-science-for-optimisation-part-3-motorway-capacity-guide-vicroads-version-1.1-october-2019.pdf' },
  { id: 'intrans_hcm', kind: 'pdf', url: 'https://www.intrans.iastate.edu/wp-content/uploads/2020/07/adjustment_factors_for_HCM_freeway_wz_capacity_w_cvr.pdf' },
  { id: 'qgttm3', kind: 'pdf', url: 'https://www.tmr.qld.gov.au/_/media/busind/techstdpubs/traffic-management/qgttm/qgttm-part-3.pdf' },
  { id: 'tn195', kind: 'pdf', url: 'https://www.tmr.qld.gov.au/-/media/busind/techstdpubs/Technical-notes/Traffic-engineering/TN195.pdf' },
  { id: 'vic_code', kind: 'pdf', url: 'https://www.gazette.vic.gov.au/gazette/Gazettes2023/GG2023S280.pdf' },
  { id: 'road_rules', kind: 'page', url: 'https://www.legislation.vic.gov.au/in-force/statutory-rules/road-safety-road-rules-2017' },
  { id: 'truong2018', kind: 'pdf', url: 'https://australasiantransportresearchforum.org.au/wp-content/uploads/2022/03/ATRF2018_paper_22.pdf' },
  { id: 'starkey2020', kind: 'page', url: 'https://www.frontiersin.org/journals/sustainable-cities/articles/10.3389/frsc.2020.00039/full' },
  { id: 'erke2007', kind: 'page', url: 'https://www.sciencedirect.com/science/article/abs/pii/S1369847807000150' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tryFetch(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' }, redirect: 'follow' });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.subarray(0, 5).toString() === '%PDF-' ? buf : null;
  } catch { return null; }
}

async function withChrome(fn) {
  const port = 9340;
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(HERE, '.chrome')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 40 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = l.find(t => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} await sleep(250); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Network.enable');
  await send('Network.setUserAgentOverride', { userAgent: UA });
  try { return await fn(send); } finally { ws.close(); chrome.kill(); }
}

const log = [];
const pages = [];
for (const s of MANIFEST) {
  const file = path.join(OUT, `${s.id}.pdf`);
  if (fs.existsSync(file) && fs.statSync(file).size > 20000) { log.push([s.id, 'cached', s.url]); continue; }
  if (s.kind === 'pdf') {
    let buf = await tryFetch(s.url), via = 'direct';
    if (!buf) { buf = await tryFetch(`https://web.archive.org/web/2025id_/${s.url}`); via = 'Internet Archive'; }
    if (buf) { fs.writeFileSync(file, buf); log.push([s.id, `pdf (${via})`, s.url]); }
    else { pages.push({ ...s, fallback: true }); }
  } else pages.push(s);
}
if (pages.length) {
  await withChrome(async send => {
    for (const s of pages) {
      const file = path.join(OUT, `${s.id}.pdf`);
      for (const url of [s.url, `https://web.archive.org/web/2025/${s.url}`]) {
        await send('Page.navigate', { url });
        await sleep(9000);
        const t = await send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText.length : 0', returnByValue: true });
        const len = t.result?.result?.value || 0;
        const title = (await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result?.result?.value || '';
        if (len < 600 || /403|forbidden|access denied|just a moment|attention required/i.test(title)) continue;
        const r = await send('Page.printToPDF', { printBackground: false, displayHeaderFooter: true, headerTemplate: '<span style="font-size:7px;margin-left:10px" class="url"></span>', footerTemplate: `<span style="font-size:7px;margin-left:10px">Snapshot ${new Date().toISOString()} · <span class="pageNumber"></span>/<span class="totalPages"></span></span>`, marginTop: 0.5, marginBottom: 0.5 });
        if (r.result?.data) { fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); log.push([s.id, url === s.url ? 'page snapshot' : 'page snapshot (Internet Archive)', url]); break; }
      }
      if (!fs.existsSync(file)) log.push([s.id, 'FAILED', s.url]);
    }
  });
}
fs.writeFileSync(path.join(HERE, 'fetch_log.json'), JSON.stringify({ when: new Date().toISOString(), log }, null, 1));
for (const l of log) console.log(l.join('  |  '));
