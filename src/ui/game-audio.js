import { SHEEP_ADULT_AGE_DAYS } from '../config/ecosystem.js';
import { createMusicAudio } from './music-audio.js';

const STORAGE_ENABLED = 'kingdom-sfx-enabled-v1';
const STORAGE_VOLUME = 'kingdom-sfx-volume-v1';
const STORAGE_EFFECTS_VOLUME = 'kingdom-effects-volume-v1';
const STORAGE_MUSIC_VOLUME = 'kingdom-music-volume-v1';
const MAX_ACTIVE_VOICES = 48;
// Offline loudness measurements provide headroom; restore a usable gameplay mix
// before distance attenuation and the master peak protection.
const EFFECTS_MIX_GAIN = 10 ** (12 / 20);
const MAX_PENDING_CUES = 512;
const CUE_RETRY_MS = 80;
const HARVESTING_MIN_INTERVAL_MS = 2200;
const HARVESTING_SFX_GAIN = .26;
const SWORD_ARMOR_HIT_OFFSET_MS = 180;
// Linear playback multipliers: quieter weapon motion, stronger material contact.
// Applied once when a combat cue is scheduled; this is not evaluated per frame.
const COMBAT_SFX_LEVEL = Object.freeze({
  swordSwing: .4,
  swordSwingMiss: .2,
  combatGrunt: .18,
  spearSwing: .3,
  spearSwingMiss: .15,
  spearArmorImpact: .735,
  bowDraw: .35,
  arrowRelease: .48,
  arrowFlight: .28,
  bodyImpact: .66,
  armorImpact: .98,
  arrowArmorImpact: .84,
  shieldImpact: .86,
  weaponClash: .92,
  arrowWoodImpact: .62,
  fatalFall: .82,
  structureImpact: .58,
  structureMeleeImpact: .74,
  structureCollapse: .9
});
const PRELOAD_EVENTS = Object.freeze([
  'magic_heal', 'sword_slash', 'sword_swing_miss', 'sword_armor_swing_hit', 'combat_grunt',
  'sword_clash', 'axe_slash', 'wood_impact', 'bow_draw',
  'shield_impact', 'sword_armor_impact', 'character_hurt', 'character_body_impact', 'war_call', 'war_horn', 'retreat_ordered',
  'building_destroyed', 'building_melee_impact', 'hammer_build', 'mining', 'harvesting',
  'sheep_bleat', 'lamb_call_mother',
  'arrow_release', 'arrow_flight', 'arrow_impact', 'arrow_wood_impact', 'crossbow_fire', 'body_fall_fatal',
  'light_thud', 'magic_cast'
]);

function safeRead(storage, key) {
  try { return storage?.getItem(key); } catch { return null; }
}

function safeWrite(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* Storage can be disabled in private browsing. */ }
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function windGainAtZoom(zoom, minZoom = .5, maxZoom = 16) {
  const distance = Math.log(clamp(Number(zoom) || minZoom, minZoom, maxZoom) / minZoom) / Math.log(maxZoom / minZoom);
  const eased = distance * distance * (3 - 2 * distance);
  return clamp(.7 - .6 * eased, .1, .7);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function activityKey(activity, day) {
  return activity?.day === day
    ? `${activity.day}:${activity.kind}:${activity.x}:${activity.y}` : '';
}

function isWoodenStructure(structure) {
  return !!structure && ['abrigo', 'acampamento', 'casa', 'curral', 'mercado', 'posto de coleta', 'roça', 'vila'].includes(structure.type);
}

export function createGameAudio({ onStatus = () => {}, getPan = () => 0, getDistanceGain = () => 1,
  getWindGain = () => .1,
  getMusicGain = () => .3, MusicAudioClass = globalThis.Audio,
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  fetchImpl = globalThis.fetch?.bind(globalThis), storage = null } = {}) {
  if (storage === null) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  const enabledPreference = safeRead(storage, STORAGE_ENABLED);
  const storedVolume = safeRead(storage, STORAGE_VOLUME);
  const volumePreference = storedVolume == null ? NaN : Number(storedVolume);
  let enabled = enabledPreference == null ? true : enabledPreference === 'true';
  let volume = Number.isFinite(volumePreference) ? clamp(volumePreference, 0, 1) : .65;
  const channelPreference = key => {
    const raw = safeRead(storage, key), value = raw == null ? NaN : Number(raw);
    return Number.isFinite(value) ? clamp(value, 0, 1) : volume;
  };
  let effectsVolume = channelPreference(STORAGE_EFFECTS_VOLUME), musicVolume = channelPreference(STORAGE_MUSIC_VOLUME);
  let context = null, masterGain = null, effectsGain = null, effectsVolumeGain = null, musicVolumeGain = null;
  let unlocked = false, unlockPromise = null, manifestPromise = null;
  let manifest = null, timelineNow = 0, timelineSpeed = 1;
  let pending = [], activeVoices = new Set(), activeByFamily = new Map(), buffers = new Map();
  const bufferNormalization = new WeakMap();
  const priorActivities = new Map(), priorHealing = new Map(), priorOrders = new Map();
  const sheepBleatStates = new Map();
  const seenDestroyedStructures = new Set(), scheduledDestroyedStructures = new Set();
  const seenTowerAlarms = new Set();
  let lastCombatEvent = 0, lastSheepBleatAt = -Infinity, lastHarvestSoundAt = -Infinity;
  let nextAdultBleatVariant = 0, initialized = false;
  let windVoice = null, windPromise = null, windFailed = false;
  let windRetryAt = 0, windFailures = 0;
  const music = createMusicAudio({ getGain: getMusicGain, AudioClass: MusicAudioClass });

  function windGain() {
    const value = Number(getWindGain());
    return Number.isFinite(value) ? clamp(value, .1, .7) : .1;
  }

  function stopWind() {
    if (!windVoice) return;
    const voice = windVoice;
    windVoice = null;
    voice.gain.gain.setTargetAtTime(0, context.currentTime, .025);
    voice.source.stop(context.currentTime + .15);
  }

  function ensureWind() {
    if (windVoice || windPromise || windFailed || !enabled || !unlocked || context?.state !== 'running'
      || context.currentTime < windRetryAt) return;
    windPromise = (async () => {
      await ensureManifest();
      const sound = soundFor('wind_ambience', 'ambient-wind');
      if (!sound) { windFailed = true; return; }
      const buffer = await loadSound(sound);
      if (!enabled || !unlocked || context.state !== 'running') return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      const requestedStart = Number(sound.loop_start_seconds) || 0;
      source.loopStart = clamp(requestedStart, 0, Math.max(0, buffer.duration - .1));
      source.loopEnd = buffer.duration;
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(effectsVolumeGain);
      const voice = { source, gain, level: windGain() };
      windVoice = voice;
      source.onended = () => {
        source.disconnect(); gain.disconnect();
        if (windVoice === voice) windVoice = null;
      };
      gain.gain.setTargetAtTime(voice.level, context.currentTime, .12);
      source.start(context.currentTime, source.loopStart);
      windFailures = 0;
      setStatus('Efeitos sonoros e vento prontos');
    })().catch(error => {
      if (windVoice) {
        windVoice.source.disconnect(); windVoice.gain.disconnect();
        windVoice = null;
      }
      windFailures++;
      windRetryAt = (context?.currentTime || 0) + Math.min(30, 2 ** windFailures);
      console.warn('[Kingdom áudio] Não foi possível carregar o vento.', error);
    }).finally(() => { windPromise = null; });
  }

  function refreshAmbience(force = false) {
    if (!enabled || !unlocked || context?.state !== 'running') return;
    music.refresh(force);
    ensureWind();
    if (!windVoice) return;
    let audibleEffect = false;
    for (const voice of activeVoices) {
      if (voice.baseGain * voice.distanceGain * EFFECTS_MIX_GAIN > .015) { audibleEffect = true; break; }
    }
    const level = Math.max(.1, windGain() * (audibleEffect ? .45 : 1));
    if (force || Math.abs(level - windVoice.level) > .001) {
      const smoothing = level < windVoice.level ? .035 : .45;
      const parameter = windVoice.gain.gain;
      if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(context.currentTime);
      windVoice.level = level;
      parameter.setTargetAtTime(level, context.currentTime, smoothing);
    }
  }

  function setStatus(message) { onStatus(message); }

  function setEnabled(value) {
    enabled = !!value;
    safeWrite(storage, STORAGE_ENABLED, String(enabled));
    if (!enabled) {
      pending = [];
      stopWind();
      music.pause();
      if (masterGain && context) masterGain.gain.setTargetAtTime(0, context.currentTime, .025);
      setStatus('Áudio silenciado');
    } else {
      windFailed = false;
      windRetryAt = 0;
      void unlock();
      if (masterGain && context) masterGain.gain.setTargetAtTime(1, context.currentTime, .025);
      setStatus(unlocked ? 'Áudio ligado' : 'Clique ou pressione uma tecla para liberar o áudio');
    }
  }

  function setVolume(value) {
    volume = clamp(Number(value) || 0, 0, 1);
    safeWrite(storage, STORAGE_VOLUME, String(volume));
    setEffectsVolume(volume);
    setMusicVolume(volume);
  }

  function setEffectsVolume(value) {
    effectsVolume = clamp(Number(value) || 0, 0, 1);
    safeWrite(storage, STORAGE_EFFECTS_VOLUME, String(effectsVolume));
    if (effectsVolumeGain && context) effectsVolumeGain.gain.setTargetAtTime(effectsVolume, context.currentTime, .025);
  }

  function setMusicVolume(value) {
    musicVolume = clamp(Number(value) || 0, 0, 1);
    safeWrite(storage, STORAGE_MUSIC_VOLUME, String(musicVolume));
    if (musicVolumeGain && context) musicVolumeGain.gain.setTargetAtTime(musicVolume, context.currentTime, .025);
    if (musicVolume === 0) music.pause();
    else if (enabled && context?.state === 'running') void music.start(context, musicVolumeGain);
  }

  async function ensureManifest() {
    if (manifest) return manifest;
    manifestPromise ||= (async () => {
      if (!fetchImpl) throw new Error('Fetch indisponível');
      const response = await fetchImpl('/assets/sfx/manifest.json');
      if (!response.ok) throw new Error(`Manifesto de áudio: HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.sounds) || !data.events) throw new Error('Manifesto de áudio inválido');
      manifest = data;
      return manifest;
    })();
    try { return await manifestPromise; }
    catch (error) { manifestPromise = null; throw error; }
  }

  function soundFor(event, key) {
    const ids = manifest?.events?.[event] || [];
    if (!ids.length) return null;
    const id = ids[stableHash(key) % ids.length];
    return manifest.sounds.find(sound => sound.id === id) || null;
  }

  async function decodeFile(path, sound, format) {
    const response = await fetchImpl('/assets/sfx/' + path);
    if (!response.ok) throw new Error(`Áudio: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes);
    const measuredGain = sound?.normalization?.formats?.[format]?.gain_db;
    const correctionDb = Number.isFinite(measuredGain) ? clamp(measuredGain, -60, 14) : 0;
    bufferNormalization.set(buffer, 10 ** (correctionDb / 20));
    return buffer;
  }

  async function loadSound(sound) {
    if (buffers.has(sound.id)) return buffers.get(sound.id);
    const promise = (async () => {
      if (sound.files.ogg) {
        try { return await decodeFile(sound.files.ogg, sound, 'ogg'); }
        catch (oggError) {
          if (!sound.files.mp3) throw oggError;
        }
      }
      if (sound.files.mp3) return decodeFile(sound.files.mp3, sound, 'mp3');
      throw new Error('Efeito sem arquivo OGG ou MP3');
    })();
    buffers.set(sound.id, promise);
    try {
      const buffer = await promise;
      buffers.set(sound.id, buffer);
      return buffer;
    } catch (error) {
      buffers.delete(sound.id);
      throw error;
    }
  }

  function preload() {
    void (async () => {
      try {
        await ensureManifest();
        const sounds = PRELOAD_EVENTS.flatMap(event => (manifest.events[event] || [])
          .map(id => manifest.sounds.find(sound => sound.id === id)).filter(Boolean));
        let cursor = 0;
        const workers = Array.from({ length: 4 }, async () => {
          while (cursor < sounds.length) {
            const sound = sounds[cursor++];
            try { await loadSound(sound); } catch { /* Playback reports the failure only when needed. */ }
          }
        });
        await Promise.all(workers);
      } catch (error) {
        console.warn('[Kingdom áudio] Não foi possível preparar os efeitos sonoros.', error);
        setStatus('Não foi possível carregar os efeitos sonoros');
      }
    })();
  }

  async function unlock() {
    if (!enabled) return false;
    if (!AudioContextClass) {
      setStatus('Este navegador não oferece áudio Web');
      return false;
    }
    if (unlocked && context?.state === 'running') {
      if (musicVolume > 0) void music.start(context, musicVolumeGain);
      refreshAmbience();
      return true;
    }
    if (unlockPromise) {
      // A resume requested before user activation may stay pending. Retry within
      // the new gesture instead of waiting forever on the original request.
      if (context?.state !== 'running') void context.resume().catch(() => {});
      return unlockPromise;
    }
    unlockPromise = (async () => {
      try {
        if (!context) {
          context = new AudioContextClass();
          context.addEventListener?.('statechange', () => {
            unlocked = context.state === 'running';
            if (unlocked) refreshAmbience(true);
          });
          masterGain = context.createGain();
          masterGain.gain.value = enabled ? 1 : 0;
          effectsVolumeGain = context.createGain();
          effectsVolumeGain.gain.value = effectsVolume;
          effectsVolumeGain.connect(masterGain);
          musicVolumeGain = context.createGain();
          musicVolumeGain.gain.value = musicVolume;
          musicVolumeGain.connect(masterGain);
          effectsGain = context.createGain();
          effectsGain.gain.value = EFFECTS_MIX_GAIN;
          effectsGain.connect(effectsVolumeGain);
          // Protect the combined mix when several already-balanced effects overlap.
          if (typeof context.createDynamicsCompressor === 'function') {
            const limiter = context.createDynamicsCompressor();
            limiter.threshold.value = -3;
            limiter.knee.value = 3;
            limiter.ratio.value = 12;
            limiter.attack.value = .003;
            limiter.release.value = .15;
            masterGain.connect(limiter);
            limiter.connect(context.destination);
          } else masterGain.connect(context.destination);
        }
        await context.resume();
        unlocked = context.state === 'running';
        if (unlocked) {
          setStatus('Efeitos sonoros prontos');
          preload();
          ensureWind();
          if (enabled && musicVolume > 0) void music.start(context, musicVolumeGain);
        }
        return unlocked;
      } catch (error) {
        setStatus('Clique novamente para liberar o áudio');
        return false;
      } finally { unlockPromise = null; }
    })();
    return unlockPromise;
  }

  function startBuffer(buffer, family, cue, atTime, rate = 1) {
    if (!enabled || !unlocked || !context || context.state !== 'running') return false;
    if (activeVoices.size >= MAX_ACTIVE_VOICES) return 'busy';
    const familyVoices = activeByFamily.get(family) || 0;
    const familyLimit = ['hammer_build', 'mining', 'harvesting', 'character_body_impact', 'combat_grunt'].includes(family) ? 10
      : family === 'shield_impact' || family === 'character_hurt' ? 4 : 3;
    if (familyVoices >= familyLimit) return 'busy';
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const baseGain = (cue.gain ?? .85) * (bufferNormalization.get(buffer) ?? 1);
    const distanceGain = Number.isFinite(cue.x) && Number.isFinite(cue.y)
      ? clamp(Number(getDistanceGain(cue.x, cue.y)) || 0, 0, 1) : 1;
    gain.gain.value = baseGain * distanceGain;
    source.connect(gain);
    const panner = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null;
    const pan = clamp(Number(getPan(cue.x, cue.y)) || 0, -1, 1);
    if (panner) {
      panner.pan.value = pan;
      gain.connect(panner); panner.connect(effectsGain);
    } else gain.connect(effectsGain);
    const voice = { source, gain, panner, cue, baseGain, distanceGain, pan };
    activeVoices.add(voice);
    activeByFamily.set(family, familyVoices + 1);
    source.onended = () => {
      activeVoices.delete(voice);
      const remaining = (activeByFamily.get(family) || 1) - 1;
      if (remaining > 0) activeByFamily.set(family, remaining);
      else activeByFamily.delete(family);
      source.disconnect(); gain.disconnect(); panner?.disconnect();
    };
    source.start(Math.max(context.currentTime + .005, atTime));
    return true;
  }

  async function playCue(cue, immediate = false) {
    try {
      await ensureManifest();
      const sound = cue.soundId
        ? manifest.sounds.find(item => item.id === cue.soundId)
        : soundFor(cue.event, cue.key);
      if (!sound) return false;
      const buffer = await loadSound(sound);
      if (!enabled || !unlocked || context?.state !== 'running') return false;
      if (!immediate && timelineNow > cue.expiresAt) return false;
      const atTime = immediate ? context.currentTime + .02
        : context.currentTime + Math.max(0, (cue.at - timelineNow) / (1000 * Math.max(.1, timelineSpeed)));
      const result = startBuffer(buffer, cue.event, cue, atTime, cue.rate || 1);
      if (result === 'busy' && !immediate && timelineNow + CUE_RETRY_MS <= cue.expiresAt) {
        pending.push({ ...cue, at: timelineNow + CUE_RETRY_MS });
        if (pending.length > MAX_PENDING_CUES) pending.splice(0, pending.length - MAX_PENDING_CUES);
      }
      return result === true;
    } catch (error) {
      console.warn('[Kingdom áudio] Falha ao reproduzir ' + cue.event + '.', error);
      setStatus('Falha ao carregar um efeito sonoro');
      return false;
    }
  }

  function queue(event, key, at, point = null, extra = {}) {
    if (!enabled || !unlocked || context?.state !== 'running') return;
    const expiryWindow = ['hammer_build', 'mining', 'harvesting', 'character_body_impact'].includes(event) ? 2200 : 1100;
    pending.push({ event, key, at, expiresAt: at + expiryWindow, x: point?.x, y: point?.y, ...extra });
    if (pending.length > MAX_PENDING_CUES) pending.splice(0, pending.length - MAX_PENDING_CUES);
  }

  function nextSheepBleat(animal, state, now) {
    const juvenile = animal.ageDays < SHEEP_ADULT_AGE_DAYS;
    const interval = juvenile ? 10500 : 14500;
    const variation = stableHash('sheep-bleat:' + animal.id + ':' + state.sequence) % 6500;
    state.nextAt = now + (interval + variation) * timelineSpeed;
  }

  function observeSheep(world, now) {
    const livingSheep = (world.animals || []).filter(animal => animal.alive && animal.speciesId === 'sheep');
    const livingIds = new Set(livingSheep.map(animal => animal.id));
    const due = [];
    for (const animal of livingSheep) {
      let state = sheepBleatStates.get(animal.id);
      if (!state) {
        state = { sequence: 0, nextAt: now + (4500 + stableHash('sheep-first:' + animal.id) % 8500) * timelineSpeed };
        sheepBleatStates.set(animal.id, state);
        continue;
      }
      if (now < state.nextAt) continue;
      const audible = clamp(Number(getDistanceGain(animal.x, animal.y)) || 0, 0, 1);
      if (audible < .06) {
        nextSheepBleat(animal, state, now);
        continue;
      }
      const juvenile = animal.ageDays < SHEEP_ADULT_AGE_DAYS;
      if (juvenile && animal.motherId != null) {
        const mother = livingSheep.find(candidate => candidate.id === animal.motherId);
        if (mother && Math.hypot(animal.x - mother.x, animal.y - mother.y) <= 1.6) {
          state.nextAt = now + 2800 * timelineSpeed;
          continue;
        }
      }
      due.push({ animal, state, juvenile });
    }
    for (const id of sheepBleatStates.keys()) if (!livingIds.has(id)) sheepBleatStates.delete(id);
    if (!due.length || now - lastSheepBleatAt < 2800 * timelineSpeed) return;
    due.sort((left, right) => left.state.nextAt - right.state.nextAt || left.animal.id - right.animal.id);
    const { animal, state, juvenile } = due[0];
    if (juvenile) {
      queue('lamb_call_mother', 'lamb-call:' + animal.id + ':' + state.sequence, now, animal, { gain: .5 });
    } else {
      const variants = manifest?.events?.sheep_bleat || [];
      if (variants.length) {
        const soundId = variants[nextAdultBleatVariant % variants.length];
        nextAdultBleatVariant++;
        queue('sheep_bleat', 'adult-sheep-bleat:' + state.sequence + ':' + animal.id,
          now, animal, { gain: .38, soundId });
      }
    }
    state.sequence++;
    nextSheepBleat(animal, state, now);
    lastSheepBleatAt = now;
  }

  function observeCombat(world, now) {
    for (const event of world.combatEvents || []) {
      if (event.id <= lastCombatEvent) continue;
      lastCombatEvent = event.id;
      if (event.day !== world.day || event.result?.kind === 'cancelled') continue;
      const key = `combat:${event.id}`;
      const start = now;
      const windup = Math.max(0, event.windupMs || 0);
      const contactAt = now + Math.max(windup, event.result?.atMs || windup);
      const contact = event.result?.point || event.aim || event.origin;
      const kind = event.result?.kind;
      const target = kind === 'body' ? (world.people || []).find(person => person.id === event.targetId) : null;
      const isMilitaryTarget = target?.role === 'soldier' || Boolean(target?.militaryClass);
      const meleeArmorHit = ['guerreiro', 'lanceiro'].includes(event.weapon) && kind === 'body' && isMilitaryTarget;
      if (['guerreiro', 'lanceiro'].includes(event.weapon) && stableHash(key + ':grunt-chance') % 5 === 0) {
        queue('combat_grunt', key + ':grunt', start + windup * .55, event.origin,
          { gain: COMBAT_SFX_LEVEL.combatGrunt });
      }
      if (event.weapon === 'guerreiro') {
        const missed = kind === 'miss';
        const swingEvent = missed ? 'sword_swing_miss' : meleeArmorHit ? 'sword_armor_swing_hit' : 'sword_slash';
        const swingGain = missed ? COMBAT_SFX_LEVEL.swordSwingMiss
          : meleeArmorHit ? COMBAT_SFX_LEVEL.armorImpact : COMBAT_SFX_LEVEL.swordSwing;
        const swingAt = meleeArmorHit ? Math.max(start, contactAt - SWORD_ARMOR_HIT_OFFSET_MS) : start + windup;
        queue(swingEvent, key + ':swing', swingAt, meleeArmorHit ? contact : event.origin, { gain: swingGain });
      } else if (event.weapon === 'lanceiro') {
        const missed = kind === 'miss';
        const swingEvent = missed ? 'sword_swing_miss' : meleeArmorHit ? 'sword_armor_swing_hit' : 'sword_slash';
        const swingGain = missed ? COMBAT_SFX_LEVEL.spearSwingMiss
          : meleeArmorHit ? COMBAT_SFX_LEVEL.spearArmorImpact : COMBAT_SFX_LEVEL.spearSwing;
        const swingAt = meleeArmorHit ? Math.max(start, contactAt - SWORD_ARMOR_HIT_OFFSET_MS) : start + windup;
        queue(swingEvent, key + ':swing', swingAt, meleeArmorHit ? contact : event.origin, { gain: swingGain });
      }
      else if (event.weapon === 'arqueiro') {
        queue('bow_draw', key + ':draw', start, event.origin, { gain: COMBAT_SFX_LEVEL.bowDraw });
        queue('arrow_release', key + ':release', start + windup, event.origin,
          { gain: COMBAT_SFX_LEVEL.arrowRelease });
        const flight = Math.max(0, event.flightMs || 0);
        if (flight >= 350) queue('arrow_flight', key + ':flight', start + windup + Math.max(0, flight - 700), contact,
          { rate: Math.min(2, 700 / flight), gain: COMBAT_SFX_LEVEL.arrowFlight });
      }
      if (!kind || kind === 'miss') continue;
      if (kind === 'parry') {
        const parrySound = event.result.blockKind === 'shield' ? 'shield_impact' : 'sword_clash';
        const gain = event.result.blockKind === 'shield' ? COMBAT_SFX_LEVEL.shieldImpact : COMBAT_SFX_LEVEL.weaponClash;
        queue(parrySound, key + ':parry', contactAt, contact, { gain });
      } else if (kind === 'shield') queue('shield_impact', key + ':shield', contactAt, contact,
        { gain: COMBAT_SFX_LEVEL.shieldImpact });
      else if (kind === 'weapon-guard') queue('sword_clash', key + ':guard', contactAt, contact,
        { gain: COMBAT_SFX_LEVEL.weaponClash });
      else if (kind === 'body') {
        const damageSound = event.weapon === 'arqueiro'
          ? (isMilitaryTarget ? 'crossbow_fire' : 'arrow_wood_impact')
          : (isMilitaryTarget ? 'sword_armor_impact' : 'character_body_impact');
        const gain = event.weapon === 'arqueiro'
          ? (isMilitaryTarget ? COMBAT_SFX_LEVEL.arrowArmorImpact : COMBAT_SFX_LEVEL.arrowWoodImpact)
          : (isMilitaryTarget ? COMBAT_SFX_LEVEL.armorImpact : COMBAT_SFX_LEVEL.bodyImpact);
        if (!meleeArmorHit) queue(damageSound, key + ':damage:' + damageSound, contactAt, contact, { gain });
        if (event.result.fatal) queue('body_fall_fatal', key + ':fatal', contactAt, contact,
          { gain: COMBAT_SFX_LEVEL.fatalFall });
      } else if (kind === 'structure') {
        const meleeStructureHit = event.result.damageApplied > 0 && ['guerreiro', 'lanceiro'].includes(event.weapon);
        if (meleeStructureHit) queue('building_melee_impact', key + ':building-melee-impact', contactAt, contact,
          { gain: COMBAT_SFX_LEVEL.structureMeleeImpact });
        if (event.result.structureDestroyed) {
          scheduledDestroyedStructures.add(event.targetId);
          const collapseAt = contactAt + (meleeStructureHit ? 230 : 0);
          queue('building_destroyed', key + ':building-destroyed', collapseAt, contact,
            { gain: COMBAT_SFX_LEVEL.structureCollapse });
        } else if (event.weapon === 'arqueiro') {
          const target = (world.structures || []).find(structure => structure.id === event.targetId);
          queue(isWoodenStructure(target) ? 'arrow_wood_impact' : 'light_thud', key + ':arrow-structure', contactAt, contact,
            { gain: isWoodenStructure(target) ? COMBAT_SFX_LEVEL.arrowWoodImpact : COMBAT_SFX_LEVEL.structureImpact });
        } else if (!meleeStructureHit) queue('light_thud', key + ':structure', contactAt, contact,
          { gain: COMBAT_SFX_LEVEL.structureImpact });
      }
    }
  }

  function observe(world, now, reset = false) {
    timelineNow = now;
    if (reset || !initialized) {
      pending = [];
      priorActivities.clear(); priorHealing.clear(); priorOrders.clear();
      sheepBleatStates.clear(); lastSheepBleatAt = -Infinity; lastHarvestSoundAt = -Infinity; nextAdultBleatVariant = 0;
      seenDestroyedStructures.clear(); scheduledDestroyedStructures.clear();
      seenTowerAlarms.clear();
      for (const kingdom of world.kingdoms || []) for (const report of kingdom.militaryIntel || []) {
        if (report.kind === 'tower-intrusion' && report.id) seenTowerAlarms.add(report.id);
      }
      lastCombatEvent = world.combatSequence || 0;
      for (const person of world.people || []) {
        priorActivities.set(person.id, activityKey(person.visualActivity, world.day));
        priorHealing.set(person.id, healingKey(person.lastHealingCast));
      }
      for (const campaign of world.campaigns || []) for (const side of [campaign.attacker, campaign.defender]) {
        if (side) priorOrders.set(`${campaign.id}:${side.kingdomId}`, orderKey(side.aiOrder));
      }
      for (const structure of world.structures || []) if (structure.destroyedDay != null) seenDestroyedStructures.add(structure.id);
      initialized = true;
      return;
    }

    observeCombat(world, now);
    observeSheep(world, now);
    // Audible warnings use the tower's actual sighting event, not a generic war
    // declaration. Snapshot resets seed the seen set so old alarms do not replay.
    for (const kingdom of world.kingdoms || []) for (const report of kingdom.militaryIntel || []) {
      if (report.kind !== 'tower-intrusion' || !report.id || seenTowerAlarms.has(report.id)) continue;
      seenTowerAlarms.add(report.id);
      const count = Math.min(3, Math.max(1, Math.trunc(report.alarmCount || 1)));
      for (let call = 0; call < count; call++) {
        queue('war_horn', `tower-alarm:${kingdom.id}:${report.id}:${call}`,
          now + call * 850, report.location, { gain: .82 });
      }
    }
    if (seenTowerAlarms.size > 512) {
      const recent = [...seenTowerAlarms].slice(-256);
      seenTowerAlarms.clear();
      for (const id of recent) seenTowerAlarms.add(id);
    }

    let harvestCue = null;
    for (const person of world.people || []) {
      const key = activityKey(person.visualActivity, world.day);
      const prior = priorActivities.get(person.id);
      if (key && key !== prior && person.alive) {
        const activity = person.visualActivity;
        const id = `activity:${world.day}:${person.id}:${key}`;
        const stagger = stableHash(id) % 420;
        if (activity.kind === 'chop') {
          queue('axe_slash', id + ':axe', now + stagger, activity, { gain: .68 });
          queue('wood_impact', id + ':wood', now + 250 + stagger, activity, { gain: .58 });
        } else if (activity.kind === 'mine') {
          queue('mining', id + ':mine', now + 180 + stagger, activity, { gain: .58 });
        } else if (activity.kind === 'harvest') {
          const audibility = clamp(Number(getDistanceGain(activity.x, activity.y)) || 0, 0, 1);
          if (!harvestCue || audibility > harvestCue.audibility) harvestCue = { id, activity, audibility };
        } else if (activity.kind === 'build') {
          queue('hammer_build', id + ':build', now + 250 + stagger, activity, { gain: .42 });
        }
      }
      priorActivities.set(person.id, key);

      const healing = healingKey(person.lastHealingCast);
      if (healing && healing !== priorHealing.get(person.id) && person.lastHealingCast?.day === world.day) {
        const cast = person.lastHealingCast;
        const point = person;
        const id = `healing:${person.id}:${healing}`;
        queue('magic_cast', id + ':cast', now, point, { gain: .52 });
        queue('magic_heal', id + ':heal', now + 650, point, { gain: .5 });
      }
      priorHealing.set(person.id, healing);
    }
    if (harvestCue && now - lastHarvestSoundAt >= HARVESTING_MIN_INTERVAL_MS * timelineSpeed) {
      const stagger = stableHash(harvestCue.id) % 420;
      queue('harvesting', harvestCue.id + ':harvest', now + 120 + stagger, harvestCue.activity,
        { gain: HARVESTING_SFX_GAIN });
      lastHarvestSoundAt = now;
    }
    for (const campaign of world.campaigns || []) for (const side of [campaign.attacker, campaign.defender]) {
      if (!side) continue;
      const id = `${campaign.id}:${side.kingdomId}`;
      const key = orderKey(side.aiOrder);
      if (key && key !== priorOrders.get(id) && side.aiOrder?.action === 'withdraw' && side.aiOrder.assignedDay === world.day) {
        queue('retreat_ordered', `retreat:${id}:${key}`, now, null, { gain: .8 });
      }
      priorOrders.set(id, key);
    }
    for (const structure of world.structures || []) {
      if (structure.destroyedDay == null || seenDestroyedStructures.has(structure.id)) continue;
      if (!scheduledDestroyedStructures.has(structure.id)) {
        queue('building_destroyed', `building:${structure.id}:${structure.destroyedDay}`, now, structure, { gain: .9 });
      }
      seenDestroyedStructures.add(structure.id);
    }
    scheduledDestroyedStructures.clear();
    for (const id of priorActivities.keys()) if (!(world.people || []).some(person => person.id === id)) priorActivities.delete(id);
    for (const id of priorHealing.keys()) if (!(world.people || []).some(person => person.id === id)) priorHealing.delete(id);
  }

  function update(now, speed = 1, paused = false) {
    timelineNow = now; timelineSpeed = Math.max(.1, Number(speed) || 1);
    if (enabled && unlocked && context?.state === 'running') {
      refreshAmbience();
      for (const voice of activeVoices) {
        const { cue, gain, panner } = voice;
        if (!Number.isFinite(cue.x) || !Number.isFinite(cue.y)) continue;
        const nextGain = clamp(Number(getDistanceGain(cue.x, cue.y)) || 0, 0, 1);
        if (Math.abs(nextGain - voice.distanceGain) > .01) {
          voice.distanceGain = nextGain;
          gain.gain.setTargetAtTime(voice.baseGain * nextGain, context.currentTime, .065);
        }
        if (panner) {
          const nextPan = clamp(Number(getPan(cue.x, cue.y)) || 0, -1, 1);
          if (Math.abs(nextPan - voice.pan) > .01) {
            voice.pan = nextPan;
            panner.pan.setTargetAtTime(nextPan, context.currentTime, .065);
          }
        }
      }
    }
    if (!enabled || !unlocked || !context || context.state !== 'running' || paused) return;
    const lookAhead = 75 * timelineSpeed;
    const due = [], future = [];
    for (const cue of pending) {
      if (now > cue.expiresAt) continue;
      (cue.at <= now + lookAhead ? due : future).push(cue);
    }
    pending = future;
    for (const cue of due) void playCue(cue);
  }

  function play(event, key = `${event}:${Date.now()}`, point = null, extra = {}) {
    if (!enabled) return Promise.resolve(false);
    return unlock().then(ok => ok ? playCue({ event, key, x: point?.x, y: point?.y, ...extra }, true) : false);
  }

  setStatus(enabled ? 'Clique no jogo para liberar os efeitos sonoros' : 'Efeitos sonoros desligados');
  return {
    observe, update, unlock, play, refreshAmbience,
    preview() {
      return play('sword_slash', 'settings-preview:sword').then(played => {
        if (played) setStatus('Som de teste reproduzido');
        return played;
      });
    },
    setEnabled, setVolume, setEffectsVolume, setMusicVolume,
    get enabled() { return enabled; },
    get volume() { return volume; },
    get effectsVolume() { return effectsVolume; },
    get musicVolume() { return musicVolume; },
    get ready() { return unlocked && context?.state === 'running' && (musicVolume === 0 || !music.needsActivation); }
  };
}

function healingKey(cast) {
  if (!cast) return '';
  return `${cast.day}:${cast.primaryTargetId}:${(cast.recipientIds || []).join(',')}`;
}

function orderKey(order) {
  return order ? `${order.assignedDay}:${order.version}:${order.action}` : '';
}
