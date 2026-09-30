// Saves web pages (legislation, council pages) as dated PDF snapshots plus their text, using headless Chrome.
// Usage: node docs/evidence/snapshot_pages.mjs id=url [id=url ...]
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'sources');
fs.mkdirSync(OUT, { recursive: true });
const jobs = process.argv.slice(2).map(a => { const i = a.indexOf('='); return { id: a.slice(0, i), url: a.slice(i + 1) }; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9350 + Math.floor(Math.random() * 40);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(HERE, '.chrome2')}`, '--no-first-run', '--window-size=1280,1600', 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 60 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = l.find(t => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} await sleep(250); }
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}, ms = 60000) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); r({}); } }, ms); });
await send('Page.enable');
for (const j of jobs) {
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    await send('Page.navigate', { url: j.url });
    for (let w = 0; w < 25; w++) {
      await sleep(1500);
      const t = (await send('Runtime.evaluate', { expression: 'document.title + "\\n" + (document.body ? document.body.innerText : "")', returnByValue: true })).result?.result?.value || '';
      if (t.length > 800 && !/just a moment|enable javascript and cookies|attention required/i.test(t)) {
        fs.writeFileSync(path.join(OUT, `${j.id}.txt`), `Source: ${j.url}\nRetrieved: ${new Date().toISOString()}\n\n${t}`);
        const r = await send('Page.printToPDF', { displayHeaderFooter: true, headerTemplate: '<span style="font-size:7px;margin-left:10px" class="url"></span>', footerTemplate: `<span style="font-size:7px;margin-left:10px">Snapshot ${new Date().toISOString()} · <span class="pageNumber"></span>/<span class="totalPages"></span></span>`, marginTop: 0.5, marginBottom: 0.5 });
        if (r.result?.data) fs.writeFileSync(path.join(OUT, `${j.id}.pdf`), Buffer.from(r.result.data, 'base64'));
        ok = true; break;
      }
    }
  }
  console.log(j.id, ok ? 'saved' : 'FAILED', j.url);
}
ws.close(); chrome.kill(); process.exit(0);
