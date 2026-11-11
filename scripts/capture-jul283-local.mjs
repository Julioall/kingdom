// JUL-283 — local, user-run browser/GPU QA capture; does not claim automatic visual acceptance.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const headed = !args.includes('--headless');
const durationArg = args.find(arg => arg.startsWith('--duration-ms='));
const durationMs = Number(durationArg?.split('=')[1] || 30000);
if (!Number.isSafeInteger(durationMs) || durationMs < 10000 || durationMs > 60000)
  throw Error('--duration-ms must be an integer from 10000 to 60000');
const output = resolve(args.find(arg => arg.startsWith('--output='))?.slice(9) || 'out/jul283-local');
const base = process.env.KINGDOM_BROWSER_URL || 'http://127.0.0.1:5173/';
const url = new URL(base);
url.searchParams.set('seed', '42');
url.searchParams.set('profile', '1');
url.searchParams.set('paused', '1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: !headed,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.kingdomProfiler?.snapshot && document.querySelector('.app')?.inert === false,
    null, { timeout: 120000 });
  const environment = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      webglRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      profileUrl: location.href
    };
  });
  const captures = [];
  async function capture(name) {
    await page.evaluate(() => window.kingdomProfiler.reset());
    await page.waitForTimeout(durationMs);
    const data = await page.evaluate(() => window.kingdomProfiler.snapshot({ includeSamples: true }));
    await page.screenshot({ path: resolve(output, name + '.png'), fullPage: false });
    captures.push({ name, collectedAt: new Date().toISOString(), frames: data.frames,
      map: data.map, context: data.context, raw: data });
  }
  await capture('paused');
  await page.locator('#world').hover();
  await page.mouse.wheel(0, -900);
  await page.mouse.move(700, 420);
  await capture('zoomed');
  await page.locator('#toggle').click();
  await capture('running');
  const report = {
    schema: 1, githubSha: process.env.GITHUB_SHA || 'record-git-rev-parse-HEAD',
    environment, headed, durationMs, captures, errors,
    manualChecks: {
      selection: 'PENDING HUMAN',
      movement: 'PENDING HUMAN',
      combat: 'PENDING HUMAN',
      formations: 'PENDING HUMAN',
      audio: 'PENDING HUMAN',
      savesSynthetic: 'PENDING HUMAN'
    },
    caution: 'Automated browser captures do not prove GPU frame time, input latency or gameplay acceptance. Check DevTools GPU/CPU traces and real human controls before closing JUL-283.'
  };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    output,
    browser: environment.userAgent,
    webglRenderer: environment.webglRenderer,
    captures: captures.map(c => ({ name: c.name, fps: c.frames?.fps, frameP95Ms: c.frames?.p95Ms })),
    pageErrors: errors.length,
    humanQA: 'PENDING'
  }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
