import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/prepare-pages.mjs', import.meta.url));

test('Pages asset rewrite preserves Vite base and rewrites only root-relative public assets', async () => {
  const work = await mkdtemp(join(tmpdir(), 'kingdom-pages-'));
  const fixtures = {
    'index.html': '<link href="/kingdom/assets/main.css"><script src="/kingdom/assets/app.js"></script><img src="/assets/ui/crest.webp">',
    'assets/main.css': "body{background:url('/assets/ui/frame.webp')}.ok{background:url('/kingdom/assets/ui/frame.webp')}",
    'assets/app.js': "const audio='/assets/audio/intro.ogg';const bundled='/kingdom/assets/chunk.js';const relative='./assets/texture.webp';",
    'assets/ui/crest.webp': '',
    'assets/ui/frame.webp': '',
  };
  try {
    for (const [name, value] of Object.entries(fixtures)) {
      const target = join(work, 'dist', name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, value);
    }
    const run = () => execFileAsync(process.execPath, [script], {
      cwd: work, env: { ...process.env, GITHUB_PAGES_BASE: '/kingdom/' }
    });
    await run();
    const html = await readFile(join(work, 'dist/index.html'), 'utf8');
    const css = await readFile(join(work, 'dist/assets/main.css'), 'utf8');
    const js = await readFile(join(work, 'dist/assets/app.js'), 'utf8');
    assert.match(html, /src="\/kingdom\/assets\/app\.js"/);
    assert.match(html, /src="\/kingdom\/assets\/ui\/crest\.webp"/);
    assert.match(css, /url\('\/kingdom\/assets\/ui\/frame\.webp'\)/);
    assert.match(js, /audio='\/kingdom\/assets\/audio\/intro\.ogg'/);
    assert.match(js, /relative='\.\/assets\/texture\.webp'/);
    for (const output of [html, css, js]) assert.doesNotMatch(output, /\/kingdom\/kingdom\/assets\//);
    await run();
    assert.equal(await readFile(join(work, 'dist/index.html'), 'utf8'), html);
    assert.equal(await readFile(join(work, 'dist/assets/main.css'), 'utf8'), css);
    assert.equal(await readFile(join(work, 'dist/assets/app.js'), 'utf8'), js);
    await readFile(join(work, 'dist/.nojekyll'));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('Pages preparation fails if an entry resource is missing', async () => {
  const work = await mkdtemp(join(tmpdir(), 'kingdom-pages-missing-'));
  try {
    await mkdir(join(work, 'dist'), { recursive: true });
    await writeFile(join(work, 'dist/index.html'), '<script src="/kingdom/assets/not-found.js"></script>');
    await assert.rejects(
      () => execFileAsync(process.execPath, [script], {
        cwd: work, env: { ...process.env, GITHUB_PAGES_BASE: '/kingdom/' }
      }),
      /Missing GitHub Pages entry asset/
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
