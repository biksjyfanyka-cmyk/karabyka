import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from './game/engine';

const COLORS = [
  { name: 'Красный', value: '#e63946' },
  { name: 'Синий', value: '#2f6fed' },
  { name: 'Жёлтый', value: '#ffc300' },
  { name: 'Зелёный', value: '#1fa971' },
  { name: 'Оранжевый', value: '#ff7b00' },
  { name: 'Фиолетовый', value: '#8e44ec' },
  { name: 'Белый', value: '#f1f1f1' },
  { name: 'Чёрный', value: '#23262d' },
];

type TouchKey = 'left' | 'right' | 'up' | 'down' | 'brake' | 'nitro';

function CarPreview({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 220 110" className="h-28 w-56 drop-shadow-[0_12px_18px_rgba(0,0,0,0.55)]">
      <rect x="22" y="10" width="26" height="9" rx="3" fill="#0b0b0b" />
      <rect x="22" y="91" width="26" height="9" rx="3" fill="#0b0b0b" />
      <rect x="150" y="10" width="26" height="9" rx="3" fill="#0b0b0b" />
      <rect x="150" y="91" width="26" height="9" rx="3" fill="#0b0b0b" />
      <rect x="8" y="14" width="204" height="82" rx="26" fill={color} stroke="rgba(0,0,0,0.4)" strokeWidth="3" />
      <rect x="112" y="22" width="48" height="66" rx="12" fill="#18202e" />
      <rect x="32" y="26" width="26" height="58" rx="9" fill="#18202e" />
      <rect x="62" y="22" width="52" height="66" rx="10" fill={color} stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
      <rect x="62" y="22" width="52" height="66" rx="10" fill="rgba(255,255,255,0.16)" />
      <rect x="196" y="20" width="9" height="16" rx="2" fill="#fff6c4" />
      <rect x="196" y="74" width="9" height="16" rx="2" fill="#fff6c4" />
      <rect x="10" y="20" width="7" height="16" rx="2" fill="#c1121f" />
      <rect x="10" y="74" width="7" height="16" rx="2" fill="#c1121f" />
    </svg>
  );
}

function TouchButton({
  game,
  k,
  className,
  children,
}: {
  game: React.MutableRefObject<Game | null>;
  k: TouchKey;
  className?: string;
  children: React.ReactNode;
}) {
  const [on, setOn] = useState(false);
  const set = (v: boolean) => (e: React.PointerEvent) => {
    e.preventDefault();
    if (game.current) game.current.touch[k] = v;
    setOn(v);
  };
  return (
    <button
      onPointerDown={set(true)}
      onPointerUp={set(false)}
      onPointerCancel={set(false)}
      onPointerLeave={set(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex select-none items-center justify-center rounded-2xl border border-white/25 text-xl font-bold text-white backdrop-blur-sm transition-colors ${
        on ? 'bg-white/45' : 'bg-white/15'
      } ${className ?? ''}`}
      style={{ touchAction: 'none' }}
    >
      {children}
    </button>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.6rem] items-center justify-center rounded-md border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
      {children}
    </kbd>
  );
}

function Game_({ color, onExit }: { color: string; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [night, setNight] = useState(false);
  const [muted, setMuted] = useState(false);
  const [help, setHelp] = useState(true);
  const isTouch = typeof window !== 'undefined' && (('ontouchstart' in window) || window.matchMedia('(pointer: coarse)').matches);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const g = new Game(canvas, { color, onExit });
    g.onNightChange = setNight;
    g.onMuteChange = setMuted;
    gameRef.current = g;
    g.start();
    return () => {
      g.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setHelp(false), 14000);
    return () => clearTimeout(t);
  }, []);

  const btn =
    'flex h-10 items-center gap-2 rounded-xl border border-white/20 bg-black/45 px-3 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-black/65 active:scale-95';

  return (
    <div className="fixed inset-0 overflow-hidden bg-neutral-900">
      <canvas ref={canvasRef} className="block h-full w-full" />

      <div className="absolute left-4 top-4 flex gap-2">
        <button className={btn} onClick={onExit} title="Esc">
          ☰ Меню
        </button>
        <button className={btn} onClick={() => gameRef.current?.toggleNight()} title="N">
          {night ? '🌙' : '☀️'}
          <span className="hidden sm:inline">{night ? 'Ночь' : 'День'}</span>
        </button>
        <button className={btn} onClick={() => gameRef.current?.toggleMute()} title="M">
          {muted ? '🔇' : '🔊'}
        </button>
        {!isTouch && (
          <button className={btn} onClick={() => setHelp((v) => !v)}>
            ?
          </button>
        )}
      </div>

      {help && !isTouch && (
        <div className="absolute bottom-4 left-4 w-64 space-y-2 rounded-2xl border border-white/15 bg-black/55 p-4 text-xs text-white/85 backdrop-blur-md">
          <div className="text-sm font-bold text-white">Управление</div>
          <div className="flex items-center justify-between">
            <span>Газ / тормоз</span>
            <span className="flex gap-1">
              <Key>W</Key>
              <Key>S</Key>
              <span className="text-white/40">или</span>
              <Key>↑</Key>
              <Key>↓</Key>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Руль</span>
            <span className="flex gap-1">
              <Key>A</Key>
              <Key>D</Key>
              <span className="text-white/40">или</span>
              <Key>←</Key>
              <Key>→</Key>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Ручник (дрифт)</span>
            <Key>Пробел</Key>
          </div>
          <div className="flex items-center justify-between">
            <span>Нитро</span>
            <Key>Shift</Key>
          </div>
          <div className="flex items-center justify-between">
            <span>Сигнал</span>
            <Key>H</Key>
          </div>
          <div className="flex items-center justify-between">
            <span>День / ночь</span>
            <Key>N</Key>
          </div>
          <div className="flex items-center justify-between">
            <span>Вернуться на дорогу</span>
            <Key>R</Key>
          </div>
        </div>
      )}

      {isTouch && (
        <>
          <div className="absolute bottom-6 left-5 flex gap-3">
            <TouchButton game={gameRef} k="left" className="h-20 w-20">
              ◀
            </TouchButton>
            <TouchButton game={gameRef} k="right" className="h-20 w-20">
              ▶
            </TouchButton>
          </div>
          <div className="absolute bottom-6 right-5 flex items-end gap-3">
            <div className="flex flex-col gap-3">
              <TouchButton game={gameRef} k="nitro" className="h-14 w-20 text-sm">
                НИТРО
              </TouchButton>
              <TouchButton game={gameRef} k="brake" className="h-14 w-20 text-sm">
                ДРИФТ
              </TouchButton>
            </div>
            <div className="flex flex-col gap-3">
              <TouchButton game={gameRef} k="up" className="h-24 w-20">
                ГАЗ
              </TouchButton>
              <TouchButton game={gameRef} k="down" className="h-14 w-20 text-sm">
                ТОРМОЗ
              </TouchButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [playing, setPlaying] = useState(false);
  const [color, setColor] = useState(COLORS[0].value);
  const exit = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!playing && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        setPlaying(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  if (playing) return <Game_ color={color} onExit={exit} />;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-6 text-white">
      {/* фон — сетка городских улиц */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.05) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,0.05) 2px, transparent 2px)',
          backgroundSize: '90px 90px',
        }}
      />
      <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-fuchsia-600/25 blur-3xl" />
      <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-cyan-500/25 blur-3xl" />

      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.06] p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-300">Открытый город</div>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">
          Город<span className="text-amber-400">Драйв</span>
        </h1>
        <p className="mt-2 text-sm text-white/60">Катайся где хочешь, дрифтуй, таранишь трафик и исследуй бесконечный город.</p>

        <div className="mt-6 flex justify-center">
          <CarPreview color={color} />
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2.5">
          {COLORS.map((c) => (
            <button
              key={c.value}
              title={c.name}
              onClick={() => setColor(c.value)}
              className={`h-9 w-9 rounded-full border-2 transition hover:scale-110 ${color === c.value ? 'scale-110 border-white' : 'border-white/20'}`}
              style={{ background: c.value }}
            />
          ))}
        </div>

        <button
          onClick={() => setPlaying(true)}
          className="mt-7 w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-4 text-lg font-extrabold text-slate-900 shadow-lg shadow-orange-500/30 transition hover:brightness-110 active:scale-[0.98]"
        >
          ПОЕХАЛИ! <span className="ml-1 text-sm font-semibold opacity-70">(Enter)</span>
        </button>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1.5 text-left text-xs text-white/60">
          <div>
            <b className="text-white/90">WASD / стрелки</b> — ехать
          </div>
          <div>
            <b className="text-white/90">Пробел</b> — ручник, дрифт
          </div>
          <div>
            <b className="text-white/90">Shift</b> — нитро
          </div>
          <div>
            <b className="text-white/90">N</b> — день / ночь
          </div>
        </div>
      </div>
    </div>
  );
}
