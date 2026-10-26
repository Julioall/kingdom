import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createMusicAudio, musicGainAtZoom, MUSIC_FILES } from '../src/ui/music-audio.js';
import { createGameAudio } from '../src/ui/game-audio.js';

function harness(playBehavior) {
  const elements = [], gains = [], sources = [], errors = [];
  let level = .5;
  class Audio {
    paused = true; currentTime = 0; playbackRate = 1; events = {}; calls = 0;
    constructor() { elements.push(this); }
    async play() {
      this.calls++;
      if (playBehavior) await playBehavior(this);
      this.paused = false;
    }
    pause() { this.paused = true; }
    addEventListener(name, listener) { this.events[name] = listener; }
  }
  const context = { currentTime: 0,
    createGain() {
      const node = { gain: { value: 0, targets: [], setTargetAtTime(value) { this.targets.push(value); } },
        connect(destination) { this.destination = destination; } };
      gains.push(node);
      return node;
    },
    createMediaElementSource(element) {
      const source = { element, connect(destination) { this.destination = destination; } };
      sources.push(source);
      return source;
    },
    decodeAudioData() { throw new Error('Long music must stream rather than decode an entire AudioBuffer'); },
  };
  const destination = {};
  const music = createMusicAudio({ getGain: () => level, AudioClass: Audio, onError: error => errors.push(error) });
  return { music, Audio, context, destination, elements, gains, sources, errors, setLevel(value) { level = value; } };
}

test('music decreases smoothly from 50% at the highest altitude to 30% at maximum zoom', () => {
  assert.equal(musicGainAtZoom(.5), .5);
  assert.equal(musicGainAtZoom(16), .3);
  let previous = .5;
  for (const zoom of [.1, .5, .75, 1, 2, 4, 8, 16, 32]) {
    const gain = musicGainAtZoom(zoom);
    assert.ok(gain >= .3 && gain <= .5 && gain <= previous);
    previous = gain;
  }
});

test('music streams through the master bus, changes volume without restarting, and resumes its position', async () => {
  const h = harness();
  assert.equal(await h.music.start(h.context, h.destination), true);
  assert.equal(h.elements.length, 1);
  const element = h.elements[0];
  assert.equal(element.src, MUSIC_FILES[0]);
  assert.equal(element.loop, true);
  assert.equal(element.preload, 'metadata');
  assert.equal(h.sources[0].destination, h.gains[0]);
  assert.equal(h.gains[0].destination, h.destination);
  assert.equal(h.gains[0].gain.targets.at(-1), .5);
  element.currentTime = 37;
  h.setLevel(.3);
  h.music.refresh();
  assert.equal(h.gains[0].gain.targets.at(-1), .3);
  assert.equal(element.calls, 1);
  h.music.pause();
  assert.equal(element.paused, true);
  await h.music.start(h.context, h.destination);
  assert.equal(element.currentTime, 37);
  assert.equal(element.playbackRate, 1);
  assert.equal(h.elements.length, 1);
  assert.equal(h.sources.length, 1);
});

test('autoplay rejection can be retried on the next gesture without duplicating the player', async () => {
  const h = harness(element => {
    if (element.calls === 1) throw Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' });
  });
  assert.equal(await h.music.start(h.context, h.destination), false);
  assert.equal(h.music.needsActivation, true);
  assert.equal(await h.music.start(h.context, h.destination), true);
  assert.equal(h.music.needsActivation, false);
  assert.equal(h.elements.length, 1);
});

test('unsupported OGG falls back to MP3 while retaining the same audio source', async () => {
  const h = harness(element => {
    if (element.src.endsWith('.ogg')) throw Object.assign(new Error('Unsupported format'), { name: 'NotSupportedError' });
  });
  assert.equal(await h.music.start(h.context, h.destination), true);
  assert.equal(h.elements[0].src, MUSIC_FILES[1]);
  assert.equal(h.elements[0].calls, 2);
  assert.equal(h.sources.length, 1);
});

test('a late play completion cannot restart music after audio was disabled', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.music.start(h.context, h.destination);
  h.music.pause();
  finish();
  assert.equal(await pending, false);
  assert.equal(h.elements[0].paused, true);
});

test('repeated media errors stop retrying automatically after both formats fail', async () => {
  const h = harness(() => { throw new Error('Network failure'); });
  assert.equal(await h.music.start(h.context, h.destination), false);
  assert.equal(h.elements[0].calls, 2);
  assert.equal(h.errors.length, 1);
  h.elements[0].events.error();
  assert.equal(h.elements[0].calls, 2);
  assert.equal(h.music.needsActivation, true);
});

test('both music formats exist in the music folder', async () => {
  for (const path of MUSIC_FILES) await access(new URL('../public' + path, import.meta.url));
});

test('the game starts music after audio unlock and its general controls pause, resume and scale the music', async () => {
  const h = harness();
  let level = .5;
  h.context.state = 'suspended';
  h.context.destination = {};
  h.context.resume = async () => { h.context.state = 'running'; };
  const audio = createGameAudio({
    AudioContextClass: class { constructor() { return h.context; } },
    MusicAudioClass: h.Audio,
    getMusicGain: () => level,
    storage: { getItem() { return null; }, setItem() {} },
    fetchImpl: async () => ({ ok: true, json: async () => ({ sounds: [], events: {} }) }),
  });
  assert.equal(h.elements.length, 0);
  await audio.unlock();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements[0].paused, false);
  const musicGain = h.sources[0].destination;
  const musicChannel = musicGain.destination;
  assert.equal(musicChannel.destination, h.gains[0]);
  assert.equal(musicGain.gain.targets.at(-1), .5);
  level = .3;
  audio.refreshAmbience();
  assert.equal(musicGain.gain.targets.at(-1), .3);
  audio.setEffectsVolume(.1);
  assert.equal(audio.effectsVolume, .1);
  assert.equal(audio.musicVolume, .65);
  assert.equal(musicChannel.gain.value, .65);
  audio.setMusicVolume(0);
  assert.equal(h.elements[0].paused, true);
  assert.equal(audio.effectsVolume, .1);
  audio.setMusicVolume(.4);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements[0].paused, false);
  assert.equal(musicChannel.gain.targets.at(-1), .4);
  h.elements[0].currentTime = 42;
  audio.setEnabled(false);
  assert.equal(h.elements[0].paused, true);
  assert.equal(h.gains[0].gain.targets.at(-1), 0);
  audio.setEnabled(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements[0].paused, false);
  assert.equal(h.elements[0].currentTime, 42);
  assert.equal(audio.musicVolume, .4);
  assert.equal(audio.effectsVolume, .1);
  audio.setVolume(.2);
  assert.equal(musicChannel.gain.targets.at(-1), .2);
  assert.equal(h.gains[0].gain.targets.at(-1), 1);
  assert.equal(h.elements.length, 1);
});

test('separate music and effects preferences survive master mute and reload and migrate the old volume', () => {
  const values = new Map([['kingdom-sfx-volume-v1', '.4']]);
  const storage = { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
  const first = createGameAudio({ storage });
  assert.equal(first.effectsVolume, .4);
  assert.equal(first.musicVolume, .4);
  first.setMusicVolume(.2);
  first.setEffectsVolume(.8);
  first.setEnabled(false);
  const restored = createGameAudio({ storage });
  assert.equal(restored.enabled, false);
  assert.equal(restored.musicVolume, .2);
  assert.equal(restored.effectsVolume, .8);
});
