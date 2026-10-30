import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderProfiler } from '../src/ui/render-profiler.js';

test('disabled profiling does not read the clock or allocate measurements', () => {
  const profiler = createRenderProfiler({ now: () => { throw new Error('Unexpected clock read'); } });
  assert.equal(profiler.beginDraw(), null);
  assert.equal(profiler.beginFrame(10), null);
  profiler.setVisible(false);
  assert.equal(profiler.beginDraw(), null);
});

test('cache hits count as zero per-draw terrain cost and do not dilute execution percentiles', () => {
  let time = 0;
  const profiler = createRenderProfiler({ enabled: true, now: () => time });
  const first = profiler.beginDraw('snapshot');
  time = 6; first.mark('terrain');
  time = 8; first.mark('plants');
  time = 9; first.mark('roads');
  time = 10; first.end({ cacheRebuilt: true, context: { zoom: 1 } });
  time = 20;
  const hit = profiler.beginDraw('animation');
  time = 22; hit.mark('composition'); hit.end({ cacheRebuilt: false });
  time = 30;
  const third = profiler.beginDraw('event');
  time = 39; third.mark('terrain'); third.end({ cacheRebuilt: true });

  const report = profiler.snapshot({ includeSamples: true });
  assert.equal(report.map.samples, 3);
  assert.equal(report.map.stages.terrain.meanMs, 5);
  assert.equal(report.map.stages.terrain.executions, 2);
  assert.equal(report.map.stages.terrain.executionMeanMs, 7.5);
  assert.equal(report.map.stages.terrain.executionP95Ms, 9);
  assert.equal(report.map.cache.rebuilt, 2);
  assert.equal(report.map.cache.hits, 1);
  assert.deepEqual(report.map.sources, { snapshot: 1, animation: 1, event: 1 });
  for (const draw of report.samples.draws) {
    assert.equal(Object.values(draw.phases).reduce((sum, ms) => sum + ms, 0), draw.durationMs);
  }
  report.context.zoom = 100;
  report.samples.draws[0].phases.terrain = 100;
  assert.equal(profiler.snapshot().context.zoom, 1);
  assert.equal(profiler.snapshot().map.stages.terrain.meanMs, 5);
});

test('frame cadence keeps visible stalls and measures callback CPU separately', () => {
  let time = 0;
  const profiler = createRenderProfiler({ enabled: true, now: () => time });
  for (const timestamp of [0, 16, 32, 132]) {
    time = timestamp;
    const frame = profiler.beginFrame(timestamp);
    time += 2; frame.mark('atmosphere');
    time += 3; frame.end();
  }
  const report = profiler.snapshot();
  assert.equal(report.frames.samples, 3);
  assert.equal(report.frames.p50Ms, 16);
  assert.equal(report.frames.p95Ms, 100);
  assert.equal(report.frames.maxMs, 100);
  assert.equal(report.frames.fps, 1000 / 44);
  assert.equal(report.frames.cpu.meanMs, 5);
  assert.equal(report.frames.stages.atmosphere.meanMs, 2);
  assert.equal(report.map.samples, 0);
});

test('hidden-tab gaps are excluded without discarding visible stalls', () => {
  let time = 0;
  const profiler = createRenderProfiler({ enabled: true, now: () => time, windowMs: 20_000 });
  for (const timestamp of [0, 16]) { time = timestamp; profiler.beginFrame(timestamp).end(); }
  profiler.setVisible(false);
  time = 5000;
  assert.equal(profiler.beginFrame(time), null);
  assert.equal(profiler.beginDraw(), null);
  profiler.setVisible(true);
  for (const timestamp of [10_000, 10_016]) { time = timestamp; profiler.beginFrame(timestamp).end(); }
  const report = profiler.snapshot();
  assert.equal(report.frames.samples, 2);
  assert.equal(report.frames.maxMs, 16);
});

test('rolling samples obey both the time window and the memory cap', () => {
  let time = 0;
  const profiler = createRenderProfiler({ enabled: true, now: () => time, windowMs: 50, capacity: 3 });
  for (const timestamp of [0, 10, 20, 30]) { time = timestamp; profiler.beginDraw().end(); }
  assert.equal(profiler.snapshot().map.samples, 3);
  time = 75;
  assert.equal(profiler.snapshot().map.samples, 1);
  time = 100;
  assert.equal(profiler.snapshot().map.samples, 0);
  assert.equal(profiler.snapshot().map.drawsPerSecond, 0);
});

test('reset and disable discard unfinished measurements, and end is idempotent', () => {
  let time = 0;
  const profiler = createRenderProfiler({ enabled: true, now: () => time });
  const stale = profiler.beginDraw();
  profiler.reset();
  time = 1; stale.end();
  assert.equal(profiler.snapshot().map.samples, 0);
  const disabled = profiler.beginDraw();
  profiler.setEnabled(false);
  time = 2; disabled.end();
  profiler.setEnabled(true);
  const sample = profiler.beginDraw();
  time = 3; sample.end(); sample.end();
  assert.equal(profiler.snapshot().map.samples, 1);
});
