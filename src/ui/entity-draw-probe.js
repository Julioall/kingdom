// JUL-288: opt-in stratified CPU sampling of Canvas paint items.
// Counts are exact per category; timings are estimates based on 1/N sampled
// draw calls. Keep this disabled outside diagnostic sessions, as performance.now
// and instrumentation themselves add measurable overhead.
export function createEntityDrawProbe({ sampleEvery = 16, now = () => performance.now() } = {}) {
  if (!Number.isSafeInteger(sampleEvery) || sampleEvery < 1) {
    throw new Error('sampleEvery must be a positive integer');
  }
  let frameNumber = 0;
  return {
    beginFrame() {
      const offset = frameNumber++ % sampleEvery;
      const categories = Object.create(null);
      return {
        begin(kind) {
          let entry = categories[kind];
          if (!entry) entry = categories[kind] = { count: 0, samples: 0, sampledMs: 0 };
          entry.count++;
          // Rotate the sample position across frames so categories with
          // fewer than sampleEvery items also receive representative samples.
          return (entry.count + offset) % sampleEvery === 0 ? now() : null;
        },
        end(kind, startedAt) {
          if (startedAt === null) return;
          const entry = categories[kind];
          if (!entry) throw new Error('Entity draw sample has no category');
          entry.samples++;
          entry.sampledMs += Math.max(0, now() - startedAt);
        },
        finish() {
          // Return a detached plain object for the rolling profiler buffer.
          return Object.fromEntries(Object.entries(categories).map(([name, entry]) =>
            [name, { ...entry }]));
        },
      };
    },
  };
}

export function summarizeEntityDraws(draws) {
  const categories = Object.create(null);
  let measuredFrames = 0;
  for (const draw of draws) {
    if (!draw.entityBreakdown) continue;
    measuredFrames++;
    for (const [kind, record] of Object.entries(draw.entityBreakdown)) {
      let total = categories[kind];
      if (!total) total = categories[kind] = { count: 0, samples: 0, sampledMs: 0 };
      total.count += record.count;
      total.samples += record.samples;
      total.sampledMs += record.sampledMs;
    }
  }
  return {
    measuredFrames,
    sampleMethod: '1/N rotating stratified item samples. Draw counts are exact; estimatedMsPerDraw extrapolates sampled synchronous Canvas CPU time, excludes unsampled magic/ground/blood overlays and GPU execution. Diagnostic instrumentation changes timings.',
    categories: Object.fromEntries(Object.entries(categories).map(([kind, values]) => {
      const meanItemMs = values.samples ? values.sampledMs / values.samples : null;
      return [kind, { count: values.count, averageCountPerDraw: measuredFrames ? values.count / measuredFrames : 0,
        samples: values.samples, sampleCpuMs: values.sampledMs,
        meanSampledItemMs: meanItemMs,
        estimatedMsPerDraw: meanItemMs === null || !measuredFrames ? null
          : meanItemMs * values.count / measuredFrames }];
    })),
  };
}
