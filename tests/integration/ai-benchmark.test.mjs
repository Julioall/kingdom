import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../../scripts/ai-benchmark/scenarios.mjs';
import { evaluate, summarize } from '../../scripts/ai-benchmark/evaluate.mjs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('benchmark fixtures have unique IDs and reachable editorial answers', () => {
  assert.equal(new Set(scenarios.map(s => s.id)).size, scenarios.length);
  for (const scenario of scenarios) {
    const actions = scenario.context.choices.map(c => c.id);
    assert.ok(scenario.expected.length > 0);
    for (const expected of scenario.expected) assert.ok(actions.includes(expected), scenario.id);
    const answer = JSON.stringify({ action: scenario.expected[0], confidence: .8, reason: 'Decisão baseada no relatório.' });
    assert.equal(evaluate(answer, scenario).success, true);
    assert.ok(!JSON.stringify(scenario.context).includes(scenario.rationale));
  }
});

test('scoring separates correct choice, parser fallback, contract and truncation', () => {
  const scenario = scenarios[0];
  const action = scenario.expected[0];
  const plain = evaluate(action, scenario);
  assert.equal(plain.correct, true);
  assert.equal(plain.gameParserAccepts, true);
  assert.equal(plain.success, false);
  assert.equal(evaluate(JSON.stringify({ action, confidence: 2, reason: 'Teste' }), scenario).success, false);
  assert.equal(evaluate(JSON.stringify({ action, confidence: .5, reason: 'Teste', extra: 1 }), scenario).success, false);
  assert.equal(evaluate(JSON.stringify({ action, confidence: .5, reason: 'Teste' }), scenario, 'length').success, false);
  assert.equal(evaluate('{"action":"invented","confidence":0.5,"reason":"Teste"}', scenario).correct, false);
  assert.equal(evaluate('null', scenario).success, false);
});

test('summary includes request errors in the score denominator', () => {
  const base = { model: 'test', role: 'king', mode: 'plain' };
  const [summary] = summarize([
    { ...base, success: true, correct: true, schemaValid: true, gameParserAccepts: true,
      wallMs: 100, metrics: { eval_count: 20, eval_duration: 1e9 } },
    { ...base, error: 'timeout', wallMs: 1000, success: false },
  ]);
  assert.equal(summary.successPct, 50);
  assert.equal(summary.errors, 1);
  assert.equal(summary.medianMs, 100);
  assert.equal(summary.tokensPerSecond, 20);
});

test('CLI sends isolated requests and saves complete reports against an Ollama fixture', async () => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const data = body ? JSON.parse(body) : null;
    calls.push({ path: request.url, data });
    let result = {};
    if (request.url === '/api/tags') result = { models: [{ name: 'fixture:1' }] };
    if (request.url === '/api/version') result = { version: 'fixture' };
    if (request.url === '/api/ps') result = { models: [] };
    if (request.url === '/api/chat') {
      let action = 'hold';
      if (data.messages.length === 2) action = JSON.parse(data.messages[1].content).choices[0].id;
      result = { message: { content: JSON.stringify({ action, confidence: .5, reason: 'Teste.' }) },
        done_reason: 'stop', eval_count: 10, eval_duration: 1e8 };
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const temp = await mkdtemp(join(tmpdir(), 'kingdom-ai-benchmark-'));
  const out = join(temp, 'run');
  try {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../../scripts/benchmark-ollama.mjs', import.meta.url)),
      '--models', 'fixture:1', '--host', `http://127.0.0.1:${server.address().port}`,
      '--role', 'general', '--repeats', '2', '--out', out,
    ], { timeout: 10000 });
    const rows = (await readFile(join(out, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 32);
    assert.deepEqual([...new Set(rows.map(row => row.seed))], [2026, 2027]);
    const requests = calls.filter(call => call.path === '/api/chat' && call.data.messages.length === 2);
    assert.equal(requests.length, 32);
    assert.equal(requests.filter(call => call.data.format).length, 16);
    assert.ok(requests.every(call => !call.data.messages[1].content.includes('expected')));
    assert.ok(calls.some(call => call.path === '/api/generate' && call.data.keep_alive === 0));
    const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.length, 2);
    assert.ok(summary.every(group => group.cases === 16 && group.errors === 0));
    const metadata = JSON.parse(await readFile(join(out, 'metadata.json'), 'utf8'));
    assert.ok(metadata.finishedAt);
    assert.equal(metadata.version.version, 'fixture');
    assert.match(await readFile(join(out, 'report.md'), 'utf8'), /fixture:1/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
