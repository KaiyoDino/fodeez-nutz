import '@fontsource/tiny5/400.css';
import './style.css';
import { Game, type DebugOptions } from './game/game';

function parseDebug(): DebugOptions {
  const q = new URLSearchParams(window.location.search);
  if (!q.has('debug')) return { enabled: false };
  const mode = q.get('mode');
  const map = q.get('map');
  const at = q.get('at')?.split(',').map(Number);
  return {
    enabled: true,
    map: map === 'tower' || map === 'crane' ? map : undefined,
    mode: mode === 'original' || mode === 'newage' ? mode : undefined,
    at: at && at.length === 2 && at.every(Number.isFinite) ? { x: at[0], y: at[1] } : undefined,
    menu: q.get('menu') ?? undefined,
    ticks: Number(q.get('ticks') ?? 0) || 0,
    freeze: q.has('freeze'),
    pointer: (() => {
      const p = q.get('pointer')?.split(',').map(Number);
      return p && p.length === 2 && p.every(Number.isFinite) ? { x: p[0], y: p[1] } : undefined;
    })(),
  };
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const debug = parseDebug();
const game = new Game(canvas, ui, debug);
if (debug.enabled) (window as unknown as { __game: unknown }).__game = game.debugApi();
game.start();
