// Not a test: rough frame-time measurement while playing. Run with --config tools/screens.config.ts --grep perf
import { test } from '@playwright/test';

test('perf', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?debug&mode=newage&at=1000,2400');
  await page.mouse.move(900, 300);
  const stats = await page.evaluate(
    () =>
      new Promise<{ avg: number; p95: number; frames: number }>(resolve => {
        const times: number[] = [];
        let last = performance.now();
        const end = last + 3000;
        const loop = (t: number) => {
          times.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(loop);
          else {
            const sorted = times.slice(5).sort((a, b) => a - b);
            resolve({ avg: sorted.reduce((a, b) => a + b, 0) / sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)], frames: sorted.length });
          }
        };
        requestAnimationFrame(loop);
      }),
  );
  console.log(`PERF avg ${stats.avg.toFixed(2)} ms, p95 ${stats.p95.toFixed(2)} ms over ${stats.frames} frames`);
});
