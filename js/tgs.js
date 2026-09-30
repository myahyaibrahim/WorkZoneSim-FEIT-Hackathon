// Traffic Guidance Scheme (TGS) drawing sheet: an A4 portrait sheet in the style of a TGS diagram, roads drawn to
// carriageway width with lane markings, tram tracks, hatched work area, delineation, sign plates facing traffic,
// traffic controllers, dimension lines, legend, notes, aerial inset and a title block. Geometry comes from
// OpenStreetMap, so the sheet is an indicative plan, not a surveyed drawing.
import { signSpacingD, taperLength, coneSpacing, DEFAULT_LANE_WIDTH } from './standards.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHEET_W = 1000, SHEET_H = 1414, M = 28;           // A4 portrait proportions
const MAP = { x: M, y: M, w: SHEET_W - 2 * M, h: 1150 }; // drawing area
const TB = { x: M, y: MAP.y + MAP.h + 10, w: SHEET_W - 2 * M, h: SHEET_H - (MAP.y + MAP.h + 10) - M };

const SIGN_STYLE = {
  sign_rwa:    { bg: '#facc15', fg: '#111', lines: ['ROAD WORK', 'AHEAD'] },
  sign_closed: { bg: '#facc15', fg: '#111', lines: ['ROAD', 'CLOSED'] },
  sign_detour: { bg: '#facc15', fg: '#111', lines: ['DETOUR'] },
  sign_end:    { bg: '#facc15', fg: '#111', lines: ['END', 'ROAD WORK'] },
  sign_lane:   { bg: '#facc15', fg: '#111', lines: ['LANE', 'CLOSED'] },
  sign_stop:   { bg: '#dc2626', fg: '#fff', lines: ['PREPARE', 'TO STOP'] },
  sign_fp:     { bg: '#facc15', fg: '#111', lines: ['FOOTPATH', 'CLOSED'] },
};

function offsetLine(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [p[0] - dy / L * off, p[1] + dx / L * off];
  });
}

// mode 'site': rotated so the work zone runs vertically, zoomed to the site; 'detour': north-up, whole detour.
export function tgsSheet(ctx, mode = 'site') {
  const { net, closures, plan, app, appr, aerial, sheetNo, sheetCount, CLOSURE_TYPES } = ctx;
  const g = net.veh, P = net.proj;
  const c0 = closures[0];
  const axis = [c0.poly[0], c0.poly[c0.poly.length - 1]];
  let brg = Math.atan2(axis[1][0] - axis[0][0], axis[1][1] - axis[0][1]); // radians from north, clockwise
  if (mode === 'detour') brg = 0;
  const cosb = Math.cos(brg), sinb = Math.sin(brg);
  // centre on the work zone(s)
  const cpts = closures.flatMap(c => c.poly);
  const C = [cpts.reduce((s, p) => s + p[0], 0) / cpts.length, cpts.reduce((s, p) => s + p[1], 0) / cpts.length];
  const rot = p => { const x = p[0] - C[0], y = p[1] - C[1]; return [x * cosb - y * sinb, x * sinb + y * cosb]; };
  const vmax = Math.max(...closures.flatMap(c => c.links.map(l => g.links[l].speed)));
  const reach = Math.max(60, 2 * signSpacingD(vmax) + 30);
  const nearWork = xy => closures.some(c => c.poly.some(q => Math.hypot(q[0] - xy[0], q[1] - xy[1]) < reach));
  const ext = [...cpts];
  for (const mk of plan.markers) { const xy = P.fwd(mk.ll[0], mk.ll[1]); if (mode === 'detour' ? ['sign_detour', 'sign_end', 'vms'].includes(mk.item) : mk.item !== 'vms' && nearWork(xy)) ext.push(xy); }
  if (mode === 'detour') for (const d of plan.detours) for (const ll of d.ll) ext.push(P.fwd(ll[0], ll[1]));
  const R = ext.map(rot);
  const pad = mode === 'site' ? 40 : 70;
  let minU = Math.min(...R.map(p => p[0])) - pad, maxU = Math.max(...R.map(p => p[0])) + pad;
  let minV = Math.min(...R.map(p => p[1])) - pad, maxV = Math.max(...R.map(p => p[1])) + pad;
  const minSpan = mode === 'site' ? 160 : 400;
  if (maxU - minU < minSpan) { const m = (maxU + minU) / 2; minU = m - minSpan / 2; maxU = m + minSpan / 2; }
  if (maxV - minV < minSpan) { const m = (maxV + minV) / 2; minV = m - minSpan / 2; maxV = m + minSpan / 2; }
  const k = Math.min(MAP.w / (maxU - minU), MAP.h / (maxV - minV));
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  const S = p => { const q = rot(p); return [MAP.x + MAP.w / 2 + (q[0] - cu) * k, MAP.y + MAP.h / 2 - (q[1] - cv) * k]; };
  const d = pts => pts.map((p, i) => { const s = S(p); return `${i ? 'L' : 'M'}${s[0].toFixed(1)},${s[1].toFixed(1)}`; }).join('');
  const inView = pts => pts.some(p => { const s = S(p); return s[0] > MAP.x - 80 && s[0] < MAP.x + MAP.w + 80 && s[1] > MAP.y - 80 && s[1] < MAP.y + MAP.h + 80; });
  const screenAngle = (a, b) => { const sa = S(a), sb = S(b); let ang = Math.atan2(sb[1] - sa[1], sb[0] - sa[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180; return ang; };
  const px = m => m * k;

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" width="100%" style="display:block;page-break-inside:avoid;break-inside:avoid;background:#fff">`);
  o.push(`<defs>
    <clipPath id="clip${mode}"><rect x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}"/></clipPath>
    <pattern id="hatch${mode}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#bbf7d0" fill-opacity="0.55"/><line x1="0" y1="0" x2="0" y2="8" stroke="#16a34a" stroke-width="2"/></pattern>
    <marker id="arr${mode}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7c3aed"/></marker>
    <marker id="tick${mode}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M5,0 L5,10" stroke="#111" stroke-width="1.6"/></marker>
  </defs>`);
  o.push(`<rect x="${M / 2}" y="${M / 2}" width="${SHEET_W - M}" height="${SHEET_H - M}" fill="none" stroke="#111" stroke-width="1.5"/>`);
  o.push(`<g clip-path="url(#clip${mode})"><rect x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}" fill="#f4f4ef"/>`);

  // --- roads to carriageway width
  const links = g.links.filter(L => inView(L.xy));
  const width = L => (L.oneway ? L.lanesF : L.lanesF + L.lanesB) * DEFAULT_LANE_WIDTH;
  for (const L of links) o.push(`<path d="${d(L.xy)}" stroke="#b9bcc0" stroke-width="${(px(width(L)) + 5).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const L of links) o.push(`<path d="${d(L.xy)}" stroke="#5b6066" stroke-width="${px(width(L)).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  // lane markings (only where lanes are wide enough to read)
  if (px(DEFAULT_LANE_WIDTH) > 7) for (const L of links) {
    const W = width(L);
    if (!L.oneway) o.push(`<path d="${d(L.xy)}" stroke="#fff" stroke-width="1.3" stroke-dasharray="9 7" fill="none"/>`);
    const perDir = L.oneway ? [[L.lanesF, -W / 2]] : [[L.lanesF, 0], [L.lanesB, 0]];
    perDir.forEach(([n, start], di) => {
      for (let i = 1; i < n; i++) {
        const off = L.oneway ? start + i * DEFAULT_LANE_WIDTH : (di === 0 ? -1 : 1) * i * DEFAULT_LANE_WIDTH;
        o.push(`<path d="${d(offsetLine(L.xy, off))}" stroke="#fff" stroke-width="1" stroke-dasharray="5 9" fill="none" opacity="0.9"/>`);
      }
    });
  }
  // tram tracks
  for (const t of net.tram) if (inView(t.xy)) {
    o.push(`<path d="${d(t.xy)}" stroke="#8b6b4a" stroke-width="${Math.max(5, px(2.6)).toFixed(1)}" stroke-dasharray="1.6 3.2" fill="none"/>`);
    for (const off of [-0.72, 0.72]) o.push(`<path d="${d(offsetLine(t.xy, off))}" stroke="#2f2f2f" stroke-width="0.9" fill="none"/>`);
  }
  // work area
  for (const c of closures) {
    if (c.type === 'full' || c.type === 'direction') {
      for (const lid of c.allLinks) { const L = g.links[lid]; o.push(`<path d="${d(L.xy)}" stroke="url(#hatch${mode})" stroke-width="${px(width(L)).toFixed(1)}" fill="none"/>`); }
    }
  }
  for (const l of plan.lines) {
    const pts = l.ll.map(ll => P.fwd(ll[0], ll[1]));
    if (l.kind === 'cones') {
      o.push(`<path d="${d(pts)}" stroke="url(#hatch${mode})" stroke-width="${px(DEFAULT_LANE_WIDTH).toFixed(1)}" fill="none" opacity="0.9"/>`);
    }
  }
  // street names (upper case, beside the road)
  const named = new Set();
  for (const L of [...links].sort((a, b) => a.rank - b.rank || b.len - a.len)) {
    if (named.has(L.name) || L.len < 50 || /^(Local street|Collector|Shared zone|Local road|Arterial link|Collector link|Highway link|Freeway ramp)$/.test(L.name)) continue;
    const i = L.xy.length >> 1, a = L.xy[Math.max(0, i - 1)], b = L.xy[Math.min(L.xy.length - 1, i + 1)];
    const off = offsetLine([a, L.xy[i], b], width(L) / 2 + 6)[1];
    const s = S(off);
    if (s[0] < MAP.x + 30 || s[0] > MAP.x + MAP.w - 30 || s[1] < MAP.y + 20 || s[1] > MAP.y + MAP.h - 20) continue;
    named.add(L.name);
    o.push(`<text x="${s[0].toFixed(1)}" y="${s[1].toFixed(1)}" transform="rotate(${screenAngle(a, b).toFixed(0)} ${s[0].toFixed(1)} ${s[1].toFixed(1)})" font-family="Arial" font-size="15" font-weight="700" fill="#1f2937" text-anchor="middle">${esc(L.name.toUpperCase())}</text>`);
    if (named.size > 12) break;
  }
  // detours
  for (const dt of plan.detours) o.push(`<path d="${d(dt.ll.map(ll => P.fwd(ll[0], ll[1])))}" stroke="#7c3aed" stroke-width="${mode === 'site' ? 3 : 5}" stroke-dasharray="12 7" fill="none" marker-end="url(#arr${mode})"/>`);
  // delineation: cones as bollard dots, barriers as orange/white bars, fencing
  const splitXY = (pts, f) => { if (f >= 1) return [pts, []]; const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const cut = c[c.length - 1] * Math.max(0, f); let i = 1; while (i < c.length - 1 && c[i] < cut) i++; const t = (cut - c[i - 1]) / Math.max(1e-9, c[i] - c[i - 1]);
    const p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; return [[...pts.slice(0, i), p], [p, ...pts.slice(i)]]; };
  const lineParts = plan.lines.flatMap(l => { const [a, b] = splitXY(l.ll.map(ll => P.fwd(ll[0], ll[1])), l.avail ?? 1); return [{ l, pts: a, short: false }, { l, pts: b, short: true }].filter(x => x.pts.length > 1); });
  for (const { l, pts, short } of lineParts) {
    if (short) o.push('<g opacity="0.35">');
    if (l.kind === 'cones') {
      const sp = Math.max(px(coneSpacing(40)), 7);
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = S(pts[i - 1]), b = S(pts[i]), seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = sp - acc; t <= seg; t += sp) o.push(`<circle cx="${(a[0] + (b[0] - a[0]) * t / seg).toFixed(1)}" cy="${(a[1] + (b[1] - a[1]) * t / seg).toFixed(1)}" r="3.2" fill="#f97316" stroke="#7c2d12" stroke-width="0.6"/>`);
        acc = (acc + seg) % sp;
      }
    } else if (l.kind === 'barrier') {
      o.push(`<path d="${d(pts)}" stroke="#111" stroke-width="7" fill="none"/><path d="${d(pts)}" stroke="#f97316" stroke-width="5" stroke-dasharray="6 6" fill="none"/><path d="${d(pts)}" stroke="#fff" stroke-width="5" stroke-dasharray="6 6" stroke-dashoffset="6" fill="none"/>`);
    } else {
      o.push(`<path d="${d(pts)}" stroke="#0369a1" stroke-width="2.4" stroke-dasharray="7 3" fill="none"/>`);
    }
    if (short) o.push(`</g><path d="${d(pts)}" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="3 3" fill="none"/>`);
  }
  // side panels sit on the side away from the work zone; their boxes are reserved so no sign lands on them
  const workX = cpts.reduce((a, p) => a + S(p)[0], 0) / cpts.length;
  const left = workX > MAP.x + MAP.w / 2;
  const leg = [
    ['<circle cx="8" cy="0" r="3.4" fill="#f97316" stroke="#7c2d12" stroke-width="0.6"/>', 'Bollard / cone'],
    [`<rect x="0" y="-6" width="16" height="12" fill="url(#hatch${mode})" stroke="#16a34a"/>`, 'Work area'],
    ['<path d="M0,0 h16" stroke="#111" stroke-width="7"/><path d="M0,0 h16" stroke="#f97316" stroke-width="5" stroke-dasharray="4 4"/>', 'Barrier'],
    ['<path d="M0,0 h16" stroke="#0369a1" stroke-width="2.4" stroke-dasharray="5 2"/>', 'Pedestrian fence'],
    ['<path d="M0,0 h16" stroke="#7c3aed" stroke-width="3" stroke-dasharray="6 3"/>', 'Signed detour'],
    ['<rect x="0" y="-6" width="16" height="12" fill="#facc15" stroke="#111"/>', 'Sign (number = schedule)'],
    ['<rect x="4" y="-6" width="8" height="12" rx="2" fill="#f97316" stroke="#111"/>', 'Traffic controller'],
    ['<circle cx="8" cy="0" r="2.5" fill="#111"/><path d="M8,0 l10,-6" stroke="#111" stroke-width="0.8"/>', 'Device position (leader)'],
    ...(plan.lines.some(l => (l.avail ?? 1) < 1) || plan.markers.some(m => m.missing) ? [['<g opacity="0.35"><path d="M0,0 h16" stroke="#f97316" stroke-width="5"/></g><path d="M0,0 h16" stroke="#dc2626" stroke-width="1.2" stroke-dasharray="3 3"/>', 'Not in depot stock']] : []),
  ];
  const legBox = { x: left ? MAP.x + 14 : MAP.x + MAP.w - 192, y: MAP.y + 14, w: 178, h: leg.length * 18 + 24 };
  const insetBox = aerial && mode === 'site' ? { x: left ? MAP.x + 11 : MAP.x + MAP.w - 277, y: legBox.y + legBox.h + 10, w: 266, h: 218 } : null;
  const notes = ctx.notes || [];
  const wrap = t => { const out = []; let cur = ''; for (const w of t.split(' ')) { if ((cur + ' ' + w).length > 70) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; } if (cur) out.push(cur); return out; };
  const noteRows = notes.flatMap((t, i) => wrap(`${i + 1}. ${t}`).map((l, j) => (j ? '    ' : '') + l));
  const noteBox = notes.length ? { w: 400, h: noteRows.length * 13 + 26 } : null;
  if (noteBox) { noteBox.x = left ? MAP.x + 12 : MAP.x + MAP.w - noteBox.w - 12; noteBox.y = MAP.y + MAP.h - noteBox.h - 44; }
  const northBox = { x: (left ? MAP.x + MAP.w - 38 : MAP.x + 38) - 26, y: MAP.y + 22, w: 52, h: 52 };
  const scaleBox = { x: MAP.x + 10, y: MAP.y + MAP.h - 34, w: 150, h: 30 };
  const placed = [legBox, northBox, scaleBox, ...(insetBox ? [insetBox] : []), ...(noteBox ? [noteBox] : [])];
  const hits = b => placed.some(p => b.x < p.x + p.w + 3 && b.x + b.w + 3 > p.x && b.y < p.y + p.h + 3 && b.y + b.h + 3 > p.y);
  const inside = b => b.x > MAP.x + 2 && b.y > MAP.y + 2 && b.x + b.w < MAP.x + MAP.w - 2 && b.y + b.h < MAP.y + MAP.h - 2;

  // devices
  const nearestAngle = xy => {
    let best = null;
    for (const L of links) for (let i = 1; i < L.xy.length; i++) {
      const a = L.xy[i - 1], b = L.xy[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((xy[0] - a[0]) * dx + (xy[1] - a[1]) * dy) / l2));
      const dd = Math.hypot(xy[0] - a[0] - t * dx, xy[1] - a[1] - t * dy);
      if (!best || dd < best.d) best = { d: dd, a, b };
    }
    return best ? screenAngle(best.a, best.b) : 0;
  };
  const workPts = closures.flatMap(c => c.poly);
  const items = [];
  plan.markers.forEach((mk, idx) => {
    if (mode === 'detour' && !['sign_detour', 'sign_end', 'vms'].includes(mk.item)) return;
    const xy = P.fwd(mk.ll[0], mk.ll[1]), s = S(xy);
    if (s[0] < MAP.x || s[0] > MAP.x + MAP.w || s[1] < MAP.y || s[1] > MAP.y + MAP.h) return;
    const ang = mk.item === 'tc' ? 0 : nearestAngle(xy);
    const miss = mk.missing ? ' stroke-dasharray="3 2"' : '';
    // dimension line from an advance sign to the point it is measured from (drawn at the true device position)
    const dist = /(\d+) m before/.exec(mk.sub || '');
    if (dist && mode === 'site') {
      const dm = +dist[1];
      let q = workPts[0], qd = Infinity;
      for (const w of workPts) { const dd = Math.hypot(w[0] - xy[0], w[1] - xy[1]); if (dd < qd) { qd = dd; q = w; } }
      const ux = (q[0] - xy[0]) / (qd || 1), uy = (q[1] - xy[1]) / (qd || 1);
      const end = [xy[0] + ux * Math.min(dm, qd), xy[1] + uy * Math.min(dm, qd)];
      const nx = -uy * 9, ny = ux * 9;
      const a = S([xy[0] + nx, xy[1] + ny]), b = S([end[0] + nx, end[1] + ny]);
      o.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#111" stroke-width="1" marker-start="url(#tick${mode})" marker-end="url(#tick${mode})"/>`);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let la = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; if (la > 90) la -= 180; if (la < -90) la += 180;
      o.push(`<text x="${m[0].toFixed(1)}" y="${m[1].toFixed(1)}" transform="rotate(${la.toFixed(0)} ${m[0].toFixed(1)} ${m[1].toFixed(1)})" dy="-4" font-family="Arial" font-size="12" font-weight="700" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${dm}M</text>`);
    }
    let body, w, h;
    if (SIGN_STYLE[mk.item]) {
      const st = SIGN_STYLE[mk.item];
      const lines = mk.item === 'sign_detour' && mk.arrow && mk.arrow !== 'start' ? ['DETOUR', mk.arrow === 'left' ? '◀' : '▶'] : st.lines;
      w = Math.max(...lines.map(t => t.length)) * 6.6 + 10; h = lines.length * 11 + 6;
      body = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="2" fill="${st.bg}" stroke="#111" stroke-width="1"${miss}/>` +
        lines.map((t, i) => `<text x="0" y="${-h / 2 + 12 + i * 11}" font-family="Arial" font-size="9.5" font-weight="700" text-anchor="middle" fill="${st.fg}">${esc(t)}</text>`).join('');
    } else if (mk.item === 'sign_speed') {
      w = h = 26; body = `<circle r="12" fill="#fff" stroke="#dc2626" stroke-width="3.5"${miss}/><text y="4" font-family="Arial" font-size="11" font-weight="700" text-anchor="middle">${esc(mk.text)}</text>`;
    } else if (mk.item === 'vms') {
      w = 60; h = 26; body = `<rect x="-30" y="-13" width="60" height="26" fill="#111" stroke="#475569" stroke-width="1.5"${miss}/><text y="-1" font-family="Arial" font-size="8.5" font-weight="700" fill="#fbbf24" text-anchor="middle">VMS</text><text y="9" font-family="Arial" font-size="6.5" fill="#fbbf24" text-anchor="middle">${esc((mk.message || '').split('|')[0].slice(0, 16))}</text>`;
    } else if (mk.item === 'arrow') {
      w = 36; h = 20; body = `<rect x="-18" y="-10" width="36" height="20" fill="#111"${miss}/><path d="M-11,0 L7,0 M1,-6 L8,0 L1,6" stroke="#fbbf24" stroke-width="2.4" fill="none"/>`;
    } else if (mk.item === 'tc') {
      w = 30; h = 30; body = `<circle cy="-9" r="4.2" fill="#fde68a" stroke="#111" stroke-width="0.8"/><path d="M-4.6,-10.5 h9.2" stroke="#facc15" stroke-width="3"/><rect x="-5.5" y="-4.5" width="11" height="12" rx="2" fill="#f97316" stroke="#111" stroke-width="0.8"/><path d="M-3,7.5 v7 M3,7.5 v7" stroke="#111" stroke-width="2"/><path d="M5.5,-2 l7,-5" stroke="#111" stroke-width="1.4"/><rect x="11" y="-12" width="7" height="7" fill="#dc2626"/>`;
    } else { w = h = 10; body = `<circle r="5" fill="#334155"/>`; }
    // axis-aligned half extents of the rotated plate, plus room for the number badge at its top-right corner
    const r = ang * Math.PI / 180, cw = Math.abs(Math.cos(r)), sw = Math.abs(Math.sin(r));
    const hw = (w / 2) * cw + (h / 2) * sw, hh = (w / 2) * sw + (h / 2) * cw;
    items.push({ idx, s, ang, body, hw: hw + 8, hh: hh + 8, missing: mk.missing });
  });
  // greedy placement: keep each plate at its device if free, else move it outwards along the road normal, then along
  // the road, and draw a leader from the device position to the moved plate
  for (const it of items) {
    const r = it.ang * Math.PI / 180, along = [Math.cos(r), Math.sin(r)], normal = [-Math.sin(r), Math.cos(r)];
    const cand = [[0, 0]];
    for (let step = 1; step <= 7; step++) {
      const dn = step * (it.hh * 2 + 4) * 0.7, da = step * (it.hw * 2 + 4) * 0.6;
      cand.push([normal[0] * dn, normal[1] * dn], [-normal[0] * dn, -normal[1] * dn], [along[0] * da, along[1] * da], [-along[0] * da, -along[1] * da],
        [normal[0] * dn + along[0] * da, normal[1] * dn + along[1] * da], [-normal[0] * dn - along[0] * da, -normal[1] * dn - along[1] * da]);
    }
    let pos = null;
    for (const [dx, dy] of cand) {
      const c = [it.s[0] + dx, it.s[1] + dy], b = { x: c[0] - it.hw, y: c[1] - it.hh, w: it.hw * 2, h: it.hh * 2 };
      if (inside(b) && !hits(b)) { pos = c; placed.push(b); break; }
    }
    if (!pos) { pos = it.s; placed.push({ x: pos[0] - it.hw, y: pos[1] - it.hh, w: it.hw * 2, h: it.hh * 2 }); }
    it.pos = pos;
  }
  for (const it of items) {
    const moved = Math.hypot(it.pos[0] - it.s[0], it.pos[1] - it.s[1]) > 2;
    if (moved) o.push(`<line x1="${it.s[0].toFixed(1)}" y1="${it.s[1].toFixed(1)}" x2="${it.pos[0].toFixed(1)}" y2="${it.pos[1].toFixed(1)}" stroke="#111" stroke-width="0.8"/><circle cx="${it.s[0].toFixed(1)}" cy="${it.s[1].toFixed(1)}" r="2.5" fill="#111"/>`);
  }
  for (const it of items) {
    o.push(`<g transform="translate(${it.pos[0].toFixed(1)},${it.pos[1].toFixed(1)}) rotate(${it.ang.toFixed(0)})">${it.body}</g>`);
    o.push(`<g transform="translate(${(it.pos[0] + it.hw - 7).toFixed(1)},${(it.pos[1] - it.hh + 7).toFixed(1)})"><circle r="7.5" fill="#fff" stroke="#111" stroke-width="0.9"/><text y="3" font-family="Arial" font-size="8.5" font-weight="700" text-anchor="middle">${it.idx + 1}</text></g>`);
  }
  if (mode === 'detour') {
    const s = S(C);
    o.push(`<g font-family="Arial"><rect x="${(s[0] - 70).toFixed(1)}" y="${(s[1] - 22).toFixed(1)}" width="140" height="44" rx="4" fill="#fff" stroke="#dc2626" stroke-width="2"/><text x="${s[0].toFixed(1)}" y="${(s[1] - 4).toFixed(1)}" font-size="12" font-weight="700" text-anchor="middle" fill="#b91c1c">WORK SITE</text><text x="${s[0].toFixed(1)}" y="${(s[1] + 12).toFixed(1)}" font-size="10.5" text-anchor="middle">see Sheet 1, Site TGS</text></g>`);
  }
  o.push('</g>');

  // north arrow and scale bar
  const na = mode === 'detour' ? 0 : -brg * 180 / Math.PI;
  o.push(`<g transform="translate(${northBox.x + 26},${northBox.y + 26}) rotate(${na.toFixed(1)})"><circle r="20" fill="#fff" stroke="#111"/><path d="M0,-16 L7,8 L0,3 L-7,8 z" fill="#111"/><text y="-22" font-family="Arial" font-size="12" font-weight="700" text-anchor="middle">N</text></g>`);
  const bar = [10, 20, 25, 50, 100, 200, 250, 500].find(m => m * k > 90) || 500;
  o.push(`<g font-family="Arial" font-size="11"><rect x="${MAP.x + 14}" y="${MAP.y + MAP.h - 30}" width="${(bar * k + 16).toFixed(1)}" height="24" fill="#fff" opacity="0.9"/><rect x="${MAP.x + 22}" y="${MAP.y + MAP.h - 14}" width="${(bar * k).toFixed(1)}" height="5" fill="#111"/><text x="${MAP.x + 22}" y="${MAP.y + MAP.h - 18}">0</text><text x="${(MAP.x + 22 + bar * k).toFixed(1)}" y="${MAP.y + MAP.h - 18}" text-anchor="end">${bar} m</text></g>`);

  // aerial inset (north up)
  if (insetBox) {
    const ix = insetBox.x + 3, iy = insetBox.y + 3, iw = insetBox.w - 6, ih = insetBox.h - 23;
    o.push(`<rect x="${insetBox.x}" y="${insetBox.y}" width="${insetBox.w}" height="${insetBox.h}" fill="#fff" stroke="#111"/><image href="${aerial}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid slice"/><text x="${ix + 2}" y="${iy + ih + 14}" font-family="Arial" font-size="9" fill="#334155">Aerial (north up) · Imagery © Esri, Maxar, Earthstar Geographics</text>`);
  }

  // legend
  o.push(`<g font-family="Arial" font-size="11"><rect x="${legBox.x}" y="${legBox.y}" width="${legBox.w}" height="${legBox.h}" fill="#fff" stroke="#111"/><text x="${legBox.x + 8}" y="${legBox.y + 16}" font-weight="700" font-size="12">Legend</text>` +
    leg.map((l, i) => `<g transform="translate(${legBox.x + 10},${legBox.y + 32 + i * 18})">${l[0]}<text x="24" y="4">${l[1]}</text></g>`).join('') + '</g>');

  // notes
  if (noteBox) {
    o.push(`<g font-family="Arial" font-size="10.5"><rect x="${noteBox.x}" y="${noteBox.y}" width="${noteBox.w}" height="${noteBox.h}" fill="#fff" stroke="#111"/><text x="${noteBox.x + 8}" y="${noteBox.y + 15}" font-weight="700" font-size="11.5">NOTES</text>` +
      noteRows.map((l, i) => `<text x="${noteBox.x + 8}" y="${noteBox.y + 30 + i * 13}" xml:space="preserve">${esc(l)}</text>`).join('') + '</g>');
  }

  // title block
  const cell = (x, y, w, h, lab, val) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#111"/><text x="${x + 6}" y="${y + 13}" font-family="Arial" font-size="9" fill="#475569">${esc(lab)}</text><text x="${x + 6}" y="${y + h - 9}" font-family="Arial" font-size="12.5" font-weight="700" fill="${val.ph ? '#b45309' : '#111'}">${esc(val.t)}</text>`;
  const v = (t, label) => t ? { t } : { t: `[${label}]`, ph: true };
  const tw = TB.w, c1 = tw * 0.33, c2 = tw * 0.23, c3 = tw * 0.22, c4 = tw - c1 - c2 - c3, rh = TB.h / 4;
  const street = closures.map(c => c.street).join(' / ');
  o.push(cell(TB.x, TB.y, c1, rh, 'Location', v(`${street}`, '')));
  o.push(cell(TB.x, TB.y + rh, c1, rh, 'Between', v(closures.map(c => { const m = ctx.meta(c); return m.from && m.to ? `${m.from} – ${m.to}` : ''; }).filter(Boolean).join('; '), 'cross streets')));
  o.push(cell(TB.x, TB.y + 2 * rh, c1, rh, 'Client / applicant', v(app.applicant, 'Applicant')));
  o.push(cell(TB.x, TB.y + 3 * rh, c1, rh, 'Description', v(closures.map(c => CLOSURE_TYPES[c.type]).join(', ') + (app.works ? `, ${app.works}` : ''), 'works')));
  o.push(cell(TB.x + c1, TB.y, c2, rh, 'Date', v(new Date().toLocaleDateString('en-AU'), '')));
  o.push(cell(TB.x + c1, TB.y + rh, c2, rh, 'Designed by', v(app.preparer, 'Designer, qualification')));
  o.push(cell(TB.x + c1, TB.y + 2 * rh, c2, rh, 'Revision', v(app.version, 'v1.0')));
  o.push(cell(TB.x + c1, TB.y + 3 * rh, c2, rh, 'Road authority', v(appr.arterial ? 'DTP (declared arterial)' : 'Council (local road)', '')));
  o.push(cell(TB.x + c1 + c2, TB.y, c3, rh, 'TMP / TGS No.', v(app.tmpNo, 'TMP no.')));
  o.push(cell(TB.x + c1 + c2, TB.y + rh, c3, rh, 'Sheet', v(`${sheetNo} of ${sheetCount}, ${mode === 'site' ? 'Site TGS' : 'Detour plan'}`, '')));
  o.push(cell(TB.x + c1 + c2, TB.y + 2 * rh, c3, rh, 'Works hours', v(app.hours, 'hours')));
  o.push(cell(TB.x + c1 + c2, TB.y + 3 * rh, c3, rh, 'Scale', v(`Bar scale · A4 ≈ 1:${Math.round(1000 / (k * 0.19) / 10) * 10}`, '')));
  o.push(`<rect x="${TB.x + c1 + c2 + c3}" y="${TB.y}" width="${c4}" height="${TB.h}" fill="#0b1f3a"/>
    <text x="${TB.x + c1 + c2 + c3 + 12}" y="${TB.y + 34}" font-family="Arial" font-size="14" font-weight="700" fill="#f59e0b">TRAFFIC GUIDANCE</text>
    <text x="${TB.x + c1 + c2 + c3 + 12}" y="${TB.y + 54}" font-family="Arial" font-size="14" font-weight="700" fill="#f59e0b">SCHEME</text>
    <text x="${TB.x + c1 + c2 + c3 + 12}" y="${TB.y + 80}" font-family="Arial" font-size="10" fill="#cbd5e1">${esc(app.applicant || '')}</text>
    <text x="${TB.x + c1 + c2 + c3 + 12}" y="${TB.y + TB.h - 30}" font-family="Arial" font-size="9" fill="#cbd5e1">Indicative, drawn from</text>
    <text x="${TB.x + c1 + c2 + c3 + 12}" y="${TB.y + TB.h - 16}" font-family="Arial" font-size="9" fill="#cbd5e1">OpenStreetMap, not surveyed</text>`);
  o.push('</svg>');
  return o.join('');
}

// Notes printed on the TGS sheet; each states its basis.
export function tgsNotes(net, closures, r) {
  const g = net.veh, notes = [];
  const speeds = [...new Set(closures.flatMap(c => c.links.map(l => Math.round(g.links[l].speed))))];
  const v = Math.max(...speeds), D = signSpacingD(v);
  notes.push(`Signs, spacing and delineation per AGTTM Part 3 as adopted by the Code of Practice for Worksite Safety – Traffic Management (2023) Cl. 5; confirm on site.`);
  notes.push(`Advance sign spacing D = ${D} m at ${v} km/h (QGTTM Pt 3 Table 2.2); single advance sign at 2D = ${2 * D} m.`);
  const lane = closures.find(c => c.type === 'lane' || c.type === 'shuttle');
  if (lane) notes.push(`Merge taper ${Math.round(taperLength(v, (lane.type === 'lane' ? lane.lanesClosed : 1) * DEFAULT_LANE_WIDTH))} m, cones at ${coneSpacing(v)} m max (TMR TN195).`);
  const temp = [...new Set(closures.filter(c => c.type !== 'full' && c.type !== 'direction').map(c => Math.max(40, c.speed)))];
  if (temp.length) notes.push(`Temporary works speed limit ${temp.join('/')} km/h; signs require a Memorandum of Authorisation.`);
  if (r.plan.detours.length) notes.push(`Signed detour shown in purple; see the detour plan sheet.`);
  const trams = [...new Set(r.pt.tram.filter(t => /interrupted/.test(t.status)).map(t => t.ref))];
  if (trams.length) notes.push(`Tram ${trams.join(', ')} interrupted, replacement buses and stop arrangements to be agreed with DTP / Yarra Trams.`);
  if (closures.some(c => c.footpath !== 'open')) notes.push(`Footpath closed as shown; pedestrians directed to the signed accessible route.`);
  notes.push(`Local residents and emergency vehicles: access arrangements to be confirmed by the works manager.`);
  notes.push(`Lane widths drawn at ${DEFAULT_LANE_WIDTH} m from OpenStreetMap lane counts; verify dimensions on site.`);
  return notes;
}
