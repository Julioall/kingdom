// Pure interpretation of V8 sampling profiles, not a new game simulation.
// CPU sample shares identify hotspots but do not establish exact duration or
// causality; always compare equivalent scenarios and seeds.
export function summarizeCpuProfile(profile, limit = 40) {
  if (!profile || !Array.isArray(profile.nodes))
    throw new TypeError('Invalid Chrome/V8 CPU profile');
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const counts = new Map();
  if (Array.isArray(profile.samples) && profile.samples.length) {
    for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1);
  } else {
    for (const node of profile.nodes) if (Number.isFinite(node.hitCount) && node.hitCount > 0)
      counts.set(node.id, node.hitCount);
  }
  const aggregated = new Map();
  for (const [id, samples] of counts) {
    const node = byId.get(id);
    if (!node) continue;
    const frame = node.callFrame || {};
    const name = String(frame.functionName || '(anonymous)');
    const file = String(frame.url || '<native>').replace(/^.*\/src\//, 'src/');
    const line = Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null;
    const key = [name, file, line].join('|');
    const current = aggregated.get(key) || { name, file, line, samples: 0 };
    current.samples += samples;
    aggregated.set(key, current);
  }
  const totalSamples = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const safeLimit = Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000 ? limit : 40;
  const hotspots = [...aggregated.values()].sort((a, b) => b.samples - a.samples
    || a.name.localeCompare(b.name) || a.file.localeCompare(b.file)).slice(0, safeLimit).map(entry =>
    ({ ...entry, sharePercent: totalSamples ? +(entry.samples / totalSamples * 100).toFixed(2) : 0 }));
  return {
    schemaVersion: 1, totalSamples, observedNodes: profile.nodes.length,
    // Even many sampled executions on a single CPU are not browser FPS.
    note: 'Exclusive CPU sample distribution in Node/V8. Not frame p95, GPU cost or total simulation wall time.',
    hotspots
  };
}
