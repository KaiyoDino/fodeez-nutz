// Dev page: draws a whole map (or a slice of it) in one image, with every target numbered,
// its grapple reach, and the teleport points. Open /tools/overview.html?map=crane&mode=newage
// on the dev server (optional: y0, y1 in world px, scale).
import { getMap, type MapId } from '../src/sim/level';
import { NA } from '../src/sim/newage';
import { buildStaticLayer, drawGirder, drawGoopBody, drawSpring, targetSprite, toPx } from '../src/render/level-art';

const q = new URLSearchParams(location.search);
const map = getMap((q.get('map') ?? 'crane') as MapId);
const mode = q.get('mode') ?? 'newage';
const y0 = Number(q.get('y0') ?? 0);
const y1 = Number(q.get('y1') ?? map.world.h);
const scale = Number(q.get('scale') ?? 0.5);

const layer = buildStaticLayer(map).canvas;
const c = document.getElementById('c') as HTMLCanvasElement;
c.width = Math.round(map.world.w * scale);
c.height = Math.round((y1 - y0) * scale);
const ctx = c.getContext('2d')!;
ctx.imageSmoothingEnabled = false;
ctx.save();
ctx.scale(scale * 2, scale * 2);
ctx.translate(0, -y0 / 2);
ctx.drawImage(layer, 0, 0);
// pieces the static layer leaves out
for (const def of map.platforms) {
  if (def.onlyIn && def.onlyIn !== mode) continue;
  const b = toPx(def);
  if (def.kind === 'target') ctx.drawImage(targetSprite('normal'), b.x - 1, b.y - 1);
  else if (def.kind === 'spring') drawSpring(ctx, b, 0, 'top');
  else if (def.mover || def.role || def.onlyIn) {
    if (def.kind === 'girder') drawGirder(ctx, b);
    if (def.kind === 'goop') drawGoopBody(ctx, b);
  }
}
ctx.restore();

const W = (x: number) => x * scale;
const H = (y: number) => (y - y0) * scale;
ctx.font = `${Math.max(10, Math.round(22 * scale))}px monospace`;
ctx.textBaseline = 'middle';
map.platforms.forEach((def, i) => {
  if (def.onlyIn && def.onlyIn !== mode) return;
  if (def.kind === 'target') {
    const cx = def.x + def.w / 2;
    const cy = def.y + def.h / 2;
    ctx.strokeStyle = 'rgba(159,243,255,0.18)';
    ctx.beginPath();
    ctx.arc(W(cx), H(cy), NA.hookRange * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#9ff3ff';
    ctx.fillText(String(i), W(cx) + 16 * scale + 3, H(cy));
  } else if (i >= 4) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(String(i), W(def.x) + 3, H(def.y) - 10 * scale);
  }
});
map.teleports.forEach((t, i) => {
  ctx.strokeStyle = '#ffc23a';
  ctx.strokeRect(W(t.x), H(t.y), 46 * scale, 50 * scale);
  ctx.fillStyle = '#ffc23a';
  ctx.fillText(`T${i + 1}`, W(t.x) - 30 * scale - 10, H(t.y) + 25 * scale);
});
// a world-px ruler every 500
ctx.fillStyle = 'rgba(255,255,255,0.5)';
for (let y = Math.ceil(y0 / 500) * 500; y <= y1; y += 500) {
  ctx.fillRect(0, H(y), 12, 1);
  ctx.fillText(String(y), 14, H(y));
}
document.title = 'ready';
