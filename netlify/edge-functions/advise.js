// Netlify Edge Function: the same AI advice endpoint as server.js (/api/advise), for the Netlify deployment.
// Set GEMINI_API_KEY (and optionally GEMINI_MODEL) in Netlify: Site configuration > Environment variables.
// The key stays on Netlify; the browser never sees it. An edge function is used because LLM calls can take longer
// than the time limit of a regular Netlify Function.
const env = k => (globalThis.Netlify?.env?.get(k)) ?? (globalThis.Deno?.env?.get(k));
const MODEL = () => env('GEMINI_MODEL') || 'gemini-3.8-flash';
const FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'];
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

const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { 'Content-Type': 'application/json' } });

export default async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method' });
  const key = env('GEMINI_API_KEY');
  if (!key) return json(503, { error: 'no_key', message: 'Set GEMINI_API_KEY in the Netlify environment variables and redeploy.' });
  let raw, input;
  try { raw = await request.text(); if (raw.length > 200000) return json(413, { error: 'too_large' }); input = JSON.parse(raw); }
  catch { return json(400, { error: 'bad_request' }); }
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
      console.log(`AI ${model}: ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s${j.error ? ` ${String(j.error.message).slice(0, 60)}` : ''}`);
      return { r, j, model };
    } catch (e) {
      console.log(`AI ${model}: no answer in ${((Date.now() - t0) / 1000).toFixed(1)} s (${e.name})`);
      return { r: { ok: false, status: 504 }, j: { error: { message: `${model} did not answer in time` } }, model };
    }
  };
  try {
    const retired = x => !x.r.ok && (x.r.status === 404 || /no longer available|not found/i.test(x.j.error?.message || ''));
    const busy = x => !x.r.ok && (x.r.status === 429 || x.r.status >= 500 || /high demand|overloaded|try again/i.test(x.j.error?.message || ''));
    let out = await call(MODEL());
    for (const m of FALLBACKS) { if (!(retired(out) || busy(out))) break; if (m !== MODEL()) out = await call(m); }
    const { r, j, model } = out;
    if (!r.ok) return json(502, { error: 'provider', message: j.error?.message || `Gemini returned ${r.status}` });
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    let advice;
    try { advice = JSON.parse(text); } catch { return json(502, { error: 'format', message: 'The model did not return valid JSON.' }); }
    return json(200, { model, advice });
  } catch (e) { return json(502, { error: 'network', message: e.message }); }
};

export const config = { path: '/api/advise' };
