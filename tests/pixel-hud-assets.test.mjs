import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { uiAssetUrl } from '../src/ui/asset-paths.js';

const css = readFileSync(new URL('../src/ui/styles/main.css', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../src/ui/styles/pixel-hud.css', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../src/app/bootstrap.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Kingdom loads the pixel HUD layer after the base styles', () => {
  assert.match(bootstrap, /import '..\/ui\/styles\/main\.css';\s*import '..\/ui\/styles\/pixel-hud\.css';/);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test('HUD frames reuse existing UI components 9-slice sprite assets', () => {
  const urls = [...css.matchAll(/url\(['"]?(\/assets\/ui\/[^/]+\/[^)'"]+)['"]?\)/g)]
    .map(match => match[1]);
  assert.ok(urls.length >= 4, 'expected sprite-frame references');
  for (const url of new Set(urls)) {
    assert.ok(existsSync(new URL('../public' + url, import.meta.url)), 'Missing asset: ' + url);
  }
  assert.match(css, /border-image:[^;]+64 fill/);
});

test('ribbon centers use the atlas connector segment across every color', () => {
  for (const color of ['cyan', 'red', 'yellow', 'purple', 'black']) {
    const png = readFileSync(new URL(`../public/assets/ui/ribbons/ribbon-${color}-center.png`, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), 64, `${color} center uses the source connector width`);
    assert.equal(png.readUInt32BE(20), 96, `${color} center uses the source connector height`);
  }
});

test('UI components resolves logical filenames by UI use and chooses WebP for production', () => {
  assert.match(bootstrap, /import '..\/ui\/components\/resource-meter.css';/);
  assert.equal(uiAssetUrl('ribbon-cyan-left.png', 'png'), '/assets/ui/ribbons/ribbon-cyan-left.png');
  assert.equal(uiAssetUrl('ribbon-cyan-left.png', 'webp'), '/assets/ui/ribbons/ribbon-cyan-left.webp');
  assert.equal(uiAssetUrl('hud-small-fill-red.png'), '/assets/ui/hud/hud-small-fill-red.png');
  assert.throws(() => uiAssetUrl('missing.png'), /Unknown UI asset/);
});

test('the mobile chronicle parchment leaves a clear lane for the fixed zoom controls', () => {
  assert.match(css, /\.journal-panel\{top:42px;left:7px;right:7px;bottom:72px;width:auto;max-height:none\}/);
});

test('HUD omits food warning and keeps established panel semantics', () => {
  assert.doesNotMatch(html, /foodPressureTag|foodRiskCount|mapTags|environmentToggle/);
  assert.match(html, /id="kingdomsToggle"/);
  assert.doesNotMatch(css, /map-tags|map-tag\.pressure/);
  assert.match(css, /\.left-panel \.community-card/);
});
