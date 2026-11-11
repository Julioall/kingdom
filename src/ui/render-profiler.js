import { summarizeEntityDraws } from './entity-draw-probe.js';

export const RENDER_PHASES = Object.freeze({
  preparation: 'Preparação e trilhas', terrain: 'Terreno', plants: 'Plantas do solo', roads: 'Estradas',
  water: 'Oceano e água', composition: 'Composição do cache', groundEffects: 'Trilhas e lavouras',
  depthOrder: 'Coleta e ordenação', entities: 'Entidades e efeitos', selection: 'Seleção e territórios',
  clouds: 'Nuvens e sombras', other: 'Demais comandos',
});

function sampleBuffer(capacity) {
  const entries = new Array(capacity);
  let next = 0, count = 0;
  return {
    push(value) { entries[next] = value; next = (next + 1) % capacity; count = Math.min(count + 1, capacity); },
    since(cutoff) {
      const result = [];
      for (let index = 0; index < count; index++) {
        const entry = entries[(next - count + index + capacity) % capacity];
        if (entry.at >= cutoff) result.push(entry);
      }
      return result;
    },
    clear() { entries.fill(undefined); next = count = 0; },
  };
}

function summarize(values) {
  if (!values.length) return { samples: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    samples: values.length,
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50Ms: sorted[Math.ceil(sorted.length * .5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
    maxMs: sorted[sorted.length - 1],
  };
}

// Times JavaScript/Canvas command submission on the main thread, not asynchronous GPU work.
export function createRenderProfiler({ enabled = false, now = () => performance.now(), windowMs = 10_000, capacity = 1200 } = {}) {
  const intervals = sampleBuffer(capacity), frames = sampleBuffer(capacity);
  const draws = sampleBuffer(capacity), drawIntervals = sampleBuffer(capacity);
  let active = enabled, visible = true, generation = 0;
  let previousFrame = null, previousDraw = null, context = null;

  function resetContinuity() { previousFrame = previousDraw = null; generation++; }
  function reset() {
    for (const buffer of [intervals, frames, draws, drawIntervals]) buffer.clear();
    context = null;
    resetContinuity();
  }

  function measurement(commit, source) {
    const started = now(), token = generation, phases = {};
    let previous = started, ended = false, entityBreakdown = null;
    return {
      setEntityBreakdown(value) { if (!ended) entityBreakdown = value; },
      mark(phase) {
        if (ended) return;
        const time = now();
        phases[phase] = (phases[phase] || 0) + Math.max(0, time - previous);
        previous = time;
      },
      end(details = {}) {
        if (ended) return;
        ended = true;
        if (!active || !visible || token !== generation) return;
        const time = now();
        phases.other = (phases.other || 0) + Math.max(0, time - previous);
        commit({ at: time, durationMs: Math.max(0, time - started), phases, source,
          ...(entityBreakdown ? { entityBreakdown } : {}), ...details });
      },
    };
  }

  return {
    get enabled() { return active; },
    setEnabled(value) {
      if (active === !!value) return;
      active = !!value;
      if (active) reset(); else resetContinuity();
    },
    setVisible(value) {
      if (visible === !!value) return;
      visible = !!value;
      resetContinuity();
    },
    reset,
    beginFrame(timestamp) {
      if (!active || !visible) return null;
      if (previousFrame !== null && timestamp > previousFrame) intervals.push({ at: timestamp, ms: timestamp - previousFrame });
      previousFrame = timestamp;
      return measurement(sample => frames.push(sample), 'animation');
    },
    beginDraw(source = 'event') {
      if (!active || !visible) return null;
      const time = now();
      if (previousDraw !== null && time > previousDraw) drawIntervals.push({ at: time, ms: time - previousDraw });
      previousDraw = time;
      return measurement(sample => {
        if (sample.context) { context = sample.context; delete sample.context; }
        draws.push(sample);
      }, source);
    },
    snapshot({ includeSamples = false } = {}) {
      const at = now(), cutoff = at - windowMs;
      const frameIntervals = intervals.since(cutoff), frameSamples = frames.since(cutoff);
      const drawSamples = draws.since(cutoff), drawCadence = drawIntervals.since(cutoff);
      const frameStats = summarize(frameIntervals.map(sample => sample.ms));
      const drawStats = summarize(drawSamples.map(sample => sample.durationMs));
      const phaseStats = {};
      for (const phase of Object.keys(RENDER_PHASES)) {
        const executions = drawSamples.filter(sample => Object.hasOwn(sample.phases, phase));
        const all = summarize(drawSamples.map(sample => sample.phases[phase] || 0));
        const executed = summarize(executions.map(sample => sample.phases[phase]));
        phaseStats[phase] = { ...all, executions: executions.length, executionMeanMs: executed.meanMs, executionP95Ms: executed.p95Ms };
      }
      const sources = {};
      for (const sample of drawSamples) sources[sample.source] = (sources[sample.source] || 0) + 1;
      const rebuilt = drawSamples.filter(sample => sample.cacheRebuilt);
      const frameStages = {};
      for (const phase of ['audio', 'atmosphere', 'simulationDispatch', 'map', 'other']) {
        frameStages[phase] = summarize(frameSamples.map(sample => sample.phases[phase] || 0));
      }
      const report = {
        schemaVersion: 1, capturedAt: new Date().toISOString(), enabled: active, visible, windowMs, capacity,
        measurement: 'Main-thread CPU and Canvas/WebGL command submission. Excludes GPU completion and simulation Worker execution. Frame intervals include visible stalls; hidden-tab gaps are excluded.',
        context: context ? structuredClone(context) : null,
        frames: { ...frameStats, fps: frameStats.meanMs ? 1000 / frameStats.meanMs : 0,
          over33MsPercent: frameIntervals.length ? frameIntervals.filter(sample => sample.ms > 1000 / 30).length / frameIntervals.length * 100 : 0,
          cpu: summarize(frameSamples.map(sample => sample.durationMs)), stages: frameStages },
        map: { ...drawStats, drawsPerSecond: drawCadence.length ? 1000 / summarize(drawCadence.map(sample => sample.ms)).meanMs : 0,
          sources, stages: phaseStats,
          entityBreakdown: summarizeEntityDraws(drawSamples),
          cache: { rebuilt: rebuilt.length, hits: drawSamples.length - rebuilt.length,
            hitPercent: drawSamples.length ? (drawSamples.length - rebuilt.length) / drawSamples.length * 100 : 0,
            rebuildCpu: summarize(rebuilt.map(sample => sample.durationMs)),
            hitCpu: summarize(drawSamples.filter(sample => !sample.cacheRebuilt).map(sample => sample.durationMs)) } },
      };
      if (includeSamples) report.samples = structuredClone({ frameIntervals, frames: frameSamples, draws: drawSamples, drawIntervals: drawCadence });
      return report;
    },
  };
}
