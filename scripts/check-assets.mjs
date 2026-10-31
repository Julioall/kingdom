import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import animationManifest from '../src/ui/animation-manifest.js';
import { uiAssetUrl } from '../src/ui/asset-paths.js';

const root = resolve('public/assets');
const catalog = JSON.parse(await readFile(resolve(root, 'catalog.json'), 'utf8'));
assert.equal(catalog.version, 1);
const registered = new Set();
const categories = {
  sprites: ['characters', 'animals', 'buildings', 'terrain', 'vegetation', 'resources', 'environment', 'decorations', 'effects'],
  ui: ['branding', 'buttons', 'cursors', 'frames', 'hud', 'icons', 'indicators', 'ribbons'],
  audio: ['music', 'sfx']
};
for (const group of Object.values(catalog.groups)) {
  await access(group.consumer);
  for (const name of group.files) {
    assert.ok(!registered.has(name), 'Duplicate registration: ' + name);
    const path = resolve(root, name);
    assert.ok(path.startsWith(root + sep), 'Asset outside library: ' + name);
    assert.match(name, /^(sprites|ui|audio)\//, 'Use a media/function folder: ' + name);
    const [kind, category] = name.split('/');
    assert.ok(categories[kind]?.includes(category), 'Unknown functional category: ' + name);
    assert.match(name, /\.(png|jpg|jpeg|webp|svg|avif|ogg|mp3|wav|m4a|flac|json)$/i,
      'Keep runtime code outside public media: ' + name);
    await access(path);
    registered.add(name);
    if (name.startsWith('ui/')) assert.equal(uiAssetUrl(name.split('/').at(-1)), '/assets/' + name);
  }
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const name = relative(root, path).replaceAll(sep, '/');
      assert.ok(name === 'catalog.json' || registered.has(name), 'Unregistered asset: ' + name);
    }
  }
}
await walk(root);
async function checkReferences(path) {
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/['"]\/?assets\/([^'"`\s]+)['"]/g)) {
    const name = match[1].split(/[?#]/)[0];
    const exact = /\.[a-z0-9]+$/i.test(name);
    assert.ok(exact ? registered.has(name) : [...registered].some(file => file.startsWith(name)),
      'Unknown asset reference in ' + path + ': ' + name);
  }
}
async function checkSource(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await checkSource(path);
    else if (/\.(js|ts|css)$/.test(entry.name)) await checkReferences(path);
  }
}
await checkSource(resolve('src'));
await checkReferences(resolve('index.html'));
for (const animation of animationManifest.entries) {
  const name = animation.url.replace(/^\/?assets\//, '');
  assert.ok(registered.has(name), 'Unregistered animation: ' + animation.id);
  const image = await readFile(resolve(root, name));
  assert.equal(image.toString('ascii', 1, 4), 'PNG', 'Invalid PNG: ' + name);
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  assert.ok(width >= animation.frameWidth * animation.frames && height >= animation.frameHeight,
    'Animation frames exceed sheet: ' + animation.id);
}
const audio = JSON.parse(await readFile(resolve(root, 'audio/sfx/manifest.json'), 'utf8'));
const sounds = new Map(audio.sounds.map(sound => [sound.id, sound]));
for (const [event, ids] of Object.entries(audio.events)) for (const id of ids)
  assert.ok(sounds.has(id), 'Unknown sound in ' + event + ': ' + id);
const audioFiles = new Set(audio.sounds.flatMap(sound => Object.values(sound.files)));
for (const name of audioFiles) assert.ok(registered.has('audio/sfx/' + name), 'Missing sound: ' + name);
for (const name of catalog.groups.sfx.files)
  assert.ok(audioFiles.has(name.replace('audio/sfx/', '')), 'Unreferenced sound: ' + name);
console.log('Assets validated: ' + registered.size + ' files; ' + animationManifest.entries.length
  + ' animation sheets; ' + sounds.size + ' sound definitions.');
