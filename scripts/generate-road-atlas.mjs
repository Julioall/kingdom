import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(__dirname, '../public/assets/kingdom-autotile/roads.png');
const tileSize = 64, atlasTiles = 32, atlasSize = tileSize * atlasTiles;
const directions = [
  { dx: 0, dy: -1, x: 32, y: 0 }, { dx: 1, dy: -1, x: 63, y: 0 },
  { dx: 1, dy: 0, x: 63, y: 32 }, { dx: 1, dy: 1, x: 63, y: 63 },
  { dx: 0, dy: 1, x: 32, y: 63 }, { dx: -1, dy: 1, x: 0, y: 63 },
  { dx: -1, dy: 0, x: 0, y: 32 }, { dx: -1, dy: -1, x: 0, y: 0 }
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTile(mask, variant) {
  const pixels = Buffer.alloc(tileSize * tileSize * 4);
  const segments = directions.flatMap((direction, index) => mask & (1 << index)
    ? [[32, 32, direction.x, direction.y]] : []);
  const isolated = segments.length === 0;
  if (isolated) segments.push([32, 32, 32, 32]);

  for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
    let nearest = Infinity;
    for (const [x1, y1, x2, y2] of segments) {
      const dx = x2 - x1, dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared)) : 0;
      const distance = Math.hypot(x - x1 - projection * dx, y - y1 - projection * dy);
      if (distance < nearest) nearest = distance;
    }
    if (isolated) nearest = Math.hypot((x - 32) * .9, y - 32);

    const index = (y * tileSize + x) * 4;
    const radius = isolated ? 8 : 13;
    if (nearest <= radius) pixels.set([67, 57, 41, 188], index);
    if (nearest <= radius * .7) pixels.set([126, 96, 58, 205], index);
  }

  const random = randomGenerator(mask * 977 + variant * 313 + 19);
  const fleckColors = [[199, 163, 103, 135], [89, 72, 46, 145], [163, 128, 76, 145]];
  for (let fleck = 0; fleck < 24; fleck++) {
    const x = 13 + Math.floor(random() * 38), y = 13 + Math.floor(random() * 38);
    const width = 1 + Math.floor(random() * 3), height = 1 + Math.floor(random() * 2);
    const color = fleckColors[Math.floor(random() * fleckColors.length)];
    for (let py = y; py < Math.min(tileSize, y + height); py++) for (let px = x; px < Math.min(tileSize, x + width); px++) {
      const index = (py * tileSize + px) * 4;
      if (pixels[index + 3] > 150) pixels.set(color, index);
    }
  }
  return pixels;
}

const tileCache = new Map();
const rows = [];
for (let y = 0; y < atlasSize; y++) {
  const row = Buffer.alloc(1 + atlasSize * 4);
  for (let tileX = 0; tileX < atlasTiles; tileX++) {
    const index = y * atlasSize + tileX * tileSize;
    const tileIndex = Math.floor(index / (tileSize * atlasSize)) * atlasTiles + tileX;
    const mask = Math.floor(tileIndex / 4), variant = tileIndex % 4;
    const tileRow = y % tileSize;
    const tilePixels = tileCache.get(mask + ':' + variant) || makeTile(mask, variant);
    tileCache.set(mask + ':' + variant, tilePixels);
    const sourceStart = tileRow * tileSize * 4;
    tilePixels.copy(row, 1 + tileX * tileSize * 4, sourceStart, sourceStart + tileSize * 4);
  }
  rows.push(row);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(atlasSize, 0);
header.writeUInt32BE(atlasSize, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))
]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, png);
console.log(`Generated ${output} (${atlasSize}×${atlasSize}, 256 connections × 4 texture variations).`);
