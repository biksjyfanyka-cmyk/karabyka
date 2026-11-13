import { B, C, I, R, collidersNear, getBlock, mod } from './world';
import type { Block, Building } from './world';
import { GameAudio } from './audio';

const DT = 1 / 120;
const TAU = Math.PI * 2;
const PK = 0.0011; // сила параллакса для высоты зданий
const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function angDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

type Kind = 'car' | 'taxi' | 'bus' | 'van';

interface Body {
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  av: number;
  w: number;
  l: number;
  color: string;
  kind: Kind;
}

interface Player extends Body {
  steer: number;
  nitro: number;
  braking: boolean;
  slip: number;
  odo: number;
  throttle: number;
  vf: number;
  reverse: boolean;
}

interface AI extends Body {
  dir: number;
  speed: number;
  cruise: number;
  lane: number;
  wreck: boolean;
  wreckT: number;
  inInter: boolean;
  stopT: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  glow: boolean;
}

interface Skid {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GameOptions {
  color: string;
  onExit: () => void;
}

function laneCoord(dir: number, cx: number, cy: number) {
  switch (dir) {
    case 0:
      return cy + R / 4;
    case 1:
      return cx - R / 4;
    case 2:
      return cy - R / 4;
    default:
      return cx + R / 4;
  }
}

function circleOffsets(b: Body) {
  const r = b.w / 2 - 1;
  const n = Math.max(2, Math.round((b.l / b.w) * 1.5));
  const offs: number[] = [];
  const span = b.l - 2 * r;
  for (let i = 0; i < n; i++) offs.push(-(b.l / 2 - r) + (i * span) / (n - 1));
  return { r, offs };
}

const AI_COLORS = ['#d62839', '#3a86ff', '#f4f1de', '#2b2d42', '#8d99ae', '#06a77d', '#ff8c42', '#9b5de5', '#c0c5ce', '#e5383b', '#4cc9f0'];

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nightCanvas: HTMLCanvasElement;
  private nctx: CanvasRenderingContext2D;
  private audio = new GameAudio();
  private opts: GameOptions;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;

  private keys = new Set<string>();
  touch = { left: false, right: false, up: false, down: false, brake: false, nitro: false };

  private player: Player;
  private ai: AI[] = [];
  private particles: Particle[] = [];
  private skids: Skid[] = [];
  private prevWheels: number[] | null = null;

  private cam = { x: 0, y: 0 };
  private zoom = 1;
  private baseScale = 1;
  private scale = 1;
  private shake = 0;
  private night = 0;
  private nightTarget = 0;
  private crashes = 0;
  private crashCd = 0;
  private visR = 1500;
  private TARGET = 30;

  onNightChange?: (night: boolean) => void;
  onMuteChange?: (muted: boolean) => void;

  constructor(canvas: HTMLCanvasElement, opts: GameOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.ctx = canvas.getContext('2d')!;
    this.nightCanvas = document.createElement('canvas');
    this.nctx = this.nightCanvas.getContext('2d')!;

    this.player = {
      x: R / 2 + R / 4,
      y: 380,
      a: -Math.PI / 2,
      vx: 0,
      vy: 0,
      av: 0,
      w: 36,
      l: 72,
      color: opts.color,
      kind: 'car',
      steer: 0,
      nitro: 100,
      braking: false,
      slip: 0,
      odo: 0,
      throttle: 0,
      vf: 0,
      reverse: false,
    };
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
    this.resize();
  }

  setColor(color: string) {
    this.player.color = color;
  }

  start() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.resize);
    window.addEventListener('blur', this.onBlur);
    this.audio.start();
    for (let i = 0; i < this.TARGET; i++) this.spawnAI(350, 1800);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('blur', this.onBlur);
    this.audio.destroy();
  }

  toggleNight() {
    this.nightTarget = this.nightTarget ? 0 : 1;
    this.onNightChange?.(!!this.nightTarget);
  }

  toggleMute() {
    const m = this.audio.toggleMute();
    this.onMuteChange?.(m);
  }

  honk(on: boolean) {
    this.audio.setHorn(on);
  }

  // ---------- ввод ----------
  private onBlur = () => {
    this.keys.clear();
    this.honk(false);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(code);
    this.audio.start();
    if (code === 'KeyN') this.toggleNight();
    else if (code === 'KeyM') this.toggleMute();
    else if (code === 'KeyH') this.honk(true);
    else if (code === 'KeyR') this.resetToRoad();
    else if (code === 'Escape') this.opts.onExit();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === 'KeyH') this.honk(false);
  };

  private readInput() {
    const k = this.keys;
    const t = this.touch;
    return {
      up: k.has('KeyW') || k.has('ArrowUp') || t.up,
      down: k.has('KeyS') || k.has('ArrowDown') || t.down,
      left: k.has('KeyA') || k.has('ArrowLeft') || t.left,
      right: k.has('KeyD') || k.has('ArrowRight') || t.right,
      brake: k.has('Space') || t.brake,
      nitro: k.has('ShiftLeft') || k.has('ShiftRight') || t.nitro,
    };
  }

  private resetToRoad() {
    const p = this.player;
    const mx = mod(p.x, C);
    const my = mod(p.y, C);
    if (mx >= R && my >= R) {
      const x0 = Math.floor(p.x / C) * C + R / 2;
      const y0 = Math.floor(p.y / C) * C + R / 2;
      const cands = [
        { d: Math.abs(x0 - p.x), x: x0, y: p.y, a: -Math.PI / 2 },
        { d: Math.abs(x0 + C - p.x), x: x0 + C, y: p.y, a: -Math.PI / 2 },
        { d: Math.abs(y0 - p.y), x: p.x, y: y0, a: 0 },
        { d: Math.abs(y0 + C - p.y), x: p.x, y: y0 + C, a: 0 },
      ].sort((a, b) => a.d - b.d)[0];
      p.x = cands.x;
      p.y = cands.y;
      p.a = cands.a;
    } else {
      p.a = Math.round(p.a / (Math.PI / 2)) * (Math.PI / 2);
    }
    p.vx = p.vy = p.av = 0;
    this.prevWheels = null;
  }

  // ---------- размеры ----------
  private resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.nightCanvas.width = this.canvas.width;
    this.nightCanvas.height = this.canvas.height;
    this.baseScale = clamp(Math.min(this.h / 760, this.w / 1000) * 1.05, 0.5, 1.3);
  };

  // ---------- цикл ----------
  private loop = (t: number) => {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.acc += dt;
    while (this.acc >= DT) {
      this.step(DT);
      this.acc -= DT;
    }
    this.time += dt;
    this.frame(dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  private frame(dt: number) {
    const p = this.player;
    const sp = Math.hypot(p.vx, p.vy);
    const k = 1 - Math.exp(-dt * 5);
    this.cam.x += (p.x + p.vx * 0.3 - this.cam.x) * k;
    this.cam.y += (p.y + p.vy * 0.3 - this.cam.y) * k;
    const tz = 1 - Math.min(sp / 1100, 1) * 0.3;
    this.zoom += (tz - this.zoom) * (1 - Math.exp(-dt * 2));
    this.scale = this.baseScale * this.zoom;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.night += (this.nightTarget - this.night) * (1 - Math.exp(-dt * 2.5));
    this.visR = Math.hypot(this.w, this.h) / 2 / (this.baseScale * 0.7) + 150;

    this.audio.update(clamp(Math.abs(p.vf) / 800, 0, 1.3), p.throttle, p.slip, p.nitro < 99.9 && this.readInput().nitro && p.throttle > 0);

    // трафик: спавн/удаление
    for (let i = this.ai.length - 1; i >= 0; i--) {
      const c = this.ai[i];
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d > this.visR + 1600 || (c.wreck && c.wreckT > 12 && d > this.visR * 0.6)) this.ai.splice(i, 1);
    }
    for (let i = 0; i < 2 && this.ai.length < this.TARGET; i++) this.spawnAI(this.visR * 1.05, this.visR * 1.05 + 800);

    this.render();
  }

  // ---------- физика ----------
  private step(dt: number) {
    this.crashCd = Math.max(0, this.crashCd - dt);
    this.stepPlayer(dt);
    const all: Body[] = [this.player, ...this.ai];
    for (const c of this.ai) this.stepAI(c, dt, all);
    for (const c of this.ai) {
      if (Math.abs(c.x - this.player.x) < 130 && Math.abs(c.y - this.player.y) < 130) this.collideCars(this.player, c);
    }
    // частицы
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= Math.exp(-2 * dt);
      q.vy *= Math.exp(-2 * dt);
      q.size += q.grow * dt;
    }
  }

  private stepPlayer(dt: number) {
    const p = this.player;
    const inp = this.readInput();
    const fx = Math.cos(p.a);
    const fy = Math.sin(p.a);
    const rx = -fy;
    const ry = fx;
    let vf = p.vx * fx + p.vy * fy;
    let vl = p.vx * rx + p.vy * ry;

    const nitroOn = inp.nitro && p.nitro > 0 && inp.up && vf > -10;
    p.braking = false;
    p.throttle = 0;
    if (inp.up) {
      if (vf < -20) {
        vf += 1100 * dt;
        p.braking = true;
      } else {
        const maxS = nitroOn ? 1050 : 760;
        const acc = (nitroOn ? 1200 : 560) * Math.max(0, 1 - vf / maxS);
        vf += acc * dt;
        p.throttle = 1;
      }
    } else if (inp.down) {
      if (vf > 20) {
        vf -= 1100 * dt;
        p.braking = true;
      } else {
        if (vf > -260) vf -= 380 * dt;
        p.throttle = 0.5;
      }
    } else {
      vf *= Math.exp(-0.5 * dt);
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), 40 * dt);
    }
    vf -= vf * Math.abs(vf) * 0.00008 * dt;
    if (inp.brake) {
      vf *= Math.exp(-0.8 * dt);
      p.braking = true;
    }

    const grip = inp.brake ? 1.3 : 9;
    const vlOld = vl;
    vl *= Math.exp(-grip * dt);
    if (!inp.brake) vf += Math.abs(vlOld - vl) * 0.35 * Math.sign(vf);

    // руль
    const target = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    p.steer += (target - p.steer) * Math.min(1, dt * (target === 0 ? 12 : 8));
    const sAbs = Math.abs(vf);
    let yaw = (p.steer * 2.9 * clamp(sAbs / 140, 0, 1)) / (1 + sAbs / 650);
    if (vf < 0) yaw = -yaw;
    if (inp.brake) yaw *= 1.45;

    p.vx = fx * vf + rx * vl;
    p.vy = fy * vf + ry * vl;
    p.a += (yaw + p.av) * dt;
    p.av *= Math.exp(-3 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vf = vf;
    p.slip = Math.abs(vl);
    p.reverse = vf < -15;

    // нитро
    if (nitroOn) p.nitro = Math.max(0, p.nitro - 28 * dt);
    else p.nitro = Math.min(100, p.nitro + 8 * dt);

    // столкновения со зданиями
    const impact = this.collideWorld(p);
    if (impact > 90) this.onImpact(impact, p.x, p.y);

    // пересчёт после столкновений
    const nfx = Math.cos(p.a);
    const nfy = Math.sin(p.a);
    p.odo += Math.hypot(p.vx, p.vy) * dt;

    // следы и дым
    const speed = Math.hypot(p.vx, p.vy);
    const slipping = p.slip > 120 || (p.braking && sAbs > 220 && !inp.up) || (inp.brake && speed > 150);
    const wx = [-p.l / 2 + 12, -p.l / 2 + 12];
    const wy = [-(p.w / 2 - 5), p.w / 2 - 5];
    const cur: number[] = [];
    for (let i = 0; i < 2; i++) {
      cur.push(p.x + nfx * wx[i] - nfy * wy[i], p.y + nfy * wx[i] + nfx * wy[i]);
    }
    if (slipping) {
      if (this.prevWheels) {
        for (let i = 0; i < 2; i++) {
          const px = this.prevWheels[i * 2];
          const py = this.prevWheels[i * 2 + 1];
          if (Math.hypot(cur[i * 2] - px, cur[i * 2 + 1] - py) > 7) {
            this.skids.push({ x1: px, y1: py, x2: cur[i * 2], y2: cur[i * 2 + 1] });
            this.prevWheels[i * 2] = cur[i * 2];
            this.prevWheels[i * 2 + 1] = cur[i * 2 + 1];
            if (this.skids.length > 1800) this.skids.splice(0, 200);
          }
        }
      } else this.prevWheels = cur;
      if (Math.random() < 0.35) {
        const i = Math.random() < 0.5 ? 0 : 1;
        this.addParticle(cur[i * 2], cur[i * 2 + 1], -p.vx * 0.05 + (Math.random() - 0.5) * 30, -p.vy * 0.05 + (Math.random() - 0.5) * 30, 0.9, 10, 40, 'rgba(225,225,230,0.5)');
      }
    } else this.prevWheels = null;

    if (nitroOn) {
      const bx = p.x - nfx * (p.l / 2 + 2);
      const by = p.y - nfy * (p.l / 2 + 2);
      for (let i = 0; i < 2; i++) {
        this.addParticle(bx + (Math.random() - 0.5) * 10, by + (Math.random() - 0.5) * 10, -nfx * 220 + (Math.random() - 0.5) * 60, -nfy * 220 + (Math.random() - 0.5) * 60, 0.28, 9, -20, Math.random() < 0.5 ? 'rgba(80,170,255,0.85)' : 'rgba(255,170,60,0.85)', true);
      }
    }
  }

  private addParticle(x: number, y: number, vx: number, vy: number, life: number, size: number, grow: number, color: string, glow = false) {
    if (this.particles.length > 260) return;
    this.particles.push({ x, y, vx, vy, life, max: life, size, grow, color, glow });
  }

  private onImpact(impact: number, x: number, y: number) {
    if (this.crashCd > 0) return;
    this.crashCd = 0.25;
    this.audio.crash(impact);
    this.shake = Math.max(this.shake, Math.min(1, impact / 700));
    if (impact > 230) this.crashes++;
    const n = Math.min(14, Math.floor(impact / 40));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 80 + Math.random() * 260;
      this.addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.25, 3, -3, 'rgba(255,205,90,0.95)', true);
    }
  }

  /** Столкновение тела с препятствиями города. Возвращает силу удара. */
  private collideWorld(b: Body) {
    const rects = collidersNear(b.x, b.y);
    const { r, offs } = circleOffsets(b);
    let impact = 0;
    for (let iter = 0; iter < 2; iter++) {
      const fx = Math.cos(b.a);
      const fy = Math.sin(b.a);
      for (const o of offs) {
        for (const rc of rects) {
          const cx = b.x + fx * o;
          const cy = b.y + fy * o;
          const px = clamp(cx, rc.x, rc.x + rc.w);
          const py = clamp(cy, rc.y, rc.y + rc.h);
          const dx = cx - px;
          const dy = cy - py;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          let nx: number;
          let ny: number;
          let pen: number;
          const d = Math.sqrt(d2);
          if (d > 0.0001) {
            nx = dx / d;
            ny = dy / d;
            pen = r - d;
          } else {
            const l = cx - rc.x;
            const rr = rc.x + rc.w - cx;
            const t = cy - rc.y;
            const bt = rc.y + rc.h - cy;
            const m = Math.min(l, rr, t, bt);
            if (m === l) {
              nx = -1;
              ny = 0;
              pen = l + r;
            } else if (m === rr) {
              nx = 1;
              ny = 0;
              pen = rr + r;
            } else if (m === t) {
              nx = 0;
              ny = -1;
              pen = t + r;
            } else {
              nx = 0;
              ny = 1;
              pen = bt + r;
            }
          }
          b.x += nx * pen;
          b.y += ny * pen;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            impact = Math.max(impact, -vn);
            const j = -(1 + 0.25) * vn;
            b.vx += j * nx;
            b.vy += j * ny;
            const tx = -ny;
            const ty = nx;
            const vt = b.vx * tx + b.vy * ty;
            b.vx -= vt * 0.005 * tx;
            b.vy -= vt * 0.005 * ty;
            // вращение от удара углом
            const relx = fx * o;
            const rely = fy * o;
            b.av = clamp(b.av + ((relx * ny - rely * nx) * j) / 1800, -5, 5);
          }
        }
      }
    }
    return impact;
  }

  private collideCars(p: Player, o: AI) {
    const A = circleOffsets(p);
    const Bc = circleOffsets(o);
    const pf = [Math.cos(p.a), Math.sin(p.a)];
    const of = [Math.cos(o.a), Math.sin(o.a)];
    let best = 0;
    let bn: [number, number] = [0, 0];
    let ra: [number, number] = [0, 0];
    let rb: [number, number] = [0, 0];
    for (const oa of A.offs) {
      for (const ob of Bc.offs) {
        const ax = p.x + pf[0] * oa;
        const ay = p.y + pf[1] * oa;
        const bx = o.x + of[0] * ob;
        const by = o.y + of[1] * ob;
        const dx = ax - bx;
        const dy = ay - by;
        const d = Math.hypot(dx, dy);
        const pen = A.r + Bc.r - d;
        if (pen > best) {
          best = pen;
          const dd = d || 0.001;
          bn = [dx / dd, dy / dd];
          ra = [pf[0] * oa, pf[1] * oa];
          rb = [of[0] * ob, of[1] * ob];
        }
      }
    }
    if (best <= 0) return;
    if (!o.wreck) {
      o.wreck = true;
      o.wreckT = 0;
      o.vx = DIRS[o.dir][0] * o.speed;
      o.vy = DIRS[o.dir][1] * o.speed;
    }
    const mp = 1;
    const mo = o.kind === 'bus' ? 2.4 : o.kind === 'van' ? 1.4 : 1;
    p.x += (bn[0] * best * mo) / (mp + mo);
    p.y += (bn[1] * best * mo) / (mp + mo);
    o.x -= (bn[0] * best * mp) / (mp + mo);
    o.y -= (bn[1] * best * mp) / (mp + mo);
    const rvx = p.vx - o.vx;
    const rvy = p.vy - o.vy;
    const vn = rvx * bn[0] + rvy * bn[1];
    if (vn < 0) {
      const j = (-(1 + 0.4) * vn) / (1 / mp + 1 / mo);
      p.vx += (j * bn[0]) / mp;
      p.vy += (j * bn[1]) / mp;
      o.vx -= (j * bn[0]) / mo;
      o.vy -= (j * bn[1]) / mo;
      p.av = clamp(p.av + ((ra[0] * bn[1] - ra[1] * bn[0]) * j) / 1800, -5, 5);
      o.av = clamp(o.av - ((rb[0] * bn[1] - rb[1] * bn[0]) * j) / 1800, -6, 6);
      const imp = -vn;
      if (imp > 60) this.onImpact(imp * 1.2, p.x - bn[0] * 18, p.y - bn[1] * 18);
    }
  }

  // ---------- трафик ----------
  private spawnAI(minR: number, maxR: number) {
    const p = this.player;
    for (let t = 0; t < 14; t++) {
      const ang = Math.random() * TAU;
      const d = minR + Math.random() * (maxR - minR);
      const px = p.x + Math.cos(ang) * d;
      const py = p.y + Math.sin(ang) * d;
      const kx = Math.floor(px / C);
      const ky = Math.floor(py / C);
      const horiz = Math.random() < 0.5;
      const fwd = Math.random() < 0.5;
      let dir: number;
      let x: number;
      let y: number;
      if (horiz) {
        dir = fwd ? 0 : 2;
        x = kx * C + R + Math.random() * B;
        y = laneCoord(dir, 0, ky * C + R / 2);
      } else {
        dir = fwd ? 1 : 3;
        y = ky * C + R + Math.random() * B;
        x = laneCoord(dir, kx * C + R / 2, 0);
      }
      if (Math.hypot(x - p.x, y - p.y) < minR * 0.9) continue;
      if (this.ai.some((o) => Math.hypot(o.x - x, o.y - y) < 130)) continue;

      const r = Math.random();
      let kind: Kind = 'car';
      let w = 35;
      let l = 70 + Math.random() * 6;
      let color = AI_COLORS[Math.floor(Math.random() * AI_COLORS.length)];
      if (r < 0.1) {
        kind = 'bus';
        w = 42;
        l = 124;
        color = Math.random() < 0.5 ? '#2f7fd0' : '#d9482b';
      } else if (r < 0.25) {
        kind = 'taxi';
        color = '#f2c230';
      } else if (r < 0.4) {
        kind = 'van';
        w = 38;
        l = 82;
        color = Math.random() < 0.5 ? '#e8e8ec' : '#7b8794';
      }
      const cruise = kind === 'bus' ? 150 + Math.random() * 40 : 170 + Math.random() * 130;
      const a = (dir * Math.PI) / 2;
      this.ai.push({
        x,
        y,
        a,
        vx: DIRS[dir][0] * cruise,
        vy: DIRS[dir][1] * cruise,
        av: 0,
        w,
        l,
        color,
        kind,
        dir,
        speed: cruise,
        cruise,
        lane: horiz ? y : x,
        wreck: false,
        wreckT: 0,
        inInter: mod(x, C) < R && mod(y, C) < R,
        stopT: 0,
      });
      return true;
    }
    return false;
  }

  private stepAI(c: AI, dt: number, all: Body[]) {
    if (c.wreck) {
      c.wreckT += dt;
      const f = Math.exp(-1.3 * dt);
      c.vx *= f;
      c.vy *= f;
      c.av *= Math.exp(-2 * dt);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.a += c.av * dt;
      if (Math.abs(c.vx) + Math.abs(c.vy) > 5) this.collideWorld(c);
      return;
    }
    const inter = mod(c.x, C) < R && mod(c.y, C) < R;
    if (inter && !c.inInter) {
      const cx = Math.floor(c.x / C) * C + R / 2;
      const cy = Math.floor(c.y / C) * C + R / 2;
      const r = Math.random();
      if (r > 0.55) c.dir = r < 0.78 ? (c.dir + 1) % 4 : (c.dir + 3) % 4;
      c.lane = laneCoord(c.dir, cx, cy);
    }
    c.inInter = inter;

    const d = DIRS[c.dir];
    // датчик впереди
    let blocked = false;
    const reach = 36 + c.speed * 0.6;
    for (const o of all) {
      if (o === c) continue;
      const rx = o.x - c.x;
      const ry = o.y - c.y;
      const ahead = rx * d[0] + ry * d[1];
      if (ahead <= 0 || ahead > reach + (o.l + c.l) / 2) continue;
      const lat = Math.abs(-rx * d[1] + ry * d[0]);
      if (lat < (o.w + c.w) / 2 + 8) {
        blocked = true;
        break;
      }
    }
    let targetSpeed = inter ? c.cruise * 0.75 : c.cruise;
    if (blocked) {
      if (c.stopT < 2.5) {
        targetSpeed = 0;
        if (c.speed < 8) c.stopT += dt;
      }
    } else c.stopT = 0;

    if (c.speed < targetSpeed) c.speed = Math.min(targetSpeed, c.speed + 220 * dt);
    else c.speed = Math.max(targetSpeed, c.speed - 800 * dt);

    c.x += d[0] * c.speed * dt;
    c.y += d[1] * c.speed * dt;
    const k = Math.min(1, dt * 3);
    if (c.dir === 0 || c.dir === 2) c.y += (c.lane - c.y) * k;
    else c.x += (c.lane - c.x) * k;
    c.a += angDiff(c.a, (c.dir * Math.PI) / 2) * Math.min(1, dt * 5);
    c.vx = d[0] * c.speed;
    c.vy = d[1] * c.speed;
  }

  // ---------- отрисовка ----------
  private render() {
    const { ctx, w, h, dpr, scale } = this;
    const p = this.player;
    const sh = this.shake * 10;
    const sx = (Math.random() - 0.5) * sh;
    const sy = (Math.random() - 0.5) * sh;
    const cam = this.cam;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#343a46';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (w / 2 - cam.x * scale + sx), dpr * (h / 2 - cam.y * scale + sy));

    const hw = w / 2 / scale + 220;
    const hh = h / 2 / scale + 220;
    const x0 = Math.floor((cam.x - hw) / C);
    const x1 = Math.floor((cam.x + hw) / C);
    const y0 = Math.floor((cam.y - hh) / C);
    const y1 = Math.floor((cam.y + hh) / C);

    const blocks: Block[] = [];
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        this.drawCellGround(i, j);
        blocks.push(getBlock(i, j));
      }
    }

    // следы шин
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10,10,14,0.28)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    const vx0 = cam.x - hw;
    const vx1 = cam.x + hw;
    const vy0 = cam.y - hh;
    const vy1 = cam.y + hh;
    for (const s of this.skids) {
      if (s.x1 < vx0 || s.x1 > vx1 || s.y1 < vy0 || s.y1 > vy1) continue;
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
    }
    ctx.stroke();

    // тени зданий
    const buildings: Building[] = [];
    for (const bl of blocks) for (const b of bl.buildings) buildings.push(b);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (const b of buildings) {
      const o = b.height * 0.2;
      ctx.fillRect(b.x + o * 0.6, b.y + o, b.w, b.h);
    }

    // припаркованные
    for (const bl of blocks) {
      for (const pc of bl.parked) this.drawCar({ x: pc.x, y: pc.y, a: pc.a, l: 52, w: 28, color: pc.color, kind: 'car' }, false);
    }

    // трафик
    const lim = this.visR;
    for (const c of this.ai) {
      if (Math.abs(c.x - cam.x) > lim || Math.abs(c.y - cam.y) > lim) continue;
      this.drawCar(c, !c.wreck && c.speed < c.cruise * 0.6, c.wreck);
    }
    // игрок
    this.drawCar(p, p.braking, false);

    // частицы
    for (const q of this.particles) {
      const t = q.life / q.max;
      ctx.globalAlpha = clamp(t * 1.4, 0, 1);
      ctx.fillStyle = q.color;
      if (q.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(0.5, q.size), 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;

    // здания (по убыванию расстояния до камеры)
    buildings.sort((a, b) => Math.hypot(b.x + b.w / 2 - cam.x, b.y + b.h / 2 - cam.y) - Math.hypot(a.x + a.w / 2 - cam.x, a.y + a.h / 2 - cam.y));
    for (const b of buildings) this.drawBuilding(b);

    // кроны деревьев
    for (const bl of blocks) {
      for (const t of bl.trees) {
        const ox = (t.x - cam.x) * 0.07;
        const oy = (t.y - cam.y) * 0.07;
        // тень
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.arc(t.x + 8, t.y + 10, t.r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(t.x + ox, t.y + oy, t.r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(t.x + ox - t.r * 0.25, t.y + oy - t.r * 0.25, t.r * 0.55, 0, TAU);
        ctx.fill();
      }
    }

    if (this.night > 0.02) this.renderNight(x0, x1, y0, y1);

    this.drawHUD();
  }

  private drawCellGround(i: number, j: number) {
    const { ctx } = this;
    const ox = i * C;
    const oy = j * C;
    const bl = getBlock(i, j);

    // бордюр и тротуар
    ctx.fillStyle = '#6f7480';
    ctx.fillRect(bl.ox - 3, bl.oy - 3, B + 6, B + 6);
    ctx.fillStyle = '#a3a6ae';
    ctx.fillRect(bl.ox, bl.oy, B, B);

    // внутренняя часть
    switch (bl.type) {
      case 'city':
        ctx.fillStyle = '#8b8e96';
        ctx.fillRect(bl.ix, bl.iy, I, I);
        break;
      case 'park': {
        ctx.fillStyle = '#4f9559';
        ctx.fillRect(bl.ix, bl.iy, I, I);
        ctx.fillStyle = '#5da768';
        for (let k = 0; k < 6; k++) ctx.fillRect(bl.ix + ((k * 97) % I), bl.iy + ((k * 61) % I), 50, 36);
        ctx.fillStyle = '#d9c9a0';
        ctx.fillRect(bl.ix + I / 2 - 20, bl.iy, 40, I);
        ctx.fillRect(bl.ix, bl.iy + I / 2 - 20, I, 40);
        ctx.beginPath();
        ctx.fillStyle = '#cdbb90';
        ctx.arc(bl.ix + I / 2, bl.iy + I / 2, 50, 0, TAU);
        ctx.fill();
        break;
      }
      case 'parking': {
        ctx.fillStyle = '#3d424e';
        ctx.fillRect(bl.ix, bl.iy, I, I);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const s of bl.stalls) {
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x, s.y + s.h);
        }
        ctx.stroke();
        break;
      }
      case 'plaza': {
        ctx.fillStyle = '#c7c0b2';
        ctx.fillRect(bl.ix, bl.iy, I, I);
        ctx.strokeStyle = 'rgba(0,0,0,0.07)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k <= I; k += 31) {
          ctx.moveTo(bl.ix + k, bl.iy);
          ctx.lineTo(bl.ix + k, bl.iy + I);
          ctx.moveTo(bl.ix, bl.iy + k);
          ctx.lineTo(bl.ix + I, bl.iy + k);
        }
        ctx.stroke();
        const cx = bl.ix + I / 2;
        const cy = bl.iy + I / 2;
        ctx.fillStyle = '#e7e9ee';
        ctx.beginPath();
        ctx.arc(cx, cy, 48, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#5db3e4';
        ctx.beginPath();
        ctx.arc(cx, cy, 40, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        for (let k = 0; k < 3; k++) {
          const rr = 8 + ((this.time * 12 + k * 11) % 32);
          ctx.globalAlpha = 1 - rr / 40;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e7e9ee';
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, TAU);
        ctx.fill();
        break;
      }
    }

    // разметка
    const yellow = '#d9b53a';
    ctx.fillStyle = yellow;
    // вертикальная дорога (под кварталом): центр x = ox + R/2
    ctx.fillRect(ox + R / 2 - 3.5, oy + R + 4, 2.5, B - 8);
    ctx.fillRect(ox + R / 2 + 1, oy + R + 4, 2.5, B - 8);
    // горизонтальная
    ctx.fillRect(ox + R + 4, oy + R / 2 - 3.5, B - 8, 2.5);
    ctx.fillRect(ox + R + 4, oy + R / 2 + 1, B - 8, 2.5);
    // края
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(ox + 4, oy + R + 4, 2.5, B - 8);
    ctx.fillRect(ox + R - 6.5, oy + R + 4, 2.5, B - 8);
    ctx.fillRect(ox + R + 4, oy + 4, B - 8, 2.5);
    ctx.fillRect(ox + R + 4, oy + R - 6.5, B - 8, 2.5);
    // зебры
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    for (let s = ox + 14; s < ox + R - 14; s += 16) {
      ctx.fillRect(s, oy + R + 8, 8, 22);
      ctx.fillRect(s, oy + C - 30, 8, 22);
    }
    for (let s = oy + 14; s < oy + R - 14; s += 16) {
      ctx.fillRect(ox + R + 8, s, 22, 8);
      ctx.fillRect(ox + C - 30, s, 22, 8);
    }
  }

  private drawBuilding(b: Building) {
    const { ctx, cam } = this;
    const k = PK * b.height;
    const xs = [b.x, b.x + b.w, b.x + b.w, b.x];
    const ys = [b.y, b.y, b.y + b.h, b.y + b.h];
    const tx = xs.map((x) => x + (x - cam.x) * k);
    const ty = ys.map((y) => y + (y - cam.y) * k);
    const visible = [cam.y < b.y, cam.x > b.x + b.w, cam.y > b.y + b.h, cam.x < b.x];
    const shade = [0.1, 0.3, 0.4, 0.2];
    const floors = Math.floor(b.height / 20);
    for (let e = 0; e < 4; e++) {
      if (!visible[e]) continue;
      const n = (e + 1) % 4;
      ctx.beginPath();
      ctx.moveTo(xs[e], ys[e]);
      ctx.lineTo(xs[n], ys[n]);
      ctx.lineTo(tx[n], ty[n]);
      ctx.lineTo(tx[e], ty[e]);
      ctx.closePath();
      ctx.fillStyle = b.wall;
      ctx.fill();
      ctx.fillStyle = `rgba(0,0,0,${shade[e]})`;
      ctx.fill();
      // окна
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = this.night > 0.4 ? 'rgba(255,225,140,0.7)' : 'rgba(200,230,255,0.28)';
      ctx.beginPath();
      for (let f = 1; f <= floors; f++) {
        const t = f / (floors + 1);
        ctx.moveTo(xs[e] + (tx[e] - xs[e]) * t, ys[e] + (ty[e] - ys[e]) * t);
        ctx.lineTo(xs[n] + (tx[n] - xs[n]) * t, ys[n] + (ty[n] - ys[n]) * t);
      }
      ctx.stroke();
      ctx.restore();
    }
    // крыша
    ctx.beginPath();
    ctx.moveTo(tx[0], ty[0]);
    for (let i = 1; i < 4; i++) ctx.lineTo(tx[i], ty[i]);
    ctx.closePath();
    ctx.fillStyle = b.roof;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
    const k2 = k * 1.03;
    for (const d of b.details) {
      const dx = d.x + (d.x - cam.x) * k2;
      const dy = d.y + (d.y - cam.y) * k2;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(dx + 2, dy + 3, d.w, d.h);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(dx, dy, d.w, d.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx, dy, d.w, d.h);
    }
  }

  private rr(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private drawCar(c: { x: number; y: number; a: number; l: number; w: number; color: string; kind: Kind }, brake: boolean, wreck = false) {
    const ctx = this.ctx;
    const { l, w } = c;
    // тень
    ctx.save();
    ctx.translate(c.x + 4, c.y + 6);
    ctx.rotate(c.a);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    this.rr(-l / 2, -w / 2, l, w, w * 0.3);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    // колёса
    ctx.fillStyle = '#111';
    for (const sx of [-l * 0.3, l * 0.3]) {
      ctx.fillRect(sx - 6, -w / 2 - 1.5, 12, 4);
      ctx.fillRect(sx - 6, w / 2 - 2.5, 12, 4);
    }
    // кузов
    ctx.fillStyle = c.color;
    this.rr(-l / 2, -w / 2, l, w, c.kind === 'bus' ? 6 : w * 0.28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (c.kind === 'bus') {
      ctx.fillStyle = '#1b2433';
      this.rr(l * 0.38, -w / 2 + 3, l * 0.09, w - 6, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      this.rr(-l / 2 + 5, -w / 2 + 5, l * 0.82, w - 10, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(30,45,70,0.55)';
      for (let i = 0; i < 7; i++) ctx.fillRect(-l / 2 + 9 + i * (l * 0.115), -w / 2 + 8, l * 0.07, w - 16);
    } else {
      // лобовое и заднее стёкла
      ctx.fillStyle = '#18202e';
      this.rr(l * 0.1, -w / 2 + 3, l * 0.2, w - 6, 5);
      ctx.fill();
      this.rr(-l * 0.37, -w / 2 + 4, l * 0.12, w - 8, 4);
      ctx.fill();
      // крыша
      ctx.fillStyle = c.color;
      this.rr(-l * 0.26, -w / 2 + 3.5, l * 0.36, w - 7, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // блик капота
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      this.rr(l * 0.32, -w / 2 + 5, l * 0.15, w - 10, 3);
      ctx.fill();
      if (c.kind === 'taxi') {
        ctx.fillStyle = '#fff6b0';
        ctx.fillRect(-4, -5, 8, 10);
        ctx.fillStyle = '#222';
        ctx.fillRect(-1, -5, 2, 10);
      }
    }
    // фары
    ctx.fillStyle = wreck ? '#8a8f99' : '#fff6c4';
    ctx.fillRect(l / 2 - 5, -w / 2 + 3, 4, 7);
    ctx.fillRect(l / 2 - 5, w / 2 - 10, 4, 7);
    // стоп-сигналы
    ctx.fillStyle = brake ? '#ff2b2b' : '#8e1a1a';
    ctx.fillRect(-l / 2 + 1, -w / 2 + 3, 3.5, 7);
    ctx.fillRect(-l / 2 + 1, w / 2 - 10, 3.5, 7);
    if (brake) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(-l / 2, 0, 2, -l / 2, 0, 26);
      g.addColorStop(0, 'rgba(255,40,40,0.5)');
      g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-l / 2 - 28, -w / 2 - 12, 40, w + 24);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (wreck) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      this.rr(-l / 2, -w / 2, l, w, w * 0.28);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderNight(x0: number, x1: number, y0: number, y1: number) {
    const { nctx: n, scale, dpr, w, h, cam } = this;
    const cw = this.nightCanvas.width;
    const ch = this.nightCanvas.height;
    n.setTransform(1, 0, 0, 1, 0, 0);
    n.globalCompositeOperation = 'source-over';
    n.clearRect(0, 0, cw, ch);
    n.fillStyle = `rgba(5,9,34,${0.8 * this.night})`;
    n.fillRect(0, 0, cw, ch);
    n.globalCompositeOperation = 'destination-out';
    n.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (w / 2 - cam.x * scale), dpr * (h / 2 - cam.y * scale));

    // фонари на перекрёстках и посреди улиц
    const glow = (x: number, y: number, r: number, a: number) => {
      const g = n.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      n.fillStyle = g;
      n.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const ox = i * C;
        const oy = j * C;
        glow(ox + R / 2, oy + R / 2, 250, 0.85);
        glow(ox + R / 2, oy + R + B / 2, 210, 0.6);
        glow(ox + R + B / 2, oy + R / 2, 210, 0.6);
      }
    }
    // фонтан/окна парковок не нужны; фары машин
    const lim = this.visR;
    const cars: Body[] = [this.player];
    for (const c of this.ai) if (!c.wreck && Math.abs(c.x - cam.x) < lim && Math.abs(c.y - cam.y) < lim) cars.push(c);
    for (const c of cars) {
      n.save();
      n.translate(c.x, c.y);
      n.rotate(c.a);
      const isP = c === this.player;
      const len = isP ? 420 : 250;
      const spread = isP ? 150 : 90;
      const g = n.createLinearGradient(c.l / 2 - 6, 0, c.l / 2 + len, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.98)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      n.fillStyle = g;
      n.beginPath();
      n.moveTo(c.l / 2 - 6, -12);
      n.lineTo(c.l / 2 + len, -spread);
      n.lineTo(c.l / 2 + len, spread);
      n.lineTo(c.l / 2 - 6, 12);
      n.closePath();
      n.fill();
      n.restore();
      glow(c.x, c.y, isP ? 90 : 60, 0.75);
    }
    n.globalCompositeOperation = 'source-over';

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.nightCanvas, 0, 0);

    // тёплое свечение фонарей поверх
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (w / 2 - cam.x * scale), dpr * (h / 2 - cam.y * scale));
    ctx.globalCompositeOperation = 'lighter';
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const cx = i * C + R / 2;
        const cy = j * C + R / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200);
        g.addColorStop(0, `rgba(255,190,100,${0.22 * this.night})`);
        g.addColorStop(1, 'rgba(255,190,100,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - 200, cy - 200, 400, 400);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- HUD ----------
  private drawHUD() {
    const { ctx, w, h, dpr } = this;
    const p = this.player;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // --- миникарта ---
    const mr = w < 600 ? 54 : 72;
    const mx = w - mr - 14;
    const my = mr + 14;
    const ms = mr / 1100;
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#2b313c';
    ctx.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    ctx.translate(mx, my);
    ctx.scale(ms, ms);
    ctx.translate(-p.x, -p.y);
    const range = 1150;
    const ka = Math.floor((p.x - range) / C);
    const kb = Math.floor((p.x + range) / C);
    const kc = Math.floor((p.y - range) / C);
    const kd = Math.floor((p.y + range) / C);
    const colors: Record<string, string> = { city: '#667086', park: '#4a8f55', parking: '#4b505c', plaza: '#b3ad9f' };
    for (let j = kc; j <= kd; j++) {
      for (let i = ka; i <= kb; i++) {
        const bl = getBlock(i, j);
        ctx.fillStyle = colors[bl.type];
        ctx.fillRect(bl.ox, bl.oy, B, B);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const c of this.ai) {
      if (c.wreck) continue;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 26, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.stroke();
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(p.a);
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // --- спидометр ---
    const sr = w < 600 ? 50 : 62;
    const gx = w / 2;
    const gy = h - sr - 18;
    const kmh = Math.abs(p.vf) * 0.225;
    const maxKmh = 240;
    ctx.fillStyle = 'rgba(10,14,24,0.65)';
    ctx.beginPath();
    ctx.arc(gx, gy, sr, 0, TAU);
    ctx.fill();
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(gx, gy, sr - 8, a0, a0 + sweep);
    ctx.stroke();
    const fr = clamp(kmh / maxKmh, 0, 1);
    const grad = ctx.createLinearGradient(gx - sr, gy, gx + sr, gy);
    grad.addColorStop(0, '#4cc9f0');
    grad.addColorStop(0.6, '#ffd23f');
    grad.addColorStop(1, '#ff4d4d');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.arc(gx, gy, sr - 8, a0, a0 + sweep * Math.max(0.005, fr));
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `700 ${sr * 0.55}px ${FONT}`;
    ctx.fillText(String(Math.round(kmh)), gx, gy + sr * 0.15);
    ctx.font = `600 ${sr * 0.2}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(p.reverse ? 'R · км/ч' : 'км/ч', gx, gy + sr * 0.45);

    // нитро
    const bw = Math.min(200, w * 0.4);
    const bx = gx - bw / 2;
    const by = gy - sr - 18;
    ctx.fillStyle = 'rgba(10,14,24,0.65)';
    this.rr(bx - 4, by - 4, bw + 8, 14, 7);
    ctx.fill();
    const ng = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    ng.addColorStop(0, '#3a86ff');
    ng.addColorStop(1, '#4cc9f0');
    ctx.fillStyle = ng;
    if (p.nitro > 1) {
      this.rr(bx, by, (bw * p.nitro) / 100, 6, 3);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `700 10px ${FONT}`;
    ctx.fillText('НИТРО · SHIFT', gx, by - 8);

    // статистика
    ctx.textAlign = 'left';
    const lx = 16;
    const ly = 72;
    ctx.fillStyle = 'rgba(10,14,24,0.55)';
    this.rr(lx - 4, ly - 20, 160, 50, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 13px ${FONT}`;
    ctx.fillText(`Пройдено: ${(p.odo / 16 / 1000).toFixed(2)} км`, lx + 6, ly - 2);
    ctx.fillText(`Аварии: ${this.crashes}`, lx + 6, ly + 17);
  }
}
