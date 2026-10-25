import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const manifestPath = path.join(root, 'src/ui/animation-manifest.js');
const publicRoot = path.join(root, 'public');
const entries = [];
const staticSources = [];
const slug = value => value.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_ ]+/g, '-').toLowerCase();

function add(source, settings) {
  const bytes = fs.readFileSync(path.join(root, source));
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const { frameWidth = height, frameHeight = height, ...rest } = settings;
  if (width % frameWidth || height !== frameHeight) throw new Error('Invalid strip dimensions: ' + source);
  const frames = width / frameWidth;
  const entry = { ...rest, source, width, height, frameWidth, frameHeight, frames };
  entry.fps ??= frames > 1 ? 10 : 0;
  entry.loop ??= frames > 1;
  entry.anchor ??= { x: frameWidth / 2, y: frameHeight / 2 };
  const target = path.join(publicRoot, entry.url);
  if (!fs.existsSync(target)) {
    if (check) throw new Error('Missing published animation: ' + entry.url);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, source), target);
  }
  const published = fs.readFileSync(target);
  if (published.readUInt32BE(16) !== width || published.readUInt32BE(20) !== height) {
    throw new Error('Published animation dimensions differ: ' + entry.url);
  }
  entries.push(entry);
}

function mapSource(source) {
  const file = path.posix.basename(source, '.png');
  const unitMatch = source.match(/^Tiny Swords\/Units\/(\w+) Units\/(\w+)\//);
  if (unitMatch) {
    const palette = unitMatch[1].toLowerCase(), unit = unitMatch[2].toLowerCase();
    let action = file.replace(new RegExp('^' + unitMatch[2] + '_'), '');
    action = slug(action);
    if (unit === 'lancer' && /-(attack|defence)$/.test(action)) {
      const [, direction, kind] = action.match(/^(.*)-(attack|defence)$/);
      action = (kind === 'attack' ? 'attack-' : 'defend-') + direction;
    }
    if (unit === 'warrior') action = ({ attack1: 'attack', attack2: 'attack-2', guard: 'defend' })[action] || action;
    if (unit === 'archer' && action === 'shoot') action = 'attack';
    const category = action === 'arrow' ? 'projectile' : action === 'heal-effect' ? 'effect' : 'unit';
    const frameWidth = unit === 'lancer' ? 320 : action === 'arrow' ? 64 : 192;
    const url = unit === 'pawn'
      ? `assets/tiny-swords/people/${palette}/pawn_${action}.png`
      : `assets/tiny-swords/military/${palette}/${unitMatch[2]}/${file}.png`;
    add(source, { id: `unit.${palette}.${unit}.${action}`, category, unit, palette, action, url, frameWidth,
      loop: !/^(attack|interact|heal)/.test(action) && action !== 'arrow',
      anchor: { x: frameWidth / 2, y: unit === 'lancer' ? 199 : action === 'arrow' ? 32 : 135 } });
    return;
  }
  if (source.startsWith('public/assets/tiny-swords/source-pack/Particle FX/')) {
    const action = slug(file);
    const size = /Explosion|Splash/.test(file) ? 192 : 64;
    add(source, { id: 'effect.' + action, category: 'effect', action, frameWidth: size,
      url: source.slice('public/'.length), loop: /^Fire/.test(file) });
    return;
  }
  let match;
  if ((match = file.match(/^Tree([1-4])$/))) {
    const variant = Number(match[1]);
    add(source, { id: `nature.tree-${variant}`, category: 'nature', action: 'sway', variant,
      url: `assets/tiny-swords/trees/tree-${variant}.png`, frameWidth: 192,
      anchor: { x: 96, y: [0, 241, 249, 170, 168][variant] } });
  } else if ((match = file.match(/^Bushe([1-4])$/))) {
    add(source, { id: 'nature.bush-' + match[1], category: 'nature', action: 'sway', variant: Number(match[1]),
      url: 'assets/tiny-swords/bushes/bush-' + match[1] + '.png', fps: 1000 / 180, anchor: { x: 64, y: 79 } });
  } else if ((match = file.match(/^Sheep_(Idle|Move|Grass)$/))) {
    const action = match[1].toLowerCase();
    add(source, { id: 'animal.sheep.' + action, category: 'animal', unit: 'sheep', action,
      url: 'assets/tiny-swords/sheep/sheep_' + action + '.png', fps: 1000 / (action === 'grass' ? 145 : 180),
      anchor: { x: 64, y: 84 } });
  } else if ((match = file.match(/^Water Rocks_(\d+)$/))) {
    add(source, { id: 'nature.water-rocks-' + match[1], category: 'nature', action: 'water', frameWidth: 64,
      url: 'assets/tiny-swords/animations/nature/water-rocks-' + match[1] + '.png' });
  } else if (file === 'Rubber duck') {
    add(source, { id: 'nature.rubber-duck', category: 'nature', action: 'float', frameWidth: 32,
      url: 'assets/tiny-swords/animations/nature/rubber-duck.png' });
  } else if (file.endsWith('_Highlight')) {
    const action = slug(file);
    add(source, { id: 'resource.' + action, category: 'resource', action: 'highlight', frameWidth: 128,
      url: 'assets/tiny-swords/animations/resources/' + action + '.png' });
  } else if (file === 'Water Foam') {
    add(source, { id: 'nature.water-foam', category: 'nature', action: 'foam', frameWidth: 192,
      url: 'assets/tiny-swords/terrain/water-foam.png', fps: 1000 / 110 });
  } else {
    // UI atlases, tilesets, clouds, buildings and standalone props are static,
    // even when their width exceeds their height. Never infer frames from ratio.
    staticSources.push(source);
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const source = directory + '/' + entry.name;
    if (entry.isDirectory()) walk(source);
    else if (entry.name.endsWith('.png')) mapSource(source);
  }
}

walk('Tiny Swords');
walk('public/assets/tiny-swords/source-pack');
entries.sort((a, b) => a.id.localeCompare(b.id, 'en'));
if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate animation ID');
const output = '// Generated by npm run assets:map. Do not edit manually.\nexport default '
  + JSON.stringify({ version: 1, entries, staticSources: staticSources.sort() }, null, 2) + ';\n';
if (check) {
  if (fs.readFileSync(manifestPath, 'utf8') !== output) throw new Error('Animation manifest is stale; run npm run assets:map');
} else fs.writeFileSync(manifestPath, output);
const animated = entries.filter(entry => entry.frames > 1).length;
console.log(`${check ? 'Verified' : 'Mapped'} ${animated} animated sheets and ${entries.length - animated} projectiles; ${staticSources.length} static PNGs classified separately.`);
