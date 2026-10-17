// Homages to the Foddian games the original put in area 4 (as copied pictures):
// a man in a cauldron with a hammer, a fallen little king, and a kid on a pogo stick.
// All original pixel art, drawn procedurally.

import type { Cameo } from '../sim/level';
import { SCALE } from './level-art';
import { P } from './palette';
import { ctx2d, dot, ellipse, line, makeCanvas, outline, rect, type Ctx } from './px';

let cauldronArt: HTMLCanvasElement | null = null;
function cauldron(): HTMLCanvasElement {
  if (cauldronArt) return cauldronArt;
  const c = makeCanvas(90, 90);
  const ctx = ctx2d(c);
  // hammer handle behind him
  line(ctx, 22, 70, 72, 12, '#e8b04a');
  line(ctx, 23, 70, 73, 12, '#c48a10');
  // torso and shoulders
  ellipse(ctx, 42, 40, 17, 12, P.skin);
  rect(ctx, 27, 38, 30, 12, P.skin);
  ellipse(ctx, 35, 41, 4, 3, P.skinS);
  ellipse(ctx, 50, 41, 4, 3, P.skinS);
  // head: bald, stubbly beard
  ellipse(ctx, 41, 18, 9, 10, P.skin);
  ellipse(ctx, 43, 24, 7, 5, '#7a5a48');
  rect(ctx, 40, 22, 7, 2, P.skin);
  dot(ctx, 45, 16, P.ink);
  dot(ctx, 44, 13, P.hair);
  dot(ctx, 46, 13, P.hair);
  dot(ctx, 50, 18, P.skinS);
  // arms reaching for the handle
  line(ctx, 52, 34, 60, 26, P.skin);
  line(ctx, 52, 35, 61, 27, P.skin);
  line(ctx, 30, 38, 44, 46, P.skin);
  line(ctx, 30, 39, 44, 47, P.skin);
  ellipse(ctx, 61, 25, 2.5, 2.5, P.skin);
  ellipse(ctx, 46, 46, 2.5, 2.5, P.skin);
  // hammer head
  rect(ctx, 64, 3, 20, 11, P.s2);
  rect(ctx, 64, 3, 20, 2, P.s4);
  rect(ctx, 64, 12, 20, 2, P.s1);
  rect(ctx, 82, 3, 2, 11, P.s3);
  // the cauldron
  ellipse(ctx, 44, 68, 33, 21, P.s0);
  ellipse(ctx, 34, 62, 12, 8, P.s1);
  rect(ctx, 10, 47, 68, 6, P.s1);
  rect(ctx, 10, 47, 68, 1, P.s3);
  rect(ctx, 10, 52, 68, 1, P.black);
  rect(ctx, 20, 86, 6, 3, P.s0);
  rect(ctx, 62, 86, 6, 3, P.s0);
  outline(c, P.ink);
  cauldronArt = c;
  return c;
}

let kingArt: HTMLCanvasElement | null = null;
function fallenKing(): HTMLCanvasElement {
  if (kingArt) return kingArt;
  const c = makeCanvas(68, 26);
  const ctx = ctx2d(c);
  // lying face down, feet on the left, head on the right
  rect(ctx, 6, 18, 9, 5, '#5a3a22'); // boots
  rect(ctx, 14, 16, 10, 7, P.n1); // legs
  rect(ctx, 22, 13, 18, 10, P.b0); // tunic
  rect(ctx, 22, 13, 18, 2, P.b1);
  rect(ctx, 20, 10, 22, 6, P.r1); // cape over the back
  rect(ctx, 20, 10, 22, 1, P.r2);
  for (let x = 20; x < 42; x += 3) dot(ctx, x, 15, P.r0);
  ellipse(ctx, 46, 17, 6, 5, P.hair); // head, face down
  rect(ctx, 50, 19, 3, 3, P.skin);
  rect(ctx, 38, 21, 6, 2, P.skin); // hand
  // the crown, knocked off
  rect(ctx, 56, 17, 9, 5, P.y1);
  dot(ctx, 56, 16, P.y1);
  dot(ctx, 60, 15, P.y1);
  dot(ctx, 64, 16, P.y1);
  rect(ctx, 56, 17, 9, 1, P.y2);
  dot(ctx, 60, 19, P.r1);
  outline(c, P.ink);
  kingArt = c;
  return c;
}

const pogoFrames: HTMLCanvasElement[] = [];
function pogoKid(frame: number): HTMLCanvasElement {
  if (pogoFrames[frame]) return pogoFrames[frame];
  const c = makeCanvas(66, 76);
  const ctx = ctx2d(c);
  const lift = frame === 0 ? 0 : 6; // frame 1: up in the air, spring stretched
  const squash = frame === 0 ? 3 : 0;
  const cx = 33;
  const footY = 58 - lift + squash;
  // pogo stick
  rect(ctx, cx - 1, 30 - lift + squash, 3, 44 - squash, P.s2);
  rect(ctx, cx, 30 - lift + squash, 1, 44 - squash, P.s4);
  rect(ctx, cx - 9, 31 - lift + squash, 19, 3, P.s1); // handlebar
  rect(ctx, cx - 10, 31 - lift + squash, 3, 3, P.black);
  rect(ctx, cx + 8, 31 - lift + squash, 3, 3, P.black);
  rect(ctx, cx - 6, footY, 13, 2, P.s1); // foot pegs
  for (let y = footY + 3; y < 72; y += 3) rect(ctx, cx - 3, y, 7, 1, P.s3); // spring
  rect(ctx, cx - 2, 72, 5, 4, P.black);
  // kid
  rect(ctx, cx - 6, footY - 3, 4, 3, P.r0); // shoes
  rect(ctx, cx + 3, footY - 3, 4, 3, P.r0);
  rect(ctx, cx - 5, footY - 14, 3, 11, P.n1); // legs
  rect(ctx, cx + 3, footY - 14, 3, 11, P.n1);
  const bodyTop = footY - 30;
  rect(ctx, cx - 7, bodyTop, 15, 17, P.white);
  for (let y = bodyTop + 1; y < bodyTop + 17; y += 3) rect(ctx, cx - 7, y, 15, 1, P.r1); // striped shirt
  line(ctx, cx - 7, bodyTop + 4, cx - 9, 32 - lift + squash, P.skin); // arms to the handlebar
  line(ctx, cx + 7, bodyTop + 4, cx + 9, 32 - lift + squash, P.skin);
  ellipse(ctx, cx, bodyTop - 8, 9, 9, P.skin); // big head
  ellipse(ctx, cx, bodyTop - 12, 10, 6, P.r1); // helmet
  rect(ctx, cx - 10, bodyTop - 11, 21, 2, P.white);
  dot(ctx, cx + 3, bodyTop - 7, P.ink);
  dot(ctx, cx - 3, bodyTop - 7, P.ink);
  rect(ctx, cx - 1, bodyTop - 3, 3, 1, P.r0);
  outline(c, P.ink);
  pogoFrames[frame] = c;
  return c;
}

/** Draw the cameos (world px placement from the original), faded in by `alpha`. */
export function drawCameos(ctx: Ctx, cameos: readonly Cameo[], camX: number, camY: number, t: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  for (const cam of cameos) {
    const x = Math.round(cam.x / SCALE - camX);
    const bottom = Math.round((cam.y + cam.h) / SCALE - camY);
    if (cam.id === 'cauldron') {
      const art = cauldron();
      ctx.drawImage(art, x, bottom - art.height + 1);
    } else if (cam.id === 'king') {
      const art = fallenKing();
      ctx.drawImage(art, x, bottom - art.height + 1);
    } else {
      const frame = Math.floor(t * 3) % 2;
      const art = pogoKid(frame);
      ctx.drawImage(art, x, bottom - art.height + 1);
    }
  }
  ctx.restore();
}
