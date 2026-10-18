// Not a test: rough CPU and frame-time measurements. Run with --config tools/screens.config.ts --grep perf
import { test, type Page } from '@playwright/test';

/** Busy time of the page's main thread per second of wall time, plus frame stats. */
async function measure(page: Page, label: string, ms = 3000): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  const stats = await page.evaluate(
    ms =>
      new Promise<{ avg: number; p95: number; frames: number }>(resolve => {
        const times: number[] = [];
        let last = performance.now();
        const end = last + ms;
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
    ms,
  );
  const after = await cdp.send('Performance.getMetrics');
  const get = (m: typeof before, name: string) => m.metrics.find(x => x.name === name)?.value ?? 0;
  const busy = (get(after, 'TaskDuration') - get(before, 'TaskDuration')) / (ms / 1000);
  console.log(`PERF ${label}: main thread busy ${(busy * 100).toFixed(1)}%, frame avg ${stats.avg.toFixed(2)} ms, p95 ${stats.p95.toFixed(2)} ms over ${stats.frames} frames`);
}

test('perf play', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?debug&mode=newage&at=1000,2400');
  await page.mouse.move(900, 300);
  await measure(page, 'playing');
});

test('perf title', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?debug');
  await page.waitForTimeout(500);
  await measure(page, 'title');
});

test('perf replay end', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?debug&menu=watch&map=tower');
  await page.waitForTimeout(500);
  await measure(page, 'replay running');
  await page.locator('#replay-seek').fill('1000');
  await page.waitForTimeout(1500);
  await measure(page, 'replay ended');
});
