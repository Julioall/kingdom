import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/styles/main.css', import.meta.url), 'utf8')
  + '\n' + readFileSync(new URL('../src/ui/styles/pixel-hud.css', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../src/app/bootstrap.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Kingdom loads the pixel HUD layer after the base styles', () => {
  assert.match(bootstrap, /import '..\/ui\/styles\/main\.css';\s*import '..\/ui\/styles\/pixel-hud\.css';/);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test('HUD frames reuse existing Forja 9-slice sprite assets', () => {
  const urls = [...css.matchAll(/url\(['"]?(\/assets\/kingdom-ui\/[^)'"]+)['"]?\)/g)]
    .map(match => match[1]);
  assert.ok(urls.length >= 4, 'expected sprite-frame references');
  for (const url of new Set(urls)) {
    assert.ok(existsSync(new URL('../public' + url, import.meta.url)), 'Missing asset: ' + url);
  }
  assert.match(css, /border-image:[^;]+64 fill/);
});

test('ribbon centers use the atlas connector segment across every color', () => {
  for (const color of ['cyan', 'red', 'yellow', 'purple', 'black']) {
    const png = readFileSync(new URL(`../public/assets/kingdom-ui/ribbon-${color}-center.png`, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), 64, `${color} center uses the source connector width`);
    assert.equal(png.readUInt32BE(20), 96, `${color} center uses the source connector height`);
  }
});

test('HUD omits food warning and keeps established panel semantics', () => {
  assert.doesNotMatch(html, /foodPressureTag|foodRiskCount|mapTags|environmentToggle/);
  assert.match(html, /id="kingdomsToggle"/);
  assert.doesNotMatch(css, /map-tags|map-tag\.pressure/);
  assert.match(css, /\.left-panel \.community-card/);
});
