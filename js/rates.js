// Equipment hire rate card and bill of materials for the Procurement stage.
// The default rates are PLACEHOLDERS for the demo, not RPM Hire prices. They are editable in the app and saved in
// this browser; replace them with the RPM Hire rate card. Totals exclude GST (10% shown separately).
export const RATE_NOTE = 'Indicative placeholder rates for the demo, not RPM Hire prices. Replace them with the RPM Hire rate card.';

export const DEFAULT_RATES = {
  items: {
    barrier: { unit: 'day', rate: 3 }, cone: { unit: 'day', rate: 0.5 }, fence: { unit: 'day', rate: 2 },
    sign_rwa: { unit: 'day', rate: 5 }, sign_closed: { unit: 'day', rate: 5 }, sign_detour: { unit: 'day', rate: 5 }, sign_end: { unit: 'day', rate: 5 },
    sign_speed: { unit: 'day', rate: 5 }, sign_lane: { unit: 'day', rate: 5 }, sign_stop: { unit: 'day', rate: 5 }, sign_fp: { unit: 'day', rate: 5 },
    vms: { unit: 'day', rate: 150 }, arrow: { unit: 'day', rate: 90 }, tc: { unit: 'hour', rate: 75 },
  },
  fixed: [
    { key: 'delivery', label: 'Delivery and collection', amount: 350 },
    { key: 'admin', label: 'Administration', amount: 150 },
    { key: 'permit', label: 'Council road occupation permit (estimate)', amount: 400 },
  ],
  placeholder: true,
};

const KEY = 'wzs.rates.v1';
export function loadRates() {
  try { const j = JSON.parse(localStorage.getItem(KEY)); if (j?.items) return j; } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_RATES));
}
export function saveRates(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch {} }
export function resetRates() { try { localStorage.removeItem(KEY); } catch {} return JSON.parse(JSON.stringify(DEFAULT_RATES)); }

// Bill of materials for a plan: quantities from the equipment plan (or the user's edited quantities), hire days from
// the schedule, traffic controllers charged per on-site hour.
export function buildBOM(plan, inventory, sched, hours, rates, qtyOverride = {}) {
  const label = k => inventory.find(i => i.key === k)?.label.replace(/[“”"]/g, '') || k;
  const lines = [];
  for (const it of plan.items) {
    const qty = qtyOverride[it.key] ?? it.required;
    if (!(it.required > 0) && !(qtyOverride[it.key] > 0)) continue;
    const rc = rates.items[it.key] || { unit: 'day', rate: 0 };
    const units = rc.unit === 'hour' ? Math.ceil(hours.total) : sched.days;
    lines.push({ key: it.key, label: label(it.key), required: it.required, qty, unit: rc.unit, rate: rc.rate, units, subtotal: qty * units * rc.rate, stock: it.stock });
  }
  const equipment = lines.reduce((a, l) => a + l.subtotal, 0);
  const fixed = rates.fixed.reduce((a, f) => a + (+f.amount || 0), 0);
  const net = equipment + fixed;
  return { lines, fixed: rates.fixed, equipment, fixedTotal: fixed, net, gst: net * 0.1, gross: net * 1.1 };
}
