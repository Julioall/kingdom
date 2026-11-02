import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityDrawProbe, summarizeEntityDraws } from '../src/ui/entity-draw-probe.js';
import { createRenderProfiler } from '../src/ui/render-profiler.js';

test('disabled entity profiling cannot read a clock or change the painter loop', () => {
  const profiler = createRenderProfiler({ now: () => { throw Error('Disabled profiler must not tick'); } });
  assert.equal(profiler.beginDraw(), null);
  const order = ['tree', 'mineral', 'person', 'tree', 'effect'];
  assert.deepEqual(order.map(item => item), order);
  assert.throws(() => createEntityDrawProbe({ sampleEvery: 0 }), /positive integer/);
});

test('rotating 1-in-4 samples cover even sparse categories across frames', () => {
  let time = 0;
  const probe = createEntityDrawProbe({ sampleEvery: 4, now: () => time });
  const draws = [];
  const order = ['tree', 'person', 'tree', 'animal', 'effect'];
  for (let frame = 0; frame < 8; frame++) {
    const currentOrder = [];
    const capture = probe.beginFrame();
    for (const kind of order) {
      const started = capture.begin(kind);
      currentOrder.push(kind);
      time += kind === 'tree' ? 3 : 1;
      capture.end(kind, started);
    }
    assert.deepEqual(currentOrder, order, 'sampling never changes order or skips sprites');
    draws.push({ entityBreakdown: capture.finish() });
  }
  const report = summarizeEntityDraws(draws);
  assert.equal(report.measuredFrames, 8);
  assert.equal(report.categories.tree.count, 16);
  assert.equal(report.categories.tree.samples, 4);
  assert.equal(report.categories.tree.meanSampledItemMs, 3);
  assert.equal(report.categories.tree.estimatedMsPerDraw, 6);
  for (const kind of ['person', 'animal', 'effect']) {
    assert.equal(report.categories[kind].count, 8);
    assert.equal(report.categories[kind].samples, 2);
    assert.equal(report.categories[kind].estimatedMsPerDraw, 1);
  }
  assert.equal(report.categories.mineral, undefined);
});

test('sample stats are isolated, aggregate exactly, and stay out of regular profiler records', () => {
  let time = 0;
  const profiler = createRenderProfiler({ enabled: true, now: () => time });
  const plain = profiler.beginDraw();
  time = 2;
  plain.end();
  const withProbe = profiler.beginDraw();
  const probe = createEntityDrawProbe({ sampleEvery: 1, now: () => time }).beginFrame();
  const started = probe.begin('mineral');
  time = 4;
  probe.end('mineral', started);
  withProbe.setEntityBreakdown(probe.finish());
  time = 6;
  withProbe.end();
  const report = profiler.snapshot({ includeSamples: true });
  assert.equal(report.map.entityBreakdown.measuredFrames, 1);
  assert.equal(report.map.entityBreakdown.categories.mineral.count, 1);
  assert.equal(report.map.entityBreakdown.categories.mineral.estimatedMsPerDraw, 2);
  assert.equal(report.samples.draws[0].entityBreakdown, undefined);
  assert.equal(report.samples.draws[1].entityBreakdown.mineral.count, 1);
  report.map.entityBreakdown.categories.mineral.count = 1000;
  report.samples.draws[1].entityBreakdown.mineral.count = 900;
  assert.equal(profiler.snapshot().map.entityBreakdown.categories.mineral.count, 1,
    'report mutations must not modify recorded profiler samples');
});

test('empty/unsampled summaries never claim measured timings', () => {
  const empty = summarizeEntityDraws([]);
  assert.deepEqual(empty.categories, {});
  assert.equal(empty.measuredFrames, 0);
  const partial = summarizeEntityDraws([{ entityBreakdown: { structure: {
    count: 3, samples: 0, sampledMs: 0 } } }]);
  assert.equal(partial.categories.structure.count, 3);
  assert.equal(partial.categories.structure.estimatedMsPerDraw, null);
});
