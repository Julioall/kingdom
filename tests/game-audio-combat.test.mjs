import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createGameAudio } from '../src/ui/game-audio.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const sourcePaths = {
  sword_slash: 'audio/mp3/combat/sword/effect_sword_slash_01.mp3',
  sword_swing_miss: 'audio/mp3/combat/sword/effect_sword_swing_miss_01.mp3',
  sword_armor_swing_hit: 'audio/mp3/combat/sword/effect_sword_armor_swing_hit_01.mp3',
  sword_armor_impact: 'audio/mp3/combat/sword/effect_sword_armor_impact_01.mp3',
  character_body_impact: 'audio/mp3/characters/impact/effect_character_body_impact_01.mp3',
  shield_impact: 'audio/mp3/combat/shield/effect_shield_impact_01.mp3',
  sword_clash: 'audio/mp3/combat/sword/effect_sword_clash_01.mp3',
  combat_grunt: 'audio/mp3/characters/grunts/effect_combat_grunt_01.mp3',
  war_call: 'audio/mp3/signals/horn/effect_war_horn_call_01.mp3',
  retreat_ordered: 'audio/mp3/signals/horn/effect_war_horn_retreat_01.mp3',
  war_horn: 'audio/mp3/combat/effect_war_horn_01.mp3',
};

function harness() {
  const contexts = [];
  const sounds = Object.entries(sourcePaths).map(([trigger, mp3], index) => ({
    id: 'sound-' + trigger,
    trigger,
    files: { mp3 },
  }));
  const events = Object.fromEntries(sounds.map(sound => [sound.trigger, [sound.id]]));
  const manifest = { events, sounds };
  class Context {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    sources = [];
    constructor() { contexts.push(this); }
    async resume() { this.state = 'running'; }
    createGain() {
      return {
        gain: { value: 1, setTargetAtTime(value) { this.value = value; } },
        connect(destination) { this.destination = destination; },
        disconnect() {},
      };
    }
    createBufferSource() {
      const source = {
        playbackRate: { value: 1 },
        connect(destination) { this.destination = destination; },
        disconnect() {},
        start(when) { this.started = true; this.startedAt = when; },
      };
      this.sources.push(source);
      return source;
    }
    async decodeAudioData(bytes) {
      return { path: new TextDecoder().decode(bytes) };
    }
  }
  const requests = [];
  const audio = createGameAudio({
    AudioContextClass: Context,
    storage: { getItem() { return null; }, setItem() {} },
    fetchImpl: async url => {
      requests.push(url);
      return {
        ok: true,
        json: async () => manifest,
        arrayBuffer: async () => {
          const bytes = new TextEncoder().encode(url);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      };
    },
  });
  return { audio, contexts, requests };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function eventWithGrunt(expected) {
  for (let id = 1; id < 100; id++) {
    if ((stableHash('combat:' + id + ':grunt-chance') % 5 === 0) === expected) return id;
  }
  throw new Error('could not find deterministic grunt fixture');
}

async function runCombatEvent(event, { updateAt = 1425 } = {}) {
  const h = harness();
  await h.audio.unlock();
  await flush();
  await flush();
  const world = {
    day: 1,
    people: [
      { id: 1, x: 0, y: 0, alive: true, role: 'soldier', militaryClass: 'guerreiro' },
      { id: 2, x: 2, y: 0, alive: true, role: event.targetRole || 'civilian',
        militaryClass: event.targetRole === 'soldier' ? 'guerreiro' : undefined },
    ],
    animals: [],
    structures: [],
    campaigns: [],
    combatEvents: [],
    combatSequence: 0,
  };
  h.audio.observe(world, 0, true);
  h.audio.observe({ ...world, combatEvents: [event] }, 1000);
  h.audio.update(updateAt, 1, false);
  await flush();
  return h;
}

function combatEvent(id, result, weapon = 'guerreiro', targetRole = 'civilian') {
  return {
    id,
    day: 1,
    weapon,
    targetId: 2,
    origin: { x: 0, y: 0 },
    aim: { x: 2, y: 0 },
    windupMs: 500,
    result: { atMs: 500, point: { x: 1, y: 0 }, ...result },
    targetRole,
  };
}

test('armored melee hit uses one combined whoosh-impact cue 180 ms before contact', async () => {
  const h = await runCombatEvent(combatEvent(eventWithGrunt(false),
    { kind: 'body', damageApplied: 20 }, 'guerreiro', 'soldier'), { updateAt: 1245 });
  const sources = h.contexts[0].sources;
  const armor = sources.find(source => source.buffer?.path?.includes('effect_sword_armor_swing_hit_'));
  assert.ok(armor, 'the combined armored impact should play');
  assert.equal(armor.buffer.path.includes('sword_armor_impact'), false);
  assert.equal(armor.startedAt, 0.075, 'the cue should start 180 ms before the 500 ms contact');
  assert.equal(armor.destination.gain.value, .98);
  assert.equal(sources.some(source => source.buffer?.path?.includes('effect_sword_slash_')), false);
  assert.equal(sources.some(source => source.buffer?.path?.includes('effect_sword_armor_impact_')), false);
});

test('unarmored hit plays the normal swing and body impact; a miss uses the quieter miss cue', async () => {
  const hit = await runCombatEvent(combatEvent(eventWithGrunt(false),
    { kind: 'body', damageApplied: 20 }, 'guerreiro', 'civilian'));
  const hitPaths = hit.contexts[0].sources.map(source => source.buffer?.path || '');
  assert.ok(hitPaths.some(path => path.includes('effect_sword_slash_')));
  assert.ok(hitPaths.some(path => path.includes('effect_character_body_impact_')));

  const miss = await runCombatEvent(combatEvent(eventWithGrunt(false),
    { kind: 'miss', damageApplied: 0 }, 'guerreiro', 'civilian'));
  const missSources = miss.contexts[0].sources.filter(source => !source.loop);
  const missSwing = missSources.find(source => source.buffer?.path?.includes('effect_sword_swing_miss_'));
  assert.ok(missSwing, 'miss must use its dedicated sound');
  assert.equal(missSwing.destination.gain.value, .2);
  assert.equal(missSources.some(source => source.buffer?.path?.includes('effect_sword_slash_')), false);
  assert.equal(missSources.some(source => source.buffer?.path?.includes('effect_character_body_impact_')), false);
});

test('shield defense remains audible and deterministic melee effort adds a quiet grunt one time in five', async () => {
  const defense = await runCombatEvent(combatEvent(eventWithGrunt(false),
    { kind: 'shield', blockKind: 'shield', damageApplied: 0 }, 'guerreiro', 'soldier'));
  const defensePaths = defense.contexts[0].sources.map(source => source.buffer?.path || '');
  assert.ok(defensePaths.some(path => path.includes('effect_shield_impact_')));

  const gruntId = eventWithGrunt(true);
  const grunt = await runCombatEvent(combatEvent(gruntId,
    { kind: 'miss', damageApplied: 0 }, 'lanceiro', 'civilian'), { updateAt: 1400 });
  const gruntSource = grunt.contexts[0].sources.find(source => source.buffer?.path?.includes('effect_combat_grunt_'));
  assert.ok(gruntSource, 'one in five deterministic melee events should emit a grunt');
  assert.equal(gruntSource.destination.gain.value, .18);
  assert.equal(gruntSource.startedAt, .005, 'the grunt is scheduled before the later miss cue');
});

test('new wars and explicit general withdrawal orders play their mapped horns once', async () => {
  const h = harness();
  await h.audio.unlock();
  await flush();
  await flush();
  const attacker = { kingdomId: 1, aiOrder: null };
  const defender = { kingdomId: 2, aiOrder: null };
  const world = { day: 1, people: [], animals: [], structures: [], wars: [], campaigns: [
    { id: 12, attacker, defender }
  ] };
  h.audio.observe(world, 0, true);
  world.day = 2;
  world.wars.push({ id: 17, a: 1, b: 2, startedDay: 2, status: 'resolved' });
  h.audio.observe(world, 1000);
  h.audio.update(1000, 1, false);
  await flush();
  await flush();
  const warHorn = h.contexts[0].sources.find(source => source.buffer?.path?.includes('effect_war_horn_call_01.mp3'));
  assert.ok(warHorn, 'a newly recorded war should play the war call, even if the simulation advances before observation');

  attacker.aiOrder = { action: 'withdraw', assignedDay: 2, version: 1 };
  h.audio.observe(world, 1100);
  h.audio.update(1100, 1, false);
  await flush();
  await flush();
  const retreatHorn = h.contexts[0].sources.find(source => source.buffer?.path?.includes('effect_war_horn_retreat_01.mp3'));
  assert.ok(retreatHorn, 'an explicit general withdrawal order should play the retreat horn');
  assert.equal(h.contexts[0].sources.filter(source => source.buffer?.path?.includes('effect_war_horn_call_01.mp3')).length, 1);
  assert.equal(h.contexts[0].sources.filter(source => source.buffer?.path?.includes('effect_war_horn_retreat_01.mp3')).length, 1);
});

test('war and retreat horn assets are mapped and included in the shipped manifest', async () => {
  const root = new URL('../public/assets/sfx/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  for (const [event, id] of [['war_call', 'effect_war_horn_call_01'], ['retreat_ordered', 'effect_war_horn_retreat_01']]) {
    assert.deepEqual(manifest.events[event], [id]);
    const sound = manifest.sounds.find(item => item.id === id);
    assert.ok(sound, id + ' should exist in the manifest');
    await access(new URL(sound.files.mp3, root));
  }
});

test('combat assets record their source, creator, license and ship every referenced MP3', async () => {
  const root = new URL('../public/assets/sfx/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const combat = manifest.sounds.filter(sound =>
    ['sword_swing_miss', 'sword_armor_swing_hit', 'combat_grunt'].includes(sound.trigger));
  assert.equal(combat.length, 26);
  assert.equal(new Set(combat.map(sound => sound.source)).size, 15);
  for (const sound of combat) {
    assert.match(sound.source_url, /^https:\/\/pixabay\.com\//, sound.id);
    assert.ok(sound.creator, sound.id + ' has creator metadata');
    assert.equal(sound.license, 'Pixabay Content License', sound.id);
    assert.equal(sound.license_url, 'https://pixabay.com/service/license-summary/', sound.id);
    assert.equal(sound.source_page_reviewed_at, '2026-10-27', sound.id);
    await access(new URL(sound.files.mp3, root));
  }
});

test('tower alarms play once for a lone trespasser and twice for a group, without replaying old alerts', async () => {
  const h = harness();
  await h.audio.unlock();
  await flush(); await flush();
  const world = { day: 20, people: [], animals: [], structures: [], campaigns: [],
    combatEvents: [], combatSequence: 0,
    kingdoms: [{ id: 1, militaryIntel: [] }] };
  h.audio.observe(world, 0, true);
  const single = { id: 'tower:1:1', kind: 'tower-intrusion', day: 20, alarmCount: 1,
    location: { x: 20, y: 20 } };
  world.kingdoms[0].militaryIntel.push(single);
  h.audio.observe(world, 1000);
  h.audio.update(1000);
  await flush(); await flush();
  const horns = () => h.contexts[0].sources.filter(source =>
    source.buffer?.path?.includes('effect_war_horn_'));
  assert.equal(horns().length, 1);
  h.audio.observe(world, 1100);
  h.audio.update(1200);
  await flush();
  assert.equal(horns().length, 1, 'the same report must not sound again');

  world.kingdoms[0].militaryIntel.push({ id: 'tower:1:2', kind: 'tower-intrusion',
    day: 20, alarmCount: 2, location: { x: 22, y: 20 } });
  h.audio.observe(world, 2000);
  h.audio.update(2000);
  h.audio.update(2900);
  await flush(); await flush();
  assert.equal(horns().length, 3, 'two group calls are added, never a continuous loop');

  h.audio.observe(world, 3000, true);
  h.audio.observe(world, 3100);
  h.audio.update(3100);
  await flush();
  assert.equal(horns().length, 3, 'snapshot reset does not replay historical alarms');
});
