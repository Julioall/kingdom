import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const outputDir = resolve('dist');
const base = process.env.GITHUB_PAGES_BASE || '/kingdom/';

if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base) || base === '/') {
  throw new Error('GITHUB_PAGES_BASE must be a repository path such as /kingdom/.');
}

// Vite already prefixes its own emitted HTML/CSS/JS bundle URLs with base.
// Rewrite only root-relative public/ URLs, not already-prefixed /kingdom/assets/ URLs.
// The character before /assets/ must not be part of another URL path segment.
const rootAssets = /(^|[^A-Za-z0-9_./~-])\/assets\//g;
const doubledPrefix = base + base.slice(1) + 'assets/';

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = await Promise.all(entries.map(async entry => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(file) : [file];
  }));
  return results.flat();
}

let changed = 0;
const files = await listFiles(outputDir);
for (const file of files) {
  if (!['.html', '.js', '.css'].includes(extname(file).toLowerCase())) continue;
  const original = await readFile(file, 'utf8');
  const updated = original.replace(rootAssets, (_match, prefix) => prefix + base + 'assets/');
  if (updated.includes(doubledPrefix)) {
    throw new Error('Duplicated GitHub Pages asset prefix in ' + relative(outputDir, file));
  }
  if (/(^|[^A-Za-z0-9_./~-])\/assets\//.test(updated)) {
    throw new Error('Root-relative asset URL in ' + relative(outputDir, file));
  }
  if (updated !== original) {
    await writeFile(file, updated);
    changed++;
  }
}

// Validate that the entry page's referenced local scripts, styles and images exist.
// This catches missing logo/style/bundle files before a broken page is published.
const html = await readFile(join(outputDir, 'index.html'), 'utf8');
for (const match of html.matchAll(/\b(?:src|href|srcset)="([^"]+)"/g)) {
  const urls = match[1].split(',').map(item => item.trim().split(/\s+/)[0]);
  for (const url of urls) {
    if (!url.startsWith(base)) continue;
    const assetPath = url.split(/[?#]/)[0].slice(base.length);
    try {
      await access(join(outputDir, assetPath));
    } catch {
      throw new Error('Missing GitHub Pages entry asset: ' + url);
    }
  }
}

await writeFile(join(outputDir, '.nojekyll'), '');
console.log('GitHub Pages base: ' + base + '; files patched: ' + changed);
