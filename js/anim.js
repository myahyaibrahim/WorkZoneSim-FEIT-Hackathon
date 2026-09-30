// Live microsimulation view: runs a MicroSim in real time (× speed) and draws every vehicle in its lane, plus the
// state of each traffic signal at its stop line. What you see is the microsimulation itself, not a replay.
import { MicroSim } from './micro.js';
import { MICRO } from './standards.js';
import { cumulativeLengths, pointAlong } from './geo.js';

const LANE_W = 3.5;

// A three-aspect signal head (red / amber / green) on a short pole; the lit aspect glows, the others are dimmed.
function drawSignalHead(ctx, x, y, k, state) {
  const w = 9 * k, h = 24 * k, r = 2.9 * k;
  ctx.save();
  ctx.translate(x, y);
  // pole
  ctx.fillStyle = '#4b5563'; ctx.fillRect(-0.9 * k, 0, 1.8 * k, 8 * k);
  // housing with a back plate
  ctx.fillStyle = '#facc15'; roundRect(ctx, -w / 2 - 1.6 * k, -h - 1.6 * k, w + 3.2 * k, h + 3.2 * k, 2.5 * k); ctx.fill();
  ctx.fillStyle = '#111827'; roundRect(ctx, -w / 2, -h, w, h, 2 * k); ctx.fill();
  const lamps = [['red', '#ef4444', '#3f1414'], ['amber', '#f59e0b', '#3d2a0a'], ['green', '#22c55e', '#0f2f1a']];
  lamps.forEach(([name, on, off], i) => {
    const cy = -h + (i + 0.5) * (h / 3);
    const lit = name === state;
    if (lit) { ctx.shadowColor = on; ctx.shadowBlur = 6 * k; }
    ctx.beginPath(); ctx.arc(0, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = lit ? on : off; ctx.fill();
    ctx.shadowBlur = 0;
    if (lit) { ctx.beginPath(); ctx.arc(-r * 0.3, cy - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill(); }
  });
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export class Animator {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'anim-canvas';
    map.getContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.running = false; this.speed = 5; this.colorBy = 'speed';
    this.sim = null;
    this.show = { vehicles: true, pt: true, signals: true }; // toggled from the map legend
    const resize = () => {
      const s = map.getSize(), dpr = window.devicePixelRatio || 1;
      this.canvas.width = s.x * dpr; this.canvas.height = s.y * dpr;
      this.canvas.style.width = s.x + 'px'; this.canvas.style.height = s.y + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    };
    map.on('resize', resize); map.on('move zoom', () => this.draw());
    resize();
    this.loop = this.loop.bind(this);
  }

  clear() { this.sim = null; this.pt = null; this.draw(); }

  // Scheduled public transport: trams and buses run along their GTFS shape at the scheduled speed, spaced by the
  // timetable headway of the analysis hour (data/pt_shapes.json, data/pt_service.json). Positions follow the
  // timetable, not live locations. In the work zone view, services cut by the closure are not drawn across it and
  // replacement buses shuttle on their route.
  setPT(pt) { this.pt = pt; this.draw(); }
  drawPT(ctx, toPt, scale, s) {
    const t = this.sim.t;
    // vehicle bodies contrast with the route lines they run on: light teal trams, white buses, dark outlines
    const BODY = { tram: ['#2dd4bf', '#134e4a'], bus: ['#ffffff', '#334155'] };
    const box = (x, y, brg, L, W, mode) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate((brg - 90) * Math.PI / 180);
      ctx.fillStyle = BODY[mode][0]; ctx.strokeStyle = BODY[mode][1]; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-L / 2, -W / 2, L, W, W / 3) : ctx.rect(-L / 2, -W / 2, L, W); ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    const at = (r, d) => { const q = pointAlong(r.xy, r.cum, d); return { pt: toPt(q.p), brg: q.brg }; };
    for (const r of this.pt.routes) {
      const v = r.kmh / 3.6, gap = r.headway * v;
      if (!(gap > 0)) continue;
      const L = r.len, off = (t * v + r.phase) % gap;
      const len = (r.mode === 'tram' ? 30 : 12.5), Lpx = Math.max(r.mode === 'tram' ? 15 : 9, len * scale), Wpx = Math.max(5, 2.6 * scale);
      for (let d = off; d <= L; d += gap) {
        if (r.hide && d >= r.hide[0] && d <= r.hide[1]) continue;
        const p = at(r, d);
        if (p.pt.x < -20 || p.pt.y < -20 || p.pt.x > s.x + 20 || p.pt.y > s.y + 20) continue;
        box(p.pt.x, p.pt.y, p.brg, Lpx, Wpx, r.mode);
      }
    }
    for (const r of this.pt.shuttles) {
      const v = r.len / Math.max(60, r.oneWaySec), period = 2 * r.len / v;
      for (let k = 0; k < r.n; k++) {
        const ph = (t + k * period / r.n) % period, d = ph < period / 2 ? ph * v : (period - ph) * v;
        const p = at(r, Math.min(r.len, d));
        box(p.pt.x, p.pt.y, p.brg, Math.max(7, 12.5 * scale), Math.max(4, 2.6 * scale), 'bus');
      }
    }
  }

  // microCtx: the same context the batch microsimulation used; mode 'base' | 'scen'
  load(net, microCtx, mode, startHour) {
    this.net = net; this.g = net.veh; this.startHour = startHour;
    this.sim = new MicroSim(microCtx, mode);
    this.geom = new Map();
    // warm up so the network is loaded when the view starts (same warm-up as the measured runs)
    while (this.sim.t < MICRO.warmup) this.sim.step();
    this.draw();
  }

  edgeGeom(e) {
    let gm = this.geom.get(e);
    if (!gm) {
      const g = this.g, L = g.links[g.link[e]];
      const xy = g.dir[e] === 1 ? L.xy : L.xy.slice().reverse();
      // lanes of this direction sit left of the link centre line on two-way roads (left-hand traffic);
      // on one-way carriageways the centre line is the carriageway centre
      gm = { xy, cum: cumulativeLengths(xy), oneway: !!L.oneway, n: g.lanes[e] };
      this.geom.set(e, gm);
    }
    return gm;
  }

  vehiclePoint(e, lane, pos) {
    const gm = this.edgeGeom(e), total = gm.cum[gm.cum.length - 1];
    const r = pointAlong(gm.xy, gm.cum, Math.min(total, pos * total / this.g.len[e]));
    const off = gm.oneway ? ((gm.n - 1) / 2 - lane) * LANE_W : (gm.n - lane - 0.5) * LANE_W;
    const rad = r.brg * Math.PI / 180, nx = -Math.cos(rad), ny = Math.sin(rad);
    return { xy: [r.p[0] + nx * off, r.p[1] + ny * off], brg: r.brg };
  }

  color(v, e) {
    if (this.colorBy === 'route') return v.cls === 'habitual' ? (v.rerouted ? '#e11d48' : '#7c3aed') : '#3b82f6';
    const r = v.v / Math.max(1, this.sim.vmax[e]);
    return r > 0.6 ? '#16a34a' : r > 0.25 ? '#f59e0b' : '#dc2626';
  }

  draw() {
    const ctx = this.ctx, s = this.map.getSize();
    ctx.clearRect(0, 0, s.x, s.y);
    const sim = this.sim;
    if (!sim) return;
    const z = this.map.getZoom();
    const P = this.net.proj, map = this.map;
    const toPt = xy => map.latLngToContainerPoint(P.inv(xy[0], xy[1]));
    const mpp = 40075016 * Math.cos(this.net.center[0] * Math.PI / 180) / Math.pow(2, z + 8); // metres per pixel
    const scale = 1 / mpp;
    const g = this.g;
    // vehicles as oriented rectangles (length × 1.8 m), with a minimum on-screen size
    if (this.show.vehicles) for (let e = 0; e < g.m; e++) {
      const lanes = sim.lanes[e];
      for (let li = 0; li < lanes.length; li++) {
        for (const v of lanes[li]) {
          const p = this.vehiclePoint(e, li, Math.max(0, v.pos - v.len / 2));
          const pt = toPt(p.xy);
          if (pt.x < -10 || pt.y < -10 || pt.x > s.x + 10 || pt.y > s.y + 10) continue;
          const L = Math.max(5, v.len * scale), W = Math.max(2.6, 1.8 * scale);
          ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate((p.brg - 90) * Math.PI / 180 + 0);
          ctx.fillStyle = this.color(v, e);
          ctx.fillRect(-L / 2, -W / 2, L, W);
          ctx.restore();
        }
      }
    }
    if (this.pt && this.show.pt) this.drawPT(ctx, toPt, scale, s);
    // traffic signal heads: one per approach, on a pole at the kerb (left) side just before the stop line
    if (z >= 16 && this.show.signals) for (const [node, plan] of sim.signals) {
      for (const [e] of plan.phaseOf) {
        if (sim.internal(e)) continue;
        const gm = this.edgeGeom(e), total = gm.cum[gm.cum.length - 1];
        // pole on the kerb side, set back from the stop line along the approach so each approach reads separately
        const back = Math.min(total * 0.6, z >= 18 ? 9 : z >= 17 ? 14 : 22);
        const r = pointAlong(gm.xy, gm.cum, Math.max(0, total - back));
        const rad = r.brg * Math.PI / 180, nx = -Math.cos(rad), ny = Math.sin(rad);
        const kerb = (gm.oneway ? gm.n / 2 : gm.n) * LANE_W + (z >= 18 ? 3 : 6);
        const pt = toPt([r.p[0] + nx * kerb, r.p[1] + ny * kerb]);
        drawSignalHead(ctx, pt.x, pt.y, z >= 18 ? 1.25 : z >= 17 ? 1 : z >= 16 ? 0.8 : 0.62, sim.signalState(node, e));
      }
    }
  }

  get vehicles() { return this.sim ? this.sim.active() : 0; }

  clockLabel() {
    const t = this.startHour * 3600 + (this.sim ? this.sim.t - MICRO.warmup : 0);
    const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, sec = Math.floor(t) % 60;
    return `${String((h + 24) % 24).padStart(2, '0')}:${String((m + 60) % 60).padStart(2, '0')}:${String((sec + 60) % 60).padStart(2, '0')}`;
  }

  play() { if (this.running || !this.sim) return; this.running = true; this.last = performance.now(); this.acc = 0; requestAnimationFrame(this.loop); }
  pause() { this.running = false; }
  loop(now) {
    if (!this.running) return;
    const dtReal = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.acc += dtReal * this.speed;
    let steps = 0;
    while (this.acc >= this.sim.dt && steps < 400) { this.sim.step(); this.acc -= this.sim.dt; steps++; }
    this.draw();
    this.onTick?.();
    requestAnimationFrame(this.loop);
  }
}
