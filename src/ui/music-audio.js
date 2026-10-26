export const MUSIC_FILES = Object.freeze([
  '/assets/music/ogg/medieval-ambient-01.ogg',
  '/assets/music/mp3/medieval-ambient-01.mp3',
]);

export function musicGainAtZoom(zoom, minZoom = .5, maxZoom = 16) {
  const bounded = Math.max(minZoom, Math.min(maxZoom, Number(zoom) || minZoom));
  const distance = Math.log(bounded / minZoom) / Math.log(maxZoom / minZoom);
  const eased = distance * distance * (3 - 2 * distance);
  return Math.max(.3, Math.min(.5, .5 - .2 * eased));
}

// Stream the long track instead of decoding the entire recording into an AudioBuffer.
export function createMusicAudio({ getGain = () => .3, AudioClass = globalThis.Audio,
  onError = error => console.warn('[Kingdom áudio] Não foi possível iniciar a música.', error) } = {}) {
  let audio = null, context = null, gain = null, mediaSource = null;
  let starting = null, active = false, needsActivation = false, fileIndex = 0, level = null;

  function refresh(force = false) {
    if (!gain || !active) return;
    const requested = Number(getGain());
    const next = Number.isFinite(requested) ? Math.max(.3, Math.min(.5, requested)) : .3;
    if (force || level === null || Math.abs(next - level) > .001) {
      gain.gain.cancelAndHoldAtTime?.(context.currentTime);
      gain.gain.setTargetAtTime(next, context.currentTime, level === null ? .25 : .5);
      level = next;
    }
  }

  async function playFile() {
    try {
      await audio.play();
      if (!active) { audio.pause(); return false; }
      needsActivation = false;
      return true;
    } catch (error) {
      if (!active) return false;
      if (error?.name !== 'NotAllowedError' && fileIndex + 1 < MUSIC_FILES.length) {
        fileIndex++;
        audio.src = MUSIC_FILES[fileIndex];
        return playFile();
      }
      needsActivation = true;
      if (error?.name !== 'NotAllowedError') onError(error);
      return false;
    }
  }

  function start(audioContext, destination) {
    if (!AudioClass || typeof audioContext?.createMediaElementSource !== 'function') return Promise.resolve(false);
    active = true;
    if (!audio) {
      context = audioContext;
      audio = new AudioClass();
      audio.preload = 'metadata';
      audio.loop = true;
      audio.id = 'kingdomBackgroundMusic';
      audio.hidden = true;
      audio.src = MUSIC_FILES[0];
      gain = context.createGain();
      gain.gain.value = 0;
      mediaSource = context.createMediaElementSource(audio);
      mediaSource.connect(gain);
      gain.connect(destination);
      globalThis.document?.body?.appendChild(audio);
      audio.addEventListener?.('error', () => {
        if (active && !starting && !needsActivation) void start(context, destination);
      });
    }
    refresh();
    if (starting) return starting.then(ok => active && audio.paused ? start(context, destination) : ok);
    if (!audio.paused) return Promise.resolve(true);
    starting = playFile().finally(() => { starting = null; });
    return starting;
  }

  function pause() {
    active = false;
    audio?.pause();
  }

  return { start, pause, refresh, get needsActivation() { return needsActivation; } };
}
