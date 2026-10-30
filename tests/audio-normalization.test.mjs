import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGameAudio } from '../src/ui/game-audio.js';

function harness(failOgg = false) {
  const sound = { id: 'impact', files: { ogg: 'impact.ogg', mp3: 'impact.mp3' },
    normalization: { formats: { ogg: { gain_db: -12 }, mp3: { gain_db: -6 } } } };
  const manifest = { sounds: [sound], events: { test_impact: [sound.id] } };
  const contexts = [], requests = [];
  let distance = .5;
  const parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  class Context {
    state = 'suspended'; currentTime = 0; destination = {}; gains = []; compressors = []; sources = [];
    constructor() { contexts.push(this); }
    async resume() { this.state = 'running'; }
    createGain() {
      const node = { gain: parameter(), connect(destination) { this.destination = destination; }, disconnect() {} };
      this.gains.push(node);
      return node;
    }
    createDynamicsCompressor() {
      const node = { threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(),
        connect(destination) { this.destination = destination; } };
      this.compressors.push(node);
      return node;
    }
    createBufferSource() {
      const source = { playbackRate: parameter(), connect(destination) { this.destination = destination; }, disconnect() {}, start() {} };
      this.sources.push(source);
      return source;
    }
    async decodeAudioData(bytes) {
      if (failOgg && new Uint8Array(bytes)[0] === 1) throw new Error('OGG unavailable');
      return {};
    }
  }
  const audio = createGameAudio({ AudioContextClass: Context, getDistanceGain: () => distance,
    storage: { getItem() { return null; }, setItem() {} },
    fetchImpl: async path => {
      requests.push(path);
      return { ok: true, json: async () => manifest,
        arrayBuffer: async () => new Uint8Array([path.endsWith('.ogg') ? 1 : 2]).buffer };
    } });
  return { audio, contexts, requests, setDistance(value) { distance = value; } };
}

test('per-format loudness compensation survives distance updates and is not applied twice to cached buffers', async () => {
  const h = harness();
  await h.audio.play('test_impact', 'first', { x: 1, y: 2 });
  const context = h.contexts[0];
  const normalizedBase = .85 * 10 ** (-12 / 20);
  const firstGain = context.sources[0].destination;
  const effectsBus = firstGain.destination;
  assert.ok(Math.abs(firstGain.gain.value - normalizedBase * .5) < 1e-9);
  assert.ok(Math.abs(effectsBus.gain.value - 10 ** (12 / 20)) < 1e-9);
  assert.equal(effectsBus.destination.destination, context.gains[0]);
  h.setDistance(.2);
  h.audio.update(100, 1, true);
  assert.ok(Math.abs(firstGain.gain.value - normalizedBase * .2) < 1e-9);
  await h.audio.play('test_impact', 'second', { x: 1, y: 2 });
  assert.ok(Math.abs(context.sources[1].destination.gain.value - normalizedBase * .2) < 1e-9);
  assert.equal(h.requests.filter(path => path.endsWith('.ogg')).length, 1);
  h.audio.setVolume(.3);
  assert.equal(effectsBus.destination.gain.value, .3);
  assert.equal(context.gains[0].gain.value, 1);
  assert.equal(context.gains[0].destination, context.compressors[0]);
  assert.equal(context.compressors[0].destination, context.destination);
  assert.equal(context.compressors[0].threshold.value, -3);
});

test('MP3 fallback uses the MP3 measurement instead of the OGG correction', async () => {
  const h = harness(true);
  await h.audio.play('test_impact', 'fallback', { x: 1, y: 2 });
  assert.ok(h.requests.some(path => path.endsWith('.mp3')));
  assert.ok(Math.abs(h.contexts[0].sources[0].destination.gain.value - .85 * .5 * 10 ** (-6 / 20)) < 1e-9);
});

test('all effects have finite measured corrections within peak and amplification limits; wind keeps its own mix', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/assets/sfx/manifest.json', import.meta.url), 'utf8'));
  let checked = 0;
  for (const sound of manifest.sounds) {
    if (sound.trigger === 'wind_ambience') {
      assert.equal(sound.normalization, undefined);
      continue;
    }
    for (const format of Object.keys(sound.files)) {
      const data = sound.normalization?.formats?.[format];
      assert.ok(data && Number.isFinite(data.gain_db), `${sound.id}:${format} has no correction`);
      assert.ok(data.gain_db <= 14);
      assert.ok(data.input_true_peak_dbtp + data.gain_db <= -2 + .001);
      assert.ok(data.input_lufs + data.gain_db <= -24 + .001);
      checked++;
    }
  }
  assert.equal(checked, 133);
});
