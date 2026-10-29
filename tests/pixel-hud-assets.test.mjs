import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/styles/pixel-hud.css', import.meta.url), 'utf8');
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

test('HUD keeps survival warning and other established panel semantics', () => {
  assert.match(html, /id="foodPressureTag"/);
  assert.match(html, /id="kingdomsToggle"/);
  assert.match(css, /\.map-tags>\.map-tag\.pressure/);
  assert.match(css, /\.left-panel \.community-card/);
});
