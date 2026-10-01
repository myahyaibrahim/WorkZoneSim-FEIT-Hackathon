// Netlify Edge Function: tells the app whether AI advice is set up (same as /api/ai-status in server.js).
const env = k => (globalThis.Netlify?.env?.get(k)) ?? (globalThis.Deno?.env?.get(k));
export default async () => new Response(JSON.stringify({ enabled: !!env('GEMINI_API_KEY'), model: env('GEMINI_MODEL') || 'gemini-3.8-flash' }),
  { headers: { 'Content-Type': 'application/json' } });
export const config = { path: '/api/ai-status' };
