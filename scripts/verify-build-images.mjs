import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import sharp from 'sharp';

const root = join(process.cwd(), 'public', 'assets');
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
const images = (await files(root)).filter(path => /\.png$/i.test(path));
const failures = [];
let sourceBytes = 0, outputBytes = 0;
for (let index = 0; index < images.length; index += 4) {
  await Promise.all(images.slice(index, index + 4).map(async source => {
    const name = relative(root, source), output = join(process.cwd(), 'dist', 'assets', name.replace(/\.png$/i, '.webp'));
    const original = await readFile(source), optimized = await readFile(output);
    sourceBytes += original.length; outputBytes += optimized.length;
    const [a, b] = await Promise.all([original, optimized].map(bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels || !a.data.equals(b.data)) failures.push(name);
  }));
}
const report = { images: images.length, sourceBytes, outputBytes, failures,
  measurement: 'Every published PNG decoded to RGBA and compared byte-for-byte with its lossless WebP build output.' };
await mkdir('reports/optimization', { recursive: true });
await writeFile(join('reports', 'optimization', 'image-fidelity.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
