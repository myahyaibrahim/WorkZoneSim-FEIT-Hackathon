// Minimal static file server for the Work Zone Impact Simulator, plus one AI endpoint.
// Usage: node server.js [port]
// AI advice (Decide tab): set GEMINI_API_KEY in the environment or in a .env file next to this script
// (optional GEMINI_MODEL, default gemini-3.8-flash; falls back to the flash-lite models, then gemini-flash-latest, if a model is retired, busy or slow). The key stays on this server; the browser never sees it.
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 8090;
const root = __dirname;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

// .env (KEY=value lines) without overriding real environment variables
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// when the flash models are busy (free-tier keys are throttled first), the flash-lite models usually still answer
const FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'];
// a busy model can take over a minute just to refuse; give each attempt a time limit and move on
const TIMEOUT_MS = model => /lite/.test(model) ? 30000 : 12000;

const ADVICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    recommended_option: { type: 'INTEGER', description: 'id of the recommended option, from the options given' },
    headline: { type: 'STRING', description: 'one sentence: what to do' },
    why: { type: 'ARRAY', items: { type: 'STRING' }, description: '2-4 reasons, each citing numbers from the data' },
    actions: { type: 'ARRAY', items: { type: 'STRING' }, description: '3-6 concrete steps before lodging, most important first' },
    trade_offs: { type: 'ARRAY', items: { type: 'STRING' }, description: 'what the recommendation gives up versus the other options' },
    runner_up: { type: 'INTEGER', description: 'id of the second-best option' },
    equipment_changes: { type: 'ARRAY', description: 'optional changes to the recommended option equipment, only items listed for it', items: { type: 'OBJECT', properties: {
      item_key: { type: 'STRING' }, quantity: { type: 'INTEGER' }, reason: { type: 'STRING' } }, required: ['item_key', 'quantity', 'reason'] } },
  },
  required: ['recommended_option', 'headline', 'why', 'actions', 'trade_offs'],
};
const SYSTEM = `You are a senior traffic engineer in Melbourne advising on a temporary road closure before it is lodged with the council.
You receive the results of a traffic simulation tool for several options (treatment and time window). Use ONLY the numbers given; never invent data, standards or costs.
Prefer options that pass every check; among those, weigh total economic cost, public transport disruption, queues and council concerns (peak hours, footpath widths, local access, night noise).
If no option passes, recommend the one that is easiest to fix and say exactly what to change. Refer to options by their name, never by id.
Base the actions on the 'fix' texts of the failed checks and on the checks to confirm; do not name permits, documents, agencies or legislation that are not in the data.
When 'contractor' is given, it holds the contractor's priorities, budget and notes. Treat 'avoid night works' and the budget as hard limits: do not recommend an option that breaks them unless every option does, and then say which limit is broken. Weigh the other priorities in your choice and say how.
'knock_on' rates four pillars per option (emergency services, public transport, pedestrians and cyclists, traffic and queues); prefer fewer High ratings.
Equipment changes are optional: suggest one only when the data support it (for example more VMS where many drivers still reach the closure), use only item_key values listed for the recommended option, give whole-number quantities, and keep them few.
Be concise and practical. Write in English.`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 200000) reject(new Error('too large')); });
    req.on('end', () => resolve(b)); req.on('error', reject);
  });
}
const sendJSON = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function advise(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return sendJSON(res, 503, { error: 'no_key', message: 'Set GEMINI_API_KEY in the .env file next to server.js and restart the server.' });
  let input;
  try { input = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'bad_request' }); }
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: 'Simulation results for the options (JSON):\n' + JSON.stringify(input) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: ADVICE_SCHEMA },
  };
  const call = async model => {
    const t0 = Date.now();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS(model)),
      });
      const j = await r.json();
      console.log(`AI ${model}: ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s${j.error ? ` ${j.error.message.slice(0, 60)}` : ''}`);
      return { r, j, model };
    } catch (e) {
      console.log(`AI ${model}: no answer in ${((Date.now() - t0) / 1000).toFixed(1)} s (${e.name})`);
      return { r: { ok: false, status: 504 }, j: { error: { message: `${model} did not answer in time` } }, model };
    }
  };
  try {
    // retired model -> rolling alias; busy (429/5xx, "high demand") -> one retry after a pause, then the alias
    const retired = x => !x.r.ok && (x.r.status === 404 || /no longer available|not found/i.test(x.j.error?.message || ''));
    const busy = x => !x.r.ok && (x.r.status === 429 || x.r.status >= 500 || /high demand|overloaded|try again/i.test(x.j.error?.message || ''));
    let out = await call(MODEL());
    for (const m of FALLBACKS) { if (!(retired(out) || busy(out))) break; if (m !== MODEL()) out = await call(m); }
    let { r, j, model } = out;
    if (!r.ok) return sendJSON(res, 502, { error: 'provider', message: j.error?.message || `Gemini returned ${r.status}` });
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    let advice;
    try { advice = JSON.parse(text); } catch { return sendJSON(res, 502, { error: 'format', message: 'The model did not return valid JSON.' }); }
    sendJSON(res, 200, { model, advice });
  } catch (e) { sendJSON(res, 502, { error: 'network', message: e.message }); }
}

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/api/ai-status') return sendJSON(res, 200, { enabled: !!process.env.GEMINI_API_KEY, model: MODEL() });
  if (urlPath === '/api/advise' && req.method === 'POST') return advise(req, res);
  let file = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
  // never serve dot files (.env holds the API key) or anything outside the project folder
  if (!file.startsWith(root) || path.relative(root, file).split(path.sep).some(p => p.startsWith('.'))) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, () => console.log(`Work Zone Impact Simulator running at http://localhost:${port}${process.env.GEMINI_API_KEY ? ` (AI advice: ${MODEL()})` : ''}`));
