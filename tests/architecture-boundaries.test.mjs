import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const inside = (path, directory) => path === directory || path.startsWith(directory + sep);
const modules = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return modules(path);
  return /\.[cm]?[jt]sx?$/.test(path) ? [path] : [];
});
const relativeImports = text => [
  ...text.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"]((?:\.\/|\.\.\/)[^'"]+)['"]/g),
  ...text.matchAll(/\bimport\s*\(\s*['"]((?:\.\/|\.\.\/)[^'"]+)['"]\s*\)/g)
].map(match => match[1]);

test('authoritative simulation and AI cannot import browser rendering or UI modules', () => {
  const browserUI = resolve(src, 'ui');
  const internalDomainFolders = ['simulation', 'ai', 'config'];
  let checked = 0;
  for (const folder of internalDomainFolders) for (const path of modules(resolve(src, folder))) {
    const text = readFileSync(path, 'utf8');
    for (const dependency of relativeImports(text)) {
      const target = resolve(dirname(path), dependency);
      assert.equal(inside(target, browserUI), false,
        'Domain module must not depend on browser UI: ' + path + ' -> ' + dependency);
      checked++;
    }
  }
  assert.ok(checked > 30, 'Boundary scanner must actually inspect module dependencies');
});

test('realm and military presenters remain pure and do not own DOM or simulation actions', () => {
  for (const relative of ['ui/kingdom-list.js', 'ui/inspectors/tactical-inspector.js']) {
    const content = readFileSync(resolve(src, relative), 'utf8');
    assert.doesNotMatch(content, /\b(?:window|document|localStorage|session\.dispatch|requestAnimationFrame)\b/);
    assert.ok(content.split('\n').length < 180, relative + ' has become another controller');
  }
});
