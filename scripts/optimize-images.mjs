import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';

const outputDir = resolve(process.argv[2] ?? 'dist');
const assetsDir = join(outputDir, 'assets');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async entry => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  }));
  return nestedFiles.flat();
}

function replaceAssetReference(value, imagePaths, imageBasenames) {
  const pngIndex = value.toLowerCase().lastIndexOf('.png');
  if (pngIndex < 0) return value;

  const pathEnd = pngIndex + 4;
  const suffix = value.slice(pathEnd);
  if (suffix && !suffix.startsWith('?') && !suffix.startsWith('#')) return value;

  const assetIndex = value.lastIndexOf('assets/', pngIndex);
  if (assetIndex >= 0) {
    const assetPath = value.slice(assetIndex + 'assets/'.length, pathEnd).replaceAll('\\', '/');
    if (imagePaths.has(assetPath)) return `${value.slice(0, pngIndex)}.webp${suffix}`;
  }

  const fileName = value.slice(0, pathEnd);
  if (!fileName.includes('/') && imageBasenames.has(fileName)) {
    return `${fileName.slice(0, -4)}.webp${suffix}`;
  }

  return value;
}

function rewriteStringLiterals(source, imagePaths, imageBasenames) {
  return source.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, literal => {
    const quote = literal[0];
    const value = literal.slice(1, -1);
    const replacement = replaceAssetReference(value, imagePaths, imageBasenames);
    return replacement === value ? literal : `${quote}${replacement}${quote}`;
  });
}

function rewriteAssetPaths(source, imagePaths) {
  let rewritten = source;
  for (const imagePath of imagePaths) {
    const originalPath = `assets/${imagePath}`;
    const webpPath = `assets/${imagePath.slice(0, -4)}.webp`;
    rewritten = rewritten.replaceAll(originalPath, webpPath);
  }
  return rewritten;
}

function assertNoPngAssetReferences(source, imagePaths, file) {
  for (const imagePath of imagePaths) {
    const originalPath = `assets/${imagePath}`;
    if (source.includes(originalPath)) {
      throw new Error(`Unconverted PNG asset reference in ${file}: ${originalPath}`);
    }
  }
  if (/`\/?assets\/[^`]*\$\{[^`]*\.png`/i.test(source)) {
    throw new Error(`Unconverted dynamic PNG asset reference in ${file}.`);
  }
}

async function processInBatches(files, batchSize, processFile) {
  for (let index = 0; index < files.length; index += batchSize) {
    await Promise.all(files.slice(index, index + batchSize).map(processFile));
  }
}

function isAnimatedPng(bytes) {
  if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return false;

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString('ascii', offset + 4, offset + 8);
    if (chunkType === 'acTL') return true;
    if (chunkType === 'IEND') return false;
    offset += chunkLength + 12;
  }
  return false;
}

const allFiles = await listFiles(assetsDir);
const pngFiles = allFiles.filter(file => extname(file).toLowerCase() === '.png');

if (pngFiles.length === 0) {
  console.log('Image optimization: no PNG assets found in the build output.');
  process.exit(0);
}

const imagePaths = new Set(pngFiles.map(file => relative(assetsDir, file).split(sep).join('/')));
const imageBasenames = new Set(pngFiles.map(file => basename(file)));
let originalBytes = 0;
let optimizedBytes = 0;

await processInBatches(pngFiles, 4, async pngPath => {
  const webpPath = pngPath.slice(0, -4) + '.webp';
  const imageBytes = await readFile(pngPath);
  const image = sharp(imageBytes, isAnimatedPng(imageBytes) ? { animated: true } : undefined)
    .keepMetadata()
    .webp({ lossless: true, effort: 6, exact: true });
  const output = await image.toBuffer();

  await writeFile(webpPath, output);
  await rm(pngPath);
  originalBytes += imageBytes.byteLength;
  optimizedBytes += output.byteLength;
});

const publishedFiles = await listFiles(outputDir);
const textFiles = publishedFiles.filter(file => ['.html', '.js', '.css'].includes(extname(file).toLowerCase()));
await Promise.all(textFiles.map(async file => {
  const source = await readFile(file, 'utf8');
  const rewritten = rewriteAssetPaths(
    rewriteStringLiterals(source, imagePaths, imageBasenames),
    imagePaths,
  );
  assertNoPngAssetReferences(rewritten, imagePaths, relative(outputDir, file));
  if (rewritten !== source) await writeFile(file, rewritten);
}));

const savedBytes = originalBytes - optimizedBytes;
const savedPercent = originalBytes === 0 ? 0 : (savedBytes / originalBytes) * 100;
console.log(`Image optimization: ${pngFiles.length} PNGs converted to lossless WebP.`);
console.log(`Assets: ${(originalBytes / 1024 / 1024).toFixed(2)} MiB → ${(optimizedBytes / 1024 / 1024).toFixed(2)} MiB (${savedPercent.toFixed(1)}% smaller).`);
