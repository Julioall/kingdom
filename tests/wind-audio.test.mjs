import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createGameAudio, windGainAtZoom } from '../src/ui/game-audio.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const sound = { id: 'effect_wind_ambience_01', loop_start_seconds: 2,
  files: { mp3: 'ambience/wind/effect_wind_ambience_01.mp3' } };
const manifest = { events: { wind_ambience: [sound.id] }, sounds: [sound] };

function harness(decode = async () => ({ duration: 60 }), includeEffects = false, options = {}) {
  const contexts = [], requests = [];
  const testManifest = includeEffects ? {
    events: { ...manifest.events, hammer_build: ['hammer'] },
    sounds: [...manifest.sounds, { id: 'hammer', files: { mp3: 'hammer.mp3' }, normalization: { formats: { mp3: { gain_db: -12 } } } }],
  } : manifest;
  class Parameter {
    value = 1;
    targets = [];
    setTargetAtTime(value) { this.targets.push(value); this.value = value; }
  }
  class Context {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    gains = [];
    sources = [];
    constructor() { contexts.push(this); }
    addEventListener(type, listener) { if (type === 'statechange') this.stateListener = listener; }
    emitState(state) { this.state = state; this.stateListener?.(); }
    async resume() { this.emitState('running'); }
    createGain() {
      const gain = { gain: new Parameter(), connect(destination) { this.destination = destination; }, disconnect() {} };
      this.gains.push(gain);
      return gain;
    }
    createBufferSource() {
      const source = { playbackRate: new Parameter(), connect(destination) { this.destination = destination; }, disconnect() {},
        start(when, offset) { this.started = true; this.offset = offset; }, stop() { this.stopped = true; this.onended?.(); } };
      this.sources.push(source);
      return source;
    }
    decodeAudioData(bytes) { return decode(bytes); }
  }
  let level = .7;
  const audio = createGameAudio({
    AudioContextClass: Context,
    getWindGain: () => level,
    getDistanceGain: () => .1,
    storage: { getItem() { return null; }, setItem() {} },
    fetchImpl: async path => {
      requests.push(path);
      if (path.endsWith('.mp3') && options.failedLoads > 0) {
        options.failedLoads--;
        throw new Error('Temporary network failure');
      }
      return { ok: true, json: async () => testManifest, arrayBuffer: async () => new ArrayBuffer(4) };
    },
  });
  return { audio, contexts, requests, Context, setLevel(value) { level = value; } };
}

test('wind gain stays between 10% and 70% and decreases monotonically as the camera approaches', () => {
  assert.equal(windGainAtZoom(.5), .7);
  assert.equal(windGainAtZoom(16), .1);
  let previous = .7;
  for (const zoom of [.1, .5, .75, 1, 2, 4, 8, 16, 32]) {
    const gain = windGainAtZoom(zoom);
    assert.ok(gain >= .1 && gain <= .7);
    assert.ok(gain <= previous);
    previous = gain;
  }
});

test('wind starts at 50% without a zoom detour, skips the quiet intro and updates directly with the camera', async () => {
  const h = harness();
  await h.audio.unlock();
  await flush();
  assert.equal(h.audio.ready, true);
  const source = h.contexts[0].sources[0];
  assert.equal(source.offset, 2);
  assert.equal(source.loopStart, 2);
  assert.equal(source.destination.gain.targets.at(-1), .7);
  h.setLevel(.1);
  h.audio.refreshAmbience();
  assert.equal(source.destination.gain.targets.at(-1), .1);
  h.setLevel(.7);
  h.audio.refreshAmbience();
  assert.equal(source.destination.gain.targets.at(-1), .7);
  assert.equal(h.contexts[0].sources.length, 1);
});

test('a second gesture retries a pending resume and starts one wind loop', async () => {
  const h = harness();
  h.Context.prototype.resume = function () {
    this.resumeCalls = (this.resumeCalls || 0) + 1;
    if (this.resumeCalls === 1) return new Promise(resolve => { this.finishFirstResume = resolve; });
    this.emitState('running');
    this.finishFirstResume();
    return Promise.resolve();
  };
  const firstAttempt = h.audio.unlock();
  assert.equal(h.audio.ready, false);
  await Promise.all([firstAttempt, h.audio.unlock()]);
  await flush();
  assert.equal(h.contexts.length, 1);
  assert.equal(h.contexts[0].resumeCalls, 2);
  assert.equal(h.audio.ready, true);
  assert.equal(h.contexts[0].sources.length, 1);
});

test('a rejected initial activation can be retried and resuming reapplies the current wind level', async () => {
  const h = harness();
  let attempts = 0;
  h.Context.prototype.resume = async function () {
    if (++attempts === 1) throw new Error('Activation required');
    this.emitState('running');
  };
  assert.equal(await h.audio.unlock(), false);
  assert.equal(h.audio.ready, false);
  assert.equal(await h.audio.unlock(), true);
  await flush();
  const context = h.contexts[0];
  context.emitState('suspended');
  assert.equal(h.audio.ready, false);
  h.setLevel(.1);
  context.emitState('running');
  assert.equal(context.sources[0].destination.gain.targets.at(-1), .1);
  assert.equal(context.sources.length, 1);
});

test('wind uses the current 50% zoom level when asynchronous loading finishes', async () => {
  let finishDecode;
  const h = harness(() => new Promise(resolve => { finishDecode = resolve; }));
  h.setLevel(.1);
  await h.audio.unlock();
  await flush();
  h.setLevel(.7);
  h.audio.refreshAmbience();
  finishDecode({ duration: 60 });
  await flush();
  assert.equal(h.contexts[0].sources[0].destination.gain.targets.at(-1), .7);
});

test('a temporary wind load failure is retried with backoff without another zoom action', async t => {
  t.mock.method(console, 'warn', () => {});
  const h = harness(undefined, false, { failedLoads: 1 });
  await h.audio.unlock();
  await flush();
  const context = h.contexts[0];
  assert.equal(context.sources.length, 0);
  context.currentTime = 1;
  h.audio.update(1000);
  await flush();
  assert.equal(h.requests.filter(path => path.endsWith('.mp3')).length, 1);
  context.currentTime = 2.1;
  h.audio.update(2100);
  await flush();
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].destination.gain.targets.at(-1), .7);
});

test('one wind loop follows zoom while paused, respects master volume and does not follow simulation speed', async () => {
  const h = harness();
  h.audio.update(0);
  assert.equal(h.contexts.length, 0, 'audio must wait for a user gesture');
  await h.audio.unlock();
  await flush();
  const context = h.contexts[0];
  assert.equal(context.sources.length, 1);
  const source = context.sources[0];
  assert.equal(source.loop, true);
  assert.equal(source.started, true);
  assert.equal(source.destination.gain.targets.at(-1), .7);
  h.setLevel(.1);
  h.audio.update(1000, 4, true);
  assert.equal(source.destination.gain.targets.at(-1), .1);
  assert.equal(source.playbackRate.value, 1);
  h.audio.setVolume(.3);
  assert.equal(source.destination.destination.gain.targets.at(-1), .3);
  assert.equal(context.gains[0].gain.value, 1);
  for (let i = 0; i < 10; i++) h.audio.update(2000 + i);
  await h.audio.unlock();
  await flush();
  assert.equal(context.sources.length, 1);
  assert.equal(h.requests.filter(path => path.endsWith('.mp3')).length, 1);
  h.audio.setEnabled(false);
  assert.equal(source.stopped, true);
  assert.equal(context.gains[0].gain.targets.at(-1), 0);
  h.audio.setEnabled(true);
  await flush();
  assert.equal(context.sources.length, 2);
  assert.equal(h.requests.filter(path => path.endsWith('.mp3')).length, 1, 'reuse the decoded recording');
});

test('muting during loading prevents late playback; re-enabling starts only one loop', async () => {
  let finishDecode;
  const h = harness(() => new Promise(resolve => { finishDecode = resolve; }));
  await h.audio.unlock();
  await flush();
  h.audio.setEnabled(false);
  finishDecode({ duration: 60 });
  await flush();
  assert.equal(h.contexts[0].sources.length, 0);
  h.audio.setEnabled(true);
  await flush();
  assert.equal(h.contexts[0].sources.length, 1);
});

test('a scheduled construction effect plays alongside wind and wind recovers after the effect ends', async () => {
  const h = harness(undefined, true);
  await h.audio.unlock();
  await flush();
  const world = { day: 0, people: [], animals: [], structures: [], campaigns: [], combatEvents: [] };
  h.audio.observe(world, 0, true);
  h.audio.observe({ ...world, day: 1, people: [{ id: 1, alive: true,
    visualActivity: { day: 1, kind: 'build', x: 5, y: 5 } }] }, 1000);
  h.audio.update(2000);
  await flush();
  const context = h.contexts[0];
  const wind = context.sources.find(source => source.loop);
  const effect = context.sources.find(source => !source.loop);
  assert.ok(effect?.started, 'the observed worker action must produce a real effect source');
  const effectGain = effect.destination;
  const effectsBus = effectGain.destination;
  assert.ok(effectGain.gain.value * effectsBus.gain.value > .04, '100% zoom attenuation must leave the normalized effect audible');
  assert.equal(wind.destination.destination, effectsBus.destination, 'wind shares the effects volume but bypasses the boost');
  assert.equal(wind.destination.destination.destination, context.gains[0]);
  h.audio.update(2010);
  assert.equal(wind.destination.gain.targets.at(-1), .7 * .45);
  h.setLevel(.1);
  h.audio.update(2020);
  assert.equal(wind.destination.gain.targets.at(-1), .1, 'ducking must respect the wind minimum');
  h.setLevel(.7);
  effect.onended();
  h.audio.update(2200);
  assert.equal(wind.destination.gain.targets.at(-1), .7);
});

test('the wind event points to the imported MP3 with both codec fallbacks in the active manifest', async () => {
  const root = new URL('../public/assets/audio/sfx/', import.meta.url);
  const library = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.deepEqual(library.events.wind_ambience, [sound.id]);
  const entry = library.sounds.find(item => item.id === sound.id);
  assert.equal(entry.files.mp3, sound.files.mp3);
  await access(new URL(entry.files.mp3, root));
  await access(new URL(entry.files.ogg, root));
});
