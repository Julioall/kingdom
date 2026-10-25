import LocalAI from '../../src/ai/local-engine.js';

export function schemaFor(actions) {
  return { type: 'object', properties: {
    action: { type: 'string', enum: actions },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', minLength: 1 },
  }, required: ['action', 'confidence', 'reason'], additionalProperties: false };
}

export function evaluate(raw, scenario, doneReason = 'stop') {
  const actions = scenario.context.choices.map(choice => choice.id);
  let value;
  try { value = JSON.parse(raw); } catch { /* Raw output remains available for review. */ }
  const jsonValid = value !== null && typeof value === 'object' && !Array.isArray(value);
  const schemaValid = jsonValid && Object.keys(value).length === 3
    && actions.includes(value.action) && Number.isFinite(value.confidence)
    && value.confidence >= 0 && value.confidence <= 1
    && typeof value.reason === 'string' && value.reason.trim().length > 0;
  let parsed;
  try { parsed = LocalAI.parseStrategicDecision(raw, actions); } catch { /* Count as failure. */ }
  const correct = !!parsed && scenario.expected.includes(parsed.action);
  const truncated = doneReason === 'length';
  return { jsonValid, schemaValid, gameParserAccepts: !!parsed,
    action: parsed?.action ?? null, correct, truncated,
    success: schemaValid && correct && !truncated };
}

export function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

export function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.model, row.role, row.mode]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(group => {
    const good = group.filter(row => !row.error);
    const rate = key => 100 * group.filter(row => row[key]).length / group.length;
    const correctActions = group.filter(row => row.correct).length;
    const usableDecisions = group.filter(row => row.success).length;
    const wallMs = group.reduce((sum, row) => sum + (Number.isFinite(row.wallMs) ? row.wallMs : 0), 0);
    const wallSeconds = wallMs / 1000;
    const tokens = good.reduce((n, row) => n + (row.metrics.eval_count || 0), 0);
    const duration = good.reduce((n, row) => n + (row.metrics.eval_duration || 0), 0);
    const resources = group.find(row => row.resources)?.resources || {};
    const bytesToMb = value => Number.isFinite(value) ? value / 1_000_000 : null;
    return { model: group[0].model, role: group[0].role, mode: group[0].mode,
      cases: group.length, errors: group.length - good.length,
      successPct: rate('success'), correctPct: rate('correct'), schemaPct: rate('schemaValid'),
      parserPct: rate('gameParserAccepts'), truncatedPct: rate('truncated'),
      correctActions, usableDecisions, wallSeconds,
      correctActionsPerMinute: wallSeconds > 0 ? correctActions * 60 / wallSeconds : null,
      usableDecisionsPerMinute: wallSeconds > 0 ? usableDecisions * 60 / wallSeconds : null,
      secondsPerCorrectAction: correctActions ? wallSeconds / correctActions : null,
      secondsPerUsableDecision: usableDecisions ? wallSeconds / usableDecisions : null,
      modelDiskMb: bytesToMb(resources.modelDiskBytes),
      ollamaLoadedMb: bytesToMb(resources.ollamaLoadedBytes),
      ollamaVramMb: bytesToMb(resources.ollamaVramBytes),
      processPeakRamMb: percentile(good.map(row => row.processMetrics?.peakWorkingSetMb)
        .filter(Number.isFinite), .95),
      medianCpuMs: percentile(good.map(row => row.processMetrics?.cpuMs).filter(Number.isFinite), .5),
      medianCpuPercent: percentile(good.map(row => row.processMetrics?.cpuPercentOneCore)
        .filter(Number.isFinite), .5),
      usableDecisionsPerCpuSecond: (() => {
        const cpuMs = good.reduce((sum, row) => sum + (row.processMetrics?.cpuMs || 0), 0);
        return cpuMs > 0 ? usableDecisions * 1000 / cpuMs : null;
      })(),
      cpuSecondsPerCorrectAction: correctActions
        ? good.reduce((sum, row) => sum + (row.processMetrics?.cpuMs || 0), 0) / 1000 / correctActions : null,
      ollamaProcessor: resources.ollamaProcessor ?? null,
      medianMs: percentile(good.map(row => row.wallMs), .5),
      p95Ms: percentile(good.map(row => row.wallMs), .95),
      tokensPerSecond: duration > 0 ? tokens / (duration / 1e9) : null };
  }).sort((a, b) => a.role.localeCompare(b.role) || a.mode.localeCompare(b.mode)
    || b.successPct - a.successPct || (a.medianMs ?? Infinity) - (b.medianMs ?? Infinity));
}
