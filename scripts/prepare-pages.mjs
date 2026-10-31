import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const outputDir = resolve('dist');
const base = process.env.GITHUB_PAGES_BASE || '/kingdom/';

if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base) || base === '/') {
  throw new Error('GITHUB_PAGES_BASE must be a repository path such as /kingdom/.');
}

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
  // Vite handles imported resources. These are runtime string paths for
  // public/ assets, which Vite intentionally leaves untouched in JavaScript.
  // Replacement is idempotent: /kingdom/assets/ does not contain /assets/.
  const updated = original.replaceAll('/assets/', base + 'assets/');
  if (updated !== original) {
    await writeFile(file, updated);
    changed++;
  }
  // Avoid uploading a build with root-only asset URLs on project Pages.
  if (/(^|[^A-Za-z0-9/])\/assets\//.test(updated)) {
    throw new Error('Unprefixed asset URL in ' + relative(outputDir, file));
  }
}

await writeFile(join(outputDir, '.nojekyll'), '');
console.log('GitHub Pages base: ' + base + '; files patched: ' + changed);
