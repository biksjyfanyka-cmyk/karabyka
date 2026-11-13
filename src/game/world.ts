// Процедурный бесконечный город: сетка дорог + кварталы, генерируются по хешу координат.

export const C = 560; // размер ячейки (дорога + квартал)
export const R = 160; // ширина дороги
export const B = C - R; // размер квартала
export const SW = 14; // тротуар
export const I = B - SW * 2; // внутренняя часть квартала

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Building extends Rect {
  height: number;
  wall: string;
  roof: string;
  details: Rect[];
}

export interface Tree {
  x: number;
  y: number;
  r: number;
  color: string;
}

export interface ParkedCar {
  x: number;
  y: number;
  a: number;
  color: string;
}

export type BlockType = 'city' | 'park' | 'parking' | 'plaza';

export interface Block {
  kx: number;
  ky: number;
  ox: number; // начало квартала (с тротуаром)
  oy: number;
  ix: number; // начало внутренней части
  iy: number;
  type: BlockType;
  buildings: Building[];
  trees: Tree[];
  parked: ParkedCar[];
  colliders: Rect[];
  stalls: Rect[];
}

export function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

function hash2(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return (h ^ (h >>> 15)) >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HUES = [20, 210, 8, 140, 38, 222, 30, 195];
const CAR_COLORS = ['#d62839', '#3a86ff', '#f4f1de', '#2b2d42', '#8d99ae', '#06a77d', '#ff8c42', '#9b5de5', '#c0c5ce'];

const cache = new Map<string, Block>();

export function getBlock(kx: number, ky: number): Block {
  const key = kx + ',' + ky;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 700) cache.clear();

  const rng = mulberry32(hash2(kx, ky));
  const ox = kx * C + R;
  const oy = ky * C + R;
  const ix = ox + SW;
  const iy = oy + SW;
  const dist = Math.hypot(kx, ky);

  const r = rng();
  let type: BlockType;
  if (kx === 0 && ky === 0) type = 'plaza';
  else if (r < 0.62) type = 'city';
  else if (r < 0.8) type = 'park';
  else if (r < 0.92) type = 'parking';
  else type = 'plaza';

  const block: Block = {
    kx,
    ky,
    ox,
    oy,
    ix,
    iy,
    type,
    buildings: [],
    trees: [],
    parked: [],
    colliders: [],
    stalls: [],
  };

  const addTree = (x: number, y: number, rad: number) => {
    block.trees.push({ x, y, r: rad, color: `hsl(${105 + rng() * 40}, ${40 + rng() * 15}%, ${28 + rng() * 10}%)` });
    block.colliders.push({ x: x - 7, y: y - 7, w: 14, h: 14 });
  };

  if (type === 'city') {
    const gap = 12;
    const mode = rng();
    let rects: Rect[];
    if (mode < 0.25) {
      rects = [{ x: ix, y: iy, w: I, h: I }];
    } else if (mode < 0.45) {
      const w = (I - gap) / 2;
      rects = [
        { x: ix, y: iy, w, h: I },
        { x: ix + w + gap, y: iy, w, h: I },
      ];
    } else if (mode < 0.6) {
      const h = (I - gap) / 2;
      rects = [
        { x: ix, y: iy, w: I, h },
        { x: ix, y: iy + h + gap, w: I, h },
      ];
    } else {
      const w = (I - gap) / 2;
      rects = [
        { x: ix, y: iy, w, h: w },
        { x: ix + w + gap, y: iy, w, h: w },
        { x: ix, y: iy + w + gap, w, h: w },
        { x: ix + w + gap, y: iy + w + gap, w, h: w },
      ];
    }
    for (const rc of rects) {
      if (rects.length === 4 && rng() < 0.1) continue;
      const hue = HUES[Math.floor(rng() * HUES.length)];
      const sat = 12 + rng() * 22;
      const light = 44 + rng() * 20;
      const downtown = 1 + 1.6 / (1 + dist * 0.7);
      const height = Math.min(280, Math.max(40, (45 + rng() * 75) * downtown));
      const details: Rect[] = [];
      const nd = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < nd; i++) {
        const dw = 14 + rng() * 26;
        const dh = 14 + rng() * 22;
        details.push({
          x: rc.x + 14 + rng() * Math.max(1, rc.w - dw - 28),
          y: rc.y + 14 + rng() * Math.max(1, rc.h - dh - 28),
          w: dw,
          h: dh,
        });
      }
      const b: Building = {
        ...rc,
        height,
        wall: `hsl(${hue}, ${sat}%, ${light}%)`,
        roof: `hsl(${hue}, ${sat * 0.7}%, ${light + 12}%)`,
        details,
      };
      block.buildings.push(b);
      block.colliders.push({ x: rc.x, y: rc.y, w: rc.w, h: rc.h });
    }
  } else if (type === 'park') {
    const n = 11 + Math.floor(rng() * 6);
    const pts: { x: number; y: number }[] = [];
    let guard = 0;
    while (pts.length < n && guard++ < 200) {
      const x = ix + 30 + rng() * (I - 60);
      const y = iy + 30 + rng() * (I - 60);
      // оставим дорожки крестом
      if (Math.abs(x - (ix + I / 2)) < 42 || Math.abs(y - (iy + I / 2)) < 42) continue;
      if (pts.some((p) => Math.hypot(p.x - x, p.y - y) < 62)) continue;
      pts.push({ x, y });
      addTree(x, y, 20 + rng() * 10);
    }
  } else if (type === 'parking') {
    const rows = [8, 124, 184, 300];
    const stallW = I / 9;
    for (const ry of rows) {
      for (let s = 0; s < 9; s++) {
        const sx = ix + s * stallW;
        block.stalls.push({ x: sx, y: iy + ry, w: stallW, h: 60 });
        if (rng() < 0.4) {
          const cx = sx + stallW / 2;
          const cy = iy + ry + 30;
          block.parked.push({
            x: cx,
            y: cy,
            a: rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2,
            color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
          });
          block.colliders.push({ x: cx - 14, y: cy - 26, w: 28, h: 52 });
        }
      }
    }
  } else {
    // площадь с фонтаном
    const cx = ix + I / 2;
    const cy = iy + I / 2;
    block.colliders.push({ x: cx - 40, y: cy - 40, w: 80, h: 80 });
    addTree(ix + 45, iy + 45, 26);
    addTree(ix + I - 45, iy + 45, 26);
    addTree(ix + 45, iy + I - 45, 26);
    addTree(ix + I - 45, iy + I - 45, 26);
  }

  cache.set(key, block);
  return block;
}

export function collidersNear(x: number, y: number): Rect[] {
  const kx = Math.floor(x / C);
  const ky = Math.floor(y / C);
  const out: Rect[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bl = getBlock(kx + dx, ky + dy);
      for (const c of bl.colliders) out.push(c);
    }
  }
  return out;
}
