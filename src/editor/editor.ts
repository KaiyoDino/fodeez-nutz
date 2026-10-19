// The level editor, as a component that can be mounted anywhere.
//
// Two sources:
//  - 'dev': the built-in maps (editor.html on the dev server). Save rewrites the map's file
//    through the dev server; Test opens the game in a new tab.
//  - 'draft': a player's own map, inside the game (the map maker). Every change is saved to
//    the draft by itself; Play and Test hand the map to the game.
//
// Click a piece to select it, drag to move, drag its handles to resize, drag empty space to
// pan, scroll (or the zoom buttons) to zoom.

import './editor.css';
import { buildDecorLayer, drawGoalRoom, drawHookBlock, drawSpring, girderCanvas, goopCanvas, SCALE, targetSprite } from '../render/level-art';
import { checkDoc, cleanName, docToMap, LIMITS, outerWalls, type MapDoc } from '../sim/custom-map';
import { DUDE, MAP_IDS, MAPS, type MapDef, type MapId, type PlatformDef, type PlatformKind } from '../sim/level';
import { NA } from '../sim/newage';
import { HOOK_RANGE } from '../sim/original';
import { matches, type KeyBind } from '../game/keybind';
import type { Mode } from '../sim/types';
import type { Spots } from './codegen';

export interface DevSource {
  kind: 'dev';
}

export interface DraftSource {
  kind: 'draft';
  id: string;
  doc: MapDoc;
  /** Called shortly after every change. */
  save(doc: MapDoc): void;
  /** Play the map from the start (a real run), or from a point (a practice run that doesn't count). */
  play(doc: MapDoc, at: { x: number; y: number } | null): void;
  close(): void;
  /** A line about the draft: whether it's been beaten, uploaded... */
  status(doc: MapDoc): string;
  /** The player's restart key (Settings), which plays the map from the start here. */
  restartKey(): KeyBind | null;
}

export type EditorSource = DevSource | DraftSource;

export interface EditorHandle {
  destroy(): void;
}

type SpotKey = 'start' | 'goopReset' | `tp${number}`;
type Sel = { kind: 'plat'; i: number } | { kind: 'spot'; key: SpotKey } | null;
/** What undo and redo restore. Drafts also keep their name, sky and size here. */
interface Doc {
  platforms: PlatformDef[];
  spots: Spots;
  meta?: { name: string; theme: MapDoc['theme']; world: { w: number; h: number } };
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}
interface Session {
  map: MapId;
  cam: Camera;
  sel: Sel;
  mode: Mode;
  history?: Record<string, { undo: string[]; redo: string[] }>;
}

const SESSION = 'fodeez-nutz/editor';
const GRID = 10;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

export function createEditor(host: HTMLElement, source: EditorSource): EditorHandle {
  const draft = source.kind === 'draft' ? source : null;

  // ---------------------------------------------------------------- state

  const saved: Session | null = (() => {
    if (draft) return null;
    try {
      return JSON.parse(sessionStorage.getItem(SESSION) ?? 'null') as Session | null;
    } catch {
      return null;
    }
  })();

  const q = new URLSearchParams(location.search);
  const devStart = q.get('map');
  let mapId: MapId = draft ? draft.id : devStart && MAP_IDS.includes(devStart as never) ? devStart : (saved?.map ?? 'tower');
  let mode: Mode = draft ? draft.doc.mode : (saved?.mode ?? MAPS[mapId].designedFor);
  let doc: Doc = draft ? fromDraft(draft.doc) : fresh(MAPS[mapId]);
  let map: MapDef = currentMap();
  let sel: Sel = saved?.map === mapId ? saved.sel : null;
  let cam: Camera = saved?.map === mapId && saved.cam ? saved.cam : { x: 0, y: 0, zoom: 0.3 };
  let fitOnLoad = !(saved?.map === mapId && saved.cam);
  let snap = true;
  let showReach = true;
  let dirty = false;
  let undo: string[] = saved?.history?.[mapId]?.undo ?? [];
  let redo: string[] = saved?.history?.[mapId]?.redo ?? [];
  let autosave = 0;

  function fresh(m: MapDef): Doc {
    return {
      platforms: m.platforms.map(p => structuredClone(p)),
      spots: { start: { ...m.start }, goopReset: { ...m.goopReset }, teleports: m.teleports.map(t => ({ ...t })) },
    };
  }

  function fromDraft(d: MapDoc): Doc {
    return {
      platforms: d.platforms.map(p => structuredClone(p)),
      spots: { start: { ...d.start }, goopReset: { ...d.goopReset }, teleports: [] },
      meta: { name: d.name, theme: d.theme, world: { ...d.world } },
    };
  }

  /** The draft as a map doc (only for drafts). */
  function draftDoc(): MapDoc {
    const m = doc.meta!;
    return { name: m.name, mode, theme: m.theme, world: { ...m.world }, start: { ...doc.spots.start }, goopReset: { ...doc.spots.goopReset }, platforms: doc.platforms };
  }

  function currentMap(): MapDef {
    return draft ? docToMap(draft.id, draftDoc()) : MAPS[mapId];
  }

  // ---------------------------------------------------------------- elements

  const root = el('div', { className: 'ed' });
  const stage = el('main', { className: 'ed-stage' });
  const canvas = el('canvas', { className: 'ed-view' });
  canvas.setAttribute('aria-label', 'The map. Click a piece to select it, drag to move it, drag empty space to pan, scroll to zoom.');
  const hud = el('div', { className: 'ed-hud' });
  hud.setAttribute('aria-live', 'polite');
  const panel = el('aside', { className: 'ed-panel' });
  stage.append(canvas, hud);
  root.append(stage, panel);
  host.append(root);
  const ctx = canvas.getContext('2d')!;

  let statusTimer = 0;
  function status(text: string, bad = false): void {
    hud.textContent = text;
    hud.classList.toggle('bad', bad);
    hud.classList.add('show');
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => hud.classList.remove('show'), bad ? 6000 : 2200);
  }

  // ---------------------------------------------------------------- history

  const snapshot = (): string => JSON.stringify(doc);

  /** Call before a change. */
  function remember(): void {
    undo.push(snapshot());
    if (undo.length > 200) undo.shift();
    redo = [];
  }

  /** Something changed: mark it, and (for drafts) save it in a moment. */
  function touch(): void {
    dirty = true;
    if (draft) {
      map = currentMap();
      window.clearTimeout(autosave);
      autosave = window.setTimeout(saveDraft, 400);
    }
    updateTitle();
  }

  function changed(): void {
    touch();
    syncPanel();
    draw();
  }

  function restore(s: string): void {
    doc = JSON.parse(s) as Doc;
    if (sel?.kind === 'plat' && sel.i >= doc.platforms.length) sel = null;
    map = currentMap();
    buildPanel();
    changed();
  }

  function undoOnce(): void {
    const s = undo.pop();
    if (!s) return status('Nothing to undo');
    redo.push(snapshot());
    restore(s);
  }

  function redoOnce(): void {
    const s = redo.pop();
    if (!s) return status('Nothing to redo');
    undo.push(snapshot());
    restore(s);
  }

  function persistSession(): void {
    if (draft) return;
    try {
      const history = { ...(saved?.history ?? {}), [mapId]: { undo: undo.slice(-50), redo: redo.slice(-50) } };
      sessionStorage.setItem(SESSION, JSON.stringify({ map: mapId, cam, sel, mode, history }));
    } catch {
      // storage full or blocked: the editor still works, it just won't remember the view
    }
  }

  // ---------------------------------------------------------------- geometry

  const isWall = (i: number) => i < 4;
  const visibleIn = (p: PlatformDef) => !p.onlyIn || p.onlyIn === mode;

  function spotPos(key: SpotKey): { x: number; y: number } {
    if (key === 'start') return doc.spots.start;
    if (key === 'goopReset') return doc.spots.goopReset;
    return doc.spots.teleports[Number(key.slice(2))];
  }

  function spotKeys(): SpotKey[] {
    return ['start', 'goopReset', ...doc.spots.teleports.map((_, i) => `tp${i}` as SpotKey)];
  }

  function spotLabel(key: SpotKey): string {
    return key === 'start' ? 'START' : key === 'goopReset' ? 'GOOP RESET' : `TELEPORT ${Number(key.slice(2)) + 1}`;
  }

  const view = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  const toScreen = (x: number, y: number) => ({ x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom });
  const toWorld = (x: number, y: number) => ({ x: x / cam.zoom + cam.x, y: y / cam.zoom + cam.y });
  const snapTo = (v: number, free: boolean) => (free || !snap ? Math.round(v) : Math.round(v / GRID) * GRID);

  function fit(): void {
    const v = view();
    cam.zoom = Math.min(v.w / (map.world.w + 200), v.h / (map.world.h + 200));
    cam.x = map.world.w / 2 - v.w / 2 / cam.zoom;
    cam.y = map.world.h / 2 - v.h / 2 / cam.zoom;
  }

  function zoomBy(k: number, sx = view().w / 2, sy = view().h / 2): void {
    const before = toWorld(sx, sy);
    cam.zoom = Math.min(4, Math.max(0.03, cam.zoom * k));
    cam.x = before.x - sx / cam.zoom;
    cam.y = before.y - sy / cam.zoom;
    persistSession();
    draw();
  }

  type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function handlePos(p: PlatformDef, h: Handle): { x: number; y: number } {
    const x = h.includes('w') ? p.x : h.includes('e') ? p.x + p.w : p.x + p.w / 2;
    const y = h.includes('n') ? p.y : h.includes('s') ? p.y + p.h : p.y + p.h / 2;
    return toScreen(x, y);
  }

  function hitHandle(sx: number, sy: number, touch = false): Handle | null {
    if (sel?.kind !== 'plat') return null;
    const p = doc.platforms[sel.i];
    if (!p || p.kind === 'target') return null;
    const r = touch ? 14 : 7;
    for (const h of HANDLES) {
      const c = handlePos(p, h);
      if (Math.abs(c.x - sx) <= r && Math.abs(c.y - sy) <= r) return h;
    }
    return null;
  }

  function hitTest(wx: number, wy: number): Sel {
    for (const key of spotKeys()) {
      const s = spotPos(key);
      if (wx >= s.x && wx <= s.x + DUDE.w && wy >= s.y && wy <= s.y + DUDE.h) return { kind: 'spot', key };
    }
    // topmost first; the big outer walls last so pieces near them are easy to grab
    const order = doc.platforms.map((_, i) => i).reverse();
    order.sort((a, b) => Number(isWall(a)) - Number(isWall(b)));
    for (const i of order) {
      const p = doc.platforms[i];
      const pad = p.kind === 'target' ? 6 : 0;
      if (wx >= p.x - pad && wx <= p.x + p.w + pad && wy >= p.y - pad && wy <= p.y + p.h + pad) return { kind: 'plat', i };
    }
    return null;
  }

  // ---------------------------------------------------------------- drawing

  const decorCache = new Map<MapId, HTMLCanvasElement>();
  const artCache = new Map<string, HTMLCanvasElement>();

  /** Pre-drawn art for a piece, in game pixels, plus how far it hangs outside the piece's box. */
  function artFor(p: PlatformDef): { c: HTMLCanvasElement; pad: number } {
    const key = `${mapId}|${p.kind}|${p.w}|${p.h}`;
    let c = artCache.get(key);
    const pad = p.kind === 'girder' ? 0 : p.kind === 'target' ? 1 : p.kind === 'goop' ? 1 : 4;
    if (!c) {
      const w = Math.max(1, Math.round(p.w / SCALE));
      const h = Math.max(1, Math.round(p.h / SCALE));
      if (p.kind === 'girder') c = girderCanvas({ ...p, x: 0, y: 0 });
      else if (p.kind === 'goop') c = goopCanvas({ ...p, x: 0, y: 0 });
      else if (p.kind === 'target') c = targetSprite('normal');
      else {
        c = document.createElement('canvas');
        c.width = w + pad * 2;
        c.height = h + pad * 2;
        const cc = c.getContext('2d')!;
        const box = { x: pad, y: pad, w, h };
        if (p.kind === 'spring') drawSpring(cc, box, 0, 'top');
        else (mapId === 'crane' ? drawHookBlock : drawGoalRoom)(cc, box);
      }
      artCache.set(key, c);
    }
    return { c, pad };
  }

  let raf = 0;
  function draw(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  let hover: Sel = null;
  let mouseWorld = { x: 0, y: 0 };

  function render(): void {
    const v = view();
    if (!v.w || !v.h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(v.w * dpr) || canvas.height !== Math.round(v.h * dpr)) {
      canvas.width = Math.round(v.w * dpr);
      canvas.height = Math.round(v.h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0a1c';
    ctx.fillRect(0, 0, v.w, v.h);

    // the map's sky area and decorations
    const o = toScreen(0, 0);
    const z = cam.zoom;
    ctx.fillStyle = map.theme === 'dawn' ? '#1d1a3d' : '#2a1d45';
    ctx.fillRect(o.x, o.y, map.world.w * z, map.world.h * z);
    if (!draft) {
      let decor = decorCache.get(mapId);
      if (!decor) decorCache.set(mapId, (decor = buildDecorLayer(map)));
      ctx.globalAlpha = 0.8;
      ctx.drawImage(decor, o.x, o.y, map.world.w * z, map.world.h * z);
      ctx.globalAlpha = 1;
    }

    // grid: faint lines every 100 px, labels every 500
    if (z > 0.12) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= map.world.w; x += 100) {
        const s = toScreen(x, 0);
        ctx.moveTo(Math.round(s.x) + 0.5, o.y);
        ctx.lineTo(Math.round(s.x) + 0.5, o.y + map.world.h * z);
      }
      for (let y = 0; y <= map.world.h; y += 100) {
        const s = toScreen(0, y);
        ctx.moveTo(o.x, Math.round(s.y) + 0.5);
        ctx.lineTo(o.x + map.world.w * z, Math.round(s.y) + 0.5);
      }
      ctx.stroke();
    }
    ctx.font = '13px Tiny5, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (let y = 0; y <= map.world.h; y += 500) {
      const s = toScreen(0, y);
      ctx.fillText(String(y), Math.max(4, o.x - 40), s.y + 4);
    }

    // pieces
    doc.platforms.forEach((p, i) => {
      const s = toScreen(p.x, p.y);
      const { c, pad } = artFor(p);
      ctx.globalAlpha = visibleIn(p) ? 1 : 0.25;
      ctx.drawImage(c, s.x - pad * SCALE * z, s.y - pad * SCALE * z, c.width * SCALE * z, c.height * SCALE * z);
      ctx.globalAlpha = 1;
      if (p.mover) {
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(255,194,58,0.8)';
        ctx.strokeRect(s.x + 0.5, s.y + 0.5, (p.w + p.mover.range) * z, p.h * z);
        ctx.setLineDash([]);
      }
      const tags = [p.role, p.onlyIn === 'newage' ? 'new age only' : p.onlyIn === 'original' ? 'original only' : '', p.mover ? `moves ${p.mover.range}` : ''].filter(Boolean);
      if (tags.length && z > 0.15) {
        ctx.fillStyle = '#ffe28a';
        ctx.fillText(tags.join(' · '), s.x, s.y - 4);
      }
      if (z > 0.3 && !isWall(i)) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(String(i), s.x + p.w * z + 3, s.y + 11);
      }
    });

    // hook reach around targets
    const range = mode === 'newage' ? NA.hookRange : HOOK_RANGE;
    doc.platforms.forEach((p, i) => {
      if (p.kind !== 'target' || !visibleIn(p)) return;
      const on = sel?.kind === 'plat' && sel.i === i;
      if (!showReach && !on) return;
      const c = toScreen(p.x + p.w / 2, p.y + p.h / 2);
      ctx.strokeStyle = on ? 'rgba(159,243,255,0.75)' : 'rgba(159,243,255,0.13)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, range * z, 0, Math.PI * 2);
      ctx.stroke();
    });

    // start, goop reset and teleports
    for (const key of spotKeys()) {
      if (key === 'goopReset' && draft && mode !== 'original') continue;
      const s = spotPos(key);
      const sc = toScreen(s.x, s.y);
      const color = key === 'start' ? '#5ee07a' : key === 'goopReset' ? '#c79bff' : '#ffc23a';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(sc.x, sc.y, DUDE.w * z, DUDE.h * z);
      ctx.lineWidth = 1;
      ctx.fillStyle = color;
      ctx.fillText(spotLabel(key), sc.x, sc.y - 4);
    }

    // hover and selection
    const outline = (s: Sel, color: string, width: number) => {
      if (!s) return;
      const b = s.kind === 'plat' ? doc.platforms[s.i] : { ...spotPos(s.key), w: DUDE.w, h: DUDE.h };
      if (!b) return;
      const sc = toScreen(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(sc.x - 1, sc.y - 1, b.w * z + 2, b.h * z + 2);
      ctx.lineWidth = 1;
    };
    if (hover && JSON.stringify(hover) !== JSON.stringify(sel)) outline(hover, 'rgba(255,255,255,0.6)', 1);
    outline(sel, '#ffc23a', 2);
    if (sel?.kind === 'plat' && doc.platforms[sel.i] && doc.platforms[sel.i].kind !== 'target') {
      for (const h of HANDLES) {
        const c = handlePos(doc.platforms[sel.i], h);
        ctx.fillStyle = '#1a1c2c';
        ctx.fillRect(c.x - 5, c.y - 5, 10, 10);
        ctx.fillStyle = '#ffc23a';
        ctx.fillRect(c.x - 4, c.y - 4, 8, 8);
      }
    }

    // the dude's size next to the mouse, for judging gaps
    const m = toScreen(mouseWorld.x, mouseWorld.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(m.x + 14, m.y + 14, DUDE.w * z, DUDE.h * z);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`${Math.round(mouseWorld.x)}, ${Math.round(mouseWorld.y)}`, m.x + 14, m.y + 14 + DUDE.h * z + 14);
  }

  // ---------------------------------------------------------------- editing

  function selected(): PlatformDef | null {
    return sel?.kind === 'plat' ? (doc.platforms[sel.i] ?? null) : null;
  }

  const DEFAULTS: Record<'girder' | 'target' | 'goop' | 'spring' | 'bumper' | 'goal', () => PlatformDef> = {
    girder: () => ({ kind: 'girder', x: 0, y: 0, w: 300, h: 40, area: 1 }),
    target: () => ({ kind: 'target', x: 0, y: 0, w: 25, h: 25, area: 1 }),
    goop: () => ({ kind: 'goop', x: 0, y: 0, w: 50, h: 200, area: 1 }),
    spring: () => ({ kind: 'spring', x: 0, y: 0, w: 200, h: 40, area: 1 }),
    bumper: () => ({ kind: 'girder', x: 0, y: 0, w: 20, h: 30, area: 1, note: 'bumper' }),
    goal: () => ({ kind: 'goal', x: 0, y: 0, w: 120, h: 90, area: 1 }),
  };

  /** The area a new piece belongs to: the selected piece's, or that of the nearest piece. */
  function areaNear(at: { x: number; y: number }): number {
    if (sel?.kind === 'plat' && !isWall(sel.i)) return doc.platforms[sel.i].area;
    let best = 1;
    let bestD = Infinity;
    doc.platforms.forEach((q, i) => {
      if (isWall(i)) return;
      const d = Math.hypot(q.x + q.w / 2 - at.x, q.y + q.h / 2 - at.y);
      if (d < bestD) {
        bestD = d;
        best = q.area;
      }
    });
    return best;
  }

  /** Add a piece centred on a world point. It goes after the last piece of the same area, so the file stays grouped. */
  function add(what: keyof typeof DEFAULTS, at: { x: number; y: number }): void {
    if (draft && doc.platforms.length >= LIMITS.pieces) return status(`A map can have at most ${LIMITS.pieces} pieces`, true);
    remember();
    const p = DEFAULTS[what]();
    p.area = areaNear(at);
    p.x = snapTo(at.x - p.w / 2, false);
    p.y = snapTo(at.y - p.h / 2, false);
    let index = doc.platforms.length;
    for (let i = doc.platforms.length - 1; i >= 0; i--)
      if (doc.platforms[i].area === p.area && !doc.platforms[i].onlyIn) {
        index = i + 1;
        break;
      }
    doc.platforms.splice(index, 0, p);
    sel = { kind: 'plat', i: index };
    buildPanel();
    changed();
  }

  function removeSelected(): void {
    if (sel?.kind === 'spot') {
      if (!sel.key.startsWith('tp')) return status('The start and goop reset can only be moved, not deleted');
      remember();
      doc.spots.teleports.splice(Number(sel.key.slice(2)), 1);
      sel = null;
      buildPanel();
      return changed();
    }
    if (sel?.kind !== 'plat') return;
    if (isWall(sel.i)) return status(draft ? 'The four outer walls stay (change the map size instead)' : 'The four outer walls stay (resize them instead)', true);
    if (doc.platforms[sel.i].kind === 'goal' && doc.platforms.filter(p => p.kind === 'goal').length === 1) return status('The map needs its goal', true);
    remember();
    doc.platforms.splice(sel.i, 1);
    sel = null;
    buildPanel();
    changed();
  }

  function duplicateSelected(): void {
    const p = selected();
    if (!p || sel?.kind !== 'plat') return;
    if (isWall(sel.i)) return status('The outer walls can’t be copied', true);
    if (draft && doc.platforms.length >= LIMITS.pieces) return status(`A map can have at most ${LIMITS.pieces} pieces`, true);
    remember();
    const copy = structuredClone(p);
    copy.x += 40;
    copy.y -= 40;
    doc.platforms.splice(sel.i + 1, 0, copy);
    sel = { kind: 'plat', i: sel.i + 1 };
    buildPanel();
    changed();
  }

  function nudge(dx: number, dy: number): void {
    if (!sel) return;
    remember();
    const b = sel.kind === 'plat' ? doc.platforms[sel.i] : spotPos(sel.key);
    b.x += dx;
    b.y += dy;
    changed();
  }

  function move(dir: -1 | 1): void {
    if (sel?.kind !== 'plat') return;
    const j = sel.i + dir;
    if (j < 4 || j >= doc.platforms.length || isWall(sel.i)) return;
    remember();
    const [p] = doc.platforms.splice(sel.i, 1);
    doc.platforms.splice(j, 0, p);
    sel = { kind: 'plat', i: j };
    buildPanel();
    changed();
  }

  /** Drafts: change the map's size; the outer walls follow. */
  function resizeWorld(w: number, h: number): void {
    const meta = doc.meta!;
    w = Math.round(Math.min(LIMITS.maxW, Math.max(LIMITS.minW, w)) / 10) * 10;
    h = Math.round(Math.min(LIMITS.maxH, Math.max(LIMITS.minH, h)) / 10) * 10;
    if (w === meta.world.w && h === meta.world.h) return;
    remember();
    // keep everything the same height above the floor
    const dy = h - meta.world.h;
    meta.world = { w, h };
    const walls = outerWalls(w, h);
    for (let i = 4; i < doc.platforms.length; i++) doc.platforms[i].y += dy;
    for (const s of [doc.spots.start, doc.spots.goopReset]) s.y += dy;
    for (let i = 0; i < 4; i++) Object.assign(doc.platforms[i], { x: walls[i].x, y: walls[i].y, w: walls[i].w, h: walls[i].h });
    map = currentMap();
    cam.y += dy;
    changed();
  }

  // ---------------------------------------------------------------- save and test

  function saveDraft(): void {
    if (!draft) return;
    window.clearTimeout(autosave);
    draft.save(draftDoc());
    dirty = false;
    updateTitle();
    const line = panel.querySelector('.ed-draft-status');
    if (line) line.textContent = draft.status(draftDoc());
  }

  async function save(): Promise<boolean> {
    const problem = check();
    if (problem) {
      status(problem, true);
      return false;
    }
    if (draft) {
      saveDraft();
      status('Saved');
      return true;
    }
    persistSession();
    try {
      const res = await fetch('/__editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map: mapId, platforms: doc.platforms, spots: doc.spots, areas: map.areas }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? res.statusText);
      dirty = false;
      updateTitle();
      status(`Saved src/sim/maps/${mapId}.ts`);
      return true;
    } catch (e) {
      status(`Couldn't save: ${(e as Error).message}. Is this the dev server (npm run dev)?`, true);
      return false;
    }
  }

  function check(): string | null {
    if (draft) return checkDoc(draftDoc());
    for (const [i, p] of doc.platforms.entries()) {
      if (!(p.w > 0 && p.h > 0)) return `Piece ${i} has no size`;
      if (![p.x, p.y, p.w, p.h, p.area].every(Number.isFinite)) return `Piece ${i} has a bad number`;
    }
    return null;
  }

  /** Play from a point (a practice run), or from the start when `at` is null (drafts only). */
  async function test(at: { x: number; y: number } | null): Promise<void> {
    if (draft) {
      const problem = check();
      if (problem) return status(problem, true);
      saveDraft();
      draft.play(draftDoc(), at && { x: Math.round(at.x), y: Math.round(at.y) });
      return;
    }
    if (dirty && !(await save())) return;
    const p = at ?? doc.spots.start;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    window.open(`/?debug&map=${mapId}&mode=${mode}&at=${x},${y}`, '_blank');
    status(`Testing from ${x}, ${y} in ${mode === 'newage' ? 'New Age' : 'Original'} (keys 1-9 teleport)`);
  }

  /** Where a test from the selection starts: on top of the selected piece, or at the selected spot. */
  function testSpot(): { x: number; y: number } {
    const p = selected();
    if (p) return { x: p.x + p.w / 2 - DUDE.w / 2, y: p.y - DUDE.h - 1 };
    if (sel?.kind === 'spot') return spotPos(sel.key);
    const v = view();
    return toWorld(v.w / 2, v.h / 2);
  }

  // ---------------------------------------------------------------- panel

  let fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};

  function updateTitle(): void {
    if (!draft) document.title = `${dirty ? '● ' : ''}Level Editor · ${map.name}`;
    const b = panel.querySelector<HTMLButtonElement>('.ed-save');
    if (b) b.textContent = dirty && !draft ? 'Save ●' : 'Save';
  }

  function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', { type: 'button', textContent: label, className: cls });
    b.addEventListener('click', onClick);
    return b;
  }

  function numberField(label: string, key: string, get: () => number, setv: (v: number) => void, step = 10): HTMLElement {
    const input = el('input', { type: 'number', step: String(step), value: String(get()) });
    input.addEventListener('focus', () => remember());
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      setv(v);
      touch();
      draw();
    });
    fields[key] = input;
    return el('label', { className: 'ed-field' }, [el('span', { textContent: label }), input]);
  }

  function selectField<T extends string>(label: string, key: string, options: [T, string][], get: () => T, setv: (v: T) => void): HTMLElement {
    const s = el('select');
    for (const [v, text] of options) s.append(el('option', { value: v, textContent: text }));
    s.value = get();
    s.addEventListener('change', () => {
      remember();
      setv(s.value as T);
      buildPanel();
      changed();
    });
    fields[key] = s;
    return el('label', { className: 'ed-field' }, [el('span', { textContent: label }), s]);
  }

  function syncPanel(): void {
    const p = selected();
    const set = (k: string, v: number | string) => {
      const f = fields[k];
      if (f && document.activeElement !== f) f.value = String(v);
    };
    if (p) {
      set('x', p.x);
      set('y', p.y);
      set('w', p.w);
      set('h', p.h);
      set('area', p.area);
      if (p.mover) {
        set('range', p.mover.range);
        set('speed', p.mover.speed);
      }
    } else if (sel?.kind === 'spot') {
      const s = spotPos(sel.key);
      set('x', s.x);
      set('y', s.y);
    }
    if (doc.meta) {
      set('worldW', doc.meta.world.w);
      set('worldH', doc.meta.world.h);
    }
  }

  function topSection(): HTMLElement {
    if (!draft) {
      const mapSel = el('select', { className: 'ed-map' });
      for (const id of MAP_IDS) mapSel.append(el('option', { value: id, textContent: MAPS[id].name }));
      mapSel.value = mapId;
      mapSel.addEventListener('change', () => switchMap(mapSel.value));
      const modeSel = el('select');
      modeSel.append(el('option', { value: 'original', textContent: 'Original' }), el('option', { value: 'newage', textContent: 'New Age' }));
      modeSel.value = mode;
      modeSel.addEventListener('change', () => {
        mode = modeSel.value as Mode;
        persistSession();
        draw();
      });
      return el('section', {}, [
        el('h1', { textContent: 'Level editor' }),
        el('label', { className: 'ed-field' }, [el('span', { textContent: 'Map' }), mapSel]),
        el('label', { className: 'ed-field' }, [el('span', { textContent: 'Mode' }), modeSel]),
        el('div', { className: 'ed-row' }, [button('Save', () => void save(), 'primary ed-save'), button('Test here', () => void test(testSpot())), button('Undo', undoOnce), button('Redo', redoOnce)]),
      ]);
    }
    const meta = doc.meta!;
    const name = el('input', { type: 'text', value: meta.name, maxLength: LIMITS.name, placeholder: 'Name your map' });
    name.addEventListener('focus', () => remember());
    name.addEventListener('input', () => {
      meta.name = name.value;
      touch();
    });
    name.addEventListener('change', () => {
      meta.name = cleanName(name.value) || 'Untitled map';
      name.value = meta.name;
      touch();
    });
    const modeSel = selectField<Mode>('Played in', 'mode', [['newage', 'New Age'], ['original', 'Original']], () => mode, v => (mode = v));
    const skySel = selectField<MapDoc['theme']>('Sky', 'theme', [['dawn', 'Night into dawn'], ['sunset', 'Sunset into night']], () => meta.theme, v => (meta.theme = v));
    const size = (label: string, key: 'worldW' | 'worldH', axis: 'w' | 'h') => {
      const input = el('input', { type: 'number', step: '100', value: String(meta.world[axis]) });
      const apply = () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        resizeWorld(axis === 'w' ? v : meta.world.w, axis === 'h' ? v : meta.world.h);
        input.value = String(meta.world[axis]);
      };
      input.addEventListener('change', apply);
      fields[key] = input;
      return el('label', { className: 'ed-field' }, [el('span', { textContent: label }), input]);
    };
    return el('section', {}, [
      el('h1', { textContent: 'Map maker' }),
      el('label', { className: 'ed-field' }, [el('span', { textContent: 'Name' }), name]),
      el('div', { className: 'ed-grid2' }, [modeSel, skySel, size('Width', 'worldW', 'w'), size('Height', 'worldH', 'h')]),
      el('p', { className: 'ed-hint ed-draft-status', textContent: draft.status(draftDoc()) }),
      el('div', { className: 'ed-row' }, [button('Play from the start', () => void test(null), 'primary'), button('Test here', () => void test(testSpot()))]),
      el('div', { className: 'ed-row' }, [button('Undo', undoOnce), button('Redo', redoOnce), button('Done', close)]),
    ]);
  }

  function buildPanel(): void {
    fields = {};
    const addAt = () => {
      const v = view();
      return toWorld(v.w / 2, v.h / 2);
    };
    const kinds = el('div', { className: 'ed-row' }, [
      button('Girder', () => add('girder', addAt())),
      button('Target', () => add('target', addAt())),
      button('Goop', () => add('goop', addAt())),
      button('Spring', () => add('spring', addAt())),
      button('Bumper', () => add('bumper', addAt())),
    ]);
    if (draft) kinds.append(button('Goal', () => add('goal', addAt())));
    const adds = el('section', {}, [el('h2', { textContent: 'Add' }), kinds]);
    if (!draft)
      adds.append(
        el('div', { className: 'ed-row' }, [
          button('Add teleport', () => {
            remember();
            doc.spots.teleports.push(addAt());
            sel = { kind: 'spot', key: `tp${doc.spots.teleports.length - 1}` };
            buildPanel();
            changed();
          }),
        ]),
      );

    const props = el('section', { className: 'ed-props' });
    const p = selected();
    if (p && sel?.kind === 'plat') {
      const i = sel.i;
      props.append(el('h2', { textContent: `Piece ${i}${isWall(i) ? ' (outer wall)' : ''}` }));
      if (!(draft && isWall(i)))
        props.append(
          selectField<PlatformKind>('Kind', 'kind', [['girder', 'Girder'], ['target', 'Target'], ['goop', 'Goop'], ['spring', 'Spring'], ['goal', 'Goal']], () => p.kind, v => {
            p.kind = v;
            if (v === 'target') {
              p.w = 25;
              p.h = 25;
            }
          }),
        );
      const wall = draft && isWall(i);
      props.append(
        el('div', { className: 'ed-grid2' }, [
          ...(wall
            ? []
            : [
                numberField('X', 'x', () => p.x, v => (p.x = v)),
                numberField('Y', 'y', () => p.y, v => (p.y = v)),
                ...(p.kind === 'target' ? [] : [numberField('Width', 'w', () => p.w, v => (p.w = Math.max(1, v))), numberField('Height', 'h', () => p.h, v => (p.h = Math.max(1, v)))]),
              ]),
          ...(draft ? [] : [numberField('Area', 'area', () => p.area, v => (p.area = Math.max(0, Math.round(v))), 1)]),
        ]),
      );
      if (wall) props.append(el('p', { className: 'ed-hint', textContent: 'The outer walls follow the map’s size (Width and Height at the top).' }));
      if (!wall) {
        const mover = el('input', { type: 'checkbox', checked: !!p.mover });
        mover.addEventListener('change', () => {
          remember();
          p.mover = mover.checked ? { range: 200, speed: 6 } : undefined;
          if (!p.mover) delete p.mover;
          buildPanel();
          changed();
        });
        props.append(el('label', { className: 'ed-check' }, [mover, el('span', { textContent: 'Moves side to side' })]));
        if (p.mover) {
          const m = p.mover;
          props.append(el('div', { className: 'ed-grid2' }, [numberField('Travel (px)', 'range', () => m.range, v => (m.range = Math.max(0, v))), numberField('Speed (px/tick)', 'speed', () => m.speed, v => (m.speed = v), 1)]));
        }
      }
      if (!draft) {
        props.append(
          selectField<'' | 'original' | 'newage'>('Exists in', 'onlyIn', [['', 'Both modes'], ['original', 'Original only'], ['newage', 'New Age only']], () => p.onlyIn ?? '', v => {
            if (v) p.onlyIn = v;
            else delete p.onlyIn;
          }),
        );
        if (map.split) {
          props.append(
            selectField<'' | 'trapdoor' | 'plug' | 'troll'>('Trick', 'role', [['', 'None'], ['trapdoor', 'Trapdoor (gone once above the floor)'], ['plug', 'Plug (appears once above)'], ['troll', 'Troll target']], () => p.role ?? '', v => {
              if (v) p.role = v;
              else delete p.role;
            }),
          );
        }
        const note = el('input', { type: 'text', value: p.note ?? '', placeholder: 'a comment for the map file' });
        note.addEventListener('focus', () => remember());
        note.addEventListener('input', () => {
          if (note.value) p.note = note.value;
          else delete p.note;
          touch();
        });
        props.append(el('label', { className: 'ed-field' }, [el('span', { textContent: 'Note' }), note]));
      }
      if (!wall) props.append(el('div', { className: 'ed-row' }, [button('Duplicate', duplicateSelected), button('Delete', removeSelected, 'danger'), button('Earlier', () => move(-1)), button('Later', () => move(1))]));
      if (!wall) props.append(el('p', { className: 'ed-hint', textContent: 'Earlier/Later changes the list order. Original mode checks collisions in list order, like the 2023 game.' }));
    } else if (sel?.kind === 'spot') {
      const s = spotPos(sel.key);
      props.append(el('h2', { textContent: spotLabel(sel.key) }), el('div', { className: 'ed-grid2' }, [numberField('X', 'x', () => s.x, v => (s.x = v)), numberField('Y', 'y', () => s.y, v => (s.y = v))]));
      if (sel.key.startsWith('tp')) props.append(el('div', { className: 'ed-row' }, [button('Delete', removeSelected, 'danger')]));
      props.append(el('p', { className: 'ed-hint', textContent: 'The box is the dude (46 x 50); x, y is his top-left corner.' }));
    } else {
      props.append(el('p', { className: 'ed-hint', textContent: 'Click a piece to edit it.' }));
    }

    const opts = el('section', {}, [
      el('h2', { textContent: 'View' }),
      el('div', { className: 'ed-row' }, [button('Zoom in', () => zoomBy(1.4)), button('Zoom out', () => zoomBy(1 / 1.4)), button('Fit', () => (fit(), persistSession(), draw()))]),
      checkbox('Snap to a 10 px grid', snap, v => (snap = v)),
      checkbox('Show hook reach around targets', showReach, v => (showReach = v)),
    ]);

    const tips = draft
      ? [
          'Drag a piece to move it; drag its yellow handles to resize.',
          'Drag empty space to pan; scroll or use the zoom buttons to zoom.',
          'The green box is where he starts. The goal is the room (or block) he has to reach.',
          'Circles show how far the plunger reaches from each target.',
          'Test here plays from the selected piece, for practice. To upload a map, beat it with Play from the start.',
          'Keys: Del deletes, Ctrl+D duplicates, Ctrl+Z / Ctrl+Y undo and redo, arrows nudge, T tests from the mouse, F fits the map.',
          draft.restartKey() ? `Your restart key (${draft.restartKey()!.label}) plays from the start, here and during a run.` : 'Set a restart key in Settings to play from the start with one key, here and during a run.',
        ]
      : [
          'Drag a piece to move it; drag its yellow handles to resize.',
          'Drag empty space (or right-drag) to pan; scroll to zoom.',
          'Alt while dragging: no grid. Arrows nudge (Shift: 1 px).',
          'Del deletes, Ctrl+D duplicates, Ctrl+Z / Ctrl+Y undo and redo.',
          'Ctrl+S saves. T tests from the mouse; F fits the map; R toggles reach.',
          'Saving rewrites the map file. Bot replays for a map stop matching once you change it; re-run the bot (see README).',
        ];
    const help = el('section', { className: 'ed-help' }, [el('h2', { textContent: draft ? 'How it works' : 'Keys' }), el('ul', {}, tips.map(t => el('li', { textContent: t })))]);

    panel.replaceChildren(topSection(), adds, props, opts, help);
    updateTitle();
  }

  function checkbox(label: string, value: boolean, setv: (v: boolean) => void): HTMLElement {
    const c = el('input', { type: 'checkbox', checked: value });
    c.addEventListener('change', () => {
      setv(c.checked);
      draw();
    });
    return el('label', { className: 'ed-check' }, [c, el('span', { textContent: label })]);
  }

  function switchMap(id: MapId): void {
    if (dirty && !confirm('Discard unsaved changes to this map?')) {
      panel.querySelector<HTMLSelectElement>('.ed-map')!.value = mapId;
      return;
    }
    persistSession();
    mapId = id;
    map = MAPS[id];
    doc = fresh(map);
    sel = null;
    undo = saved?.history?.[id]?.undo ?? [];
    redo = saved?.history?.[id]?.redo ?? [];
    dirty = false;
    mode = map.designedFor;
    fit();
    history.replaceState(null, '', `?map=${id}`);
    buildPanel();
    persistSession();
    draw();
  }

  // ---------------------------------------------------------------- input

  type Drag =
    | { type: 'pan'; sx: number; sy: number; cx: number; cy: number }
    | { type: 'move'; start: { x: number; y: number }; orig: { x: number; y: number }; before: string }
    | { type: 'resize'; handle: Handle; start: { x: number; y: number }; orig: { x: number; y: number; w: number; h: number }; before: string };
  let drag: Drag | null = null;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events can't be captured
    }
    const { sx, sy } = local(e);
    const w = toWorld(sx, sy);
    if (e.button === 1 || e.button === 2) {
      drag = { type: 'pan', sx, sy, cx: cam.x, cy: cam.y };
      return;
    }
    const h = hitHandle(sx, sy, e.pointerType === 'touch');
    const p = selected();
    if (h && p) {
      drag = { type: 'resize', handle: h, start: w, orig: { x: p.x, y: p.y, w: p.w, h: p.h }, before: snapshot() };
      return;
    }
    const hit = hitTest(w.x, w.y);
    if (JSON.stringify(hit) !== JSON.stringify(sel)) {
      sel = hit;
      buildPanel();
    }
    // the outer walls of a draft follow the map size, so they can't be dragged
    const fixed = draft && hit?.kind === 'plat' && isWall(hit.i);
    if (hit && !fixed) {
      const b = hit.kind === 'plat' ? doc.platforms[hit.i] : spotPos(hit.key);
      drag = { type: 'move', start: w, orig: { x: b.x, y: b.y }, before: snapshot() };
    } else drag = { type: 'pan', sx, sy, cx: cam.x, cy: cam.y };
    draw();
  });

  canvas.addEventListener('pointermove', e => {
    const { sx, sy } = local(e);
    const w = toWorld(sx, sy);
    mouseWorld = w;
    if (!drag) {
      const h = hitHandle(sx, sy);
      canvas.style.cursor = h ? (h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize') : 'default';
      const hv = hitTest(w.x, w.y);
      if (JSON.stringify(hv) !== JSON.stringify(hover)) hover = hv;
      draw();
      return;
    }
    if (drag.type === 'pan') {
      cam.x = drag.cx - (sx - drag.sx) / cam.zoom;
      cam.y = drag.cy - (sy - drag.sy) / cam.zoom;
    } else if (drag.type === 'move' && sel) {
      const b = sel.kind === 'plat' ? doc.platforms[sel.i] : spotPos(sel.key);
      b.x = snapTo(drag.orig.x + (w.x - drag.start.x), e.altKey);
      b.y = snapTo(drag.orig.y + (w.y - drag.start.y), e.altKey);
      syncPanel();
    } else if (drag.type === 'resize' && sel?.kind === 'plat') {
      const p = doc.platforms[sel.i];
      const o = drag.orig;
      const dx = w.x - drag.start.x;
      const dy = w.y - drag.start.y;
      const hd = drag.handle;
      if (hd.includes('e')) p.w = Math.max(5, snapTo(o.x + o.w + dx, e.altKey) - o.x);
      if (hd.includes('s')) p.h = Math.max(5, snapTo(o.y + o.h + dy, e.altKey) - o.y);
      if (hd.includes('w')) {
        const nx = Math.min(snapTo(o.x + dx, e.altKey), o.x + o.w - 5);
        p.w = o.x + o.w - nx;
        p.x = nx;
      }
      if (hd.includes('n')) {
        const ny = Math.min(snapTo(o.y + dy, e.altKey), o.y + o.h - 5);
        p.h = o.y + o.h - ny;
        p.y = ny;
      }
      syncPanel();
    }
    draw();
  });

  const endDrag = () => {
    if (drag && drag.type !== 'pan' && drag.before !== snapshot()) {
      undo.push(drag.before);
      redo = [];
      changed();
    }
    if (drag?.type === 'pan') persistSession();
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const { sx, sy } = local(e);
      zoomBy(Math.pow(1.0015, -e.deltaY), sx, sy);
    },
    { passive: false },
  );

  const onKey = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const ctrl = e.ctrlKey || e.metaKey;
    if (draft && !typing && matches(draft.restartKey(), e)) {
      // the player's restart key comes first, even over the editor's own keys
      e.preventDefault();
      if (!e.repeat) void test(null);
      return;
    }
    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (typing) return;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoOnce();
      else undoOnce();
    } else if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redoOnce();
    } else if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateSelected();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    } else if (e.key === 'Escape') {
      sel = null;
      buildPanel();
      draw();
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : GRID;
      nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    } else if (e.key === 't' || e.key === 'T') void test({ x: mouseWorld.x - DUDE.w / 2, y: mouseWorld.y - DUDE.h / 2 });
    else if (e.key === 'f' || e.key === 'F') {
      fit();
      persistSession();
      draw();
    } else if (e.key === 'r' || e.key === 'R') {
      showReach = !showReach;
      buildPanel();
      draw();
    }
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    persistSession();
    if (draft) saveDraft();
    else if (dirty) e.preventDefault();
  };
  const onResize = () => draw();
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('resize', onResize);

  function close(): void {
    if (!draft) return;
    saveDraft();
    draft.close();
  }

  // ---------------------------------------------------------------- go

  buildPanel();
  requestAnimationFrame(() => {
    if (fitOnLoad) fit();
    fitOnLoad = false;
    draw();
  });
  if (!draft && import.meta.env.PROD) status('The level editor needs the dev server (npm run dev) to save.', true);

  return {
    destroy() {
      if (draft && dirty) saveDraft();
      window.clearTimeout(autosave);
      window.clearTimeout(statusTimer);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('resize', onResize);
      root.remove();
    },
  };
}
