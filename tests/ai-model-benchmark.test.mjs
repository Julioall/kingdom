import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, createCsv, createDecisionSchema, createSummary, readOllamaNdjsonStream, validateDecision } from '../scripts/benchmark-ai-models.mjs';

test('JUL-221 benchmark covers nine baseline and four M8 scenarios', () => {
  assert.equal(SCENARIOS.length, 13);
  assert.equal(SCENARIOS.filter(scenario => scenario.kind === 'memory').length, 1);
  assert.equal(SCENARIOS.find(scenario => scenario.id === 'memory-continuity').turns.length, 3);
  for (const id of ['village-defense', 'supply-calculation', 'construction-sequence', 'diplomacy', 'conflicting-reports', 'builders-under-threat', 'transport-food', 'bridge-formation', 'memory-continuity', 'archer-capacity', 'authority-selection-version', 'ambiguous-north-tower', 'stale-world-response']) {
    assert.ok(SCENARIOS.some(scenario => scenario.id === id), `missing ${id}`);
  }
});

test('benchmark CSV keeps complete prompts and model outputs with proper quoting', () => {
  const csv = createCsv({ models: [{
    tag: 'qwen3.5:0.8b', digest: 'sha', resources: {},
    runs: [{ scenarioId: 'test', prompt: 'fato, com vírgula', response: 'linha 1\nlinha 2 "com aspas"', contractErrors: [] }]
  }] });
  assert.match(csv, /^\uFEFF/);
  assert.match(csv, /"fato, com vírgula"/);
  assert.match(csv, /"linha 1\nlinha 2 ""com aspas"""/);
});

test('Ollama stream reader records TTFT from a final chunk without a newline', async () => {
  const payload = new TextEncoder().encode('{"message":{"content":"{\\\"decision\\\":\\\"wait\\\"}"},"done":true}');
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(payload.slice(0, 17));
      controller.enqueue(payload.slice(17));
      controller.close();
    }
  }));
  const result = await readOllamaNdjsonStream(response);
  assert.equal(result.content, '{"decision":"wait"}');
  assert.equal(result.server.done, true);
  assert.ok(Number.isFinite(result.firstTokenMs));
});

test('benchmark summary reads the nested source SHA and leaves unavailable TTFT unavailable', () => {
  const summary = createSummary({
    startedAt: '2026-10-27T00:00:00.000Z', source: { gitSha: 'abc123' }, hardware: {},
    ollamaVersion: '0.0.0', scenarioCount: 1, repeats: 1, baseUrl: 'http://localhost',
    models: [{ tag: 'test', digest: null, runs: [{ totalDurationNs: 1_000_000_000, firstTokenMs: null }], resources: {} }]
  });
  assert.match(summary, /SHA inicial: abc123/);
  assert.match(summary, /\| 1\.00 \| 1\.00 \| 0 \| 0 \| n\/d \|/);
});

test('benchmark schema and validator reject outside actions, actors, stale versions, and executable ambiguity', () => {
  const scenario = SCENARIOS.find(value => value.id === 'authority-selection-version');
  const schema = createDecisionSchema(scenario);
  assert.deepEqual(schema.properties.actions.items.properties.id.enum, scenario.actions);
  const safe = {
    decision: 'execute', actions: [{ id: 'retreat-selected-group', actorIds: ['squad-archers'], targetId: null, worldVersion: 88, amount: null }],
    clarification: null, reason: 'Somente a seleção autorizada.'
  };
  assert.deepEqual(validateDecision(safe, scenario), []);
  assert.deepEqual(validateDecision({ ...safe, actions: [{ ...safe.actions[0], id: 'execute-free-text', actorIds: ['other-squad'], worldVersion: 87 }] }, scenario), ['action-outside-catalog', 'actor-outside-selection', 'world-version-mismatch']);
  assert.deepEqual(validateDecision({ ...safe, decision: 'clarify' }, scenario), ['non-executable-decision-has-actions']);
});
