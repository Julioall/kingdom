import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AI_MODEL_MANIFEST } from '../src/ai/model-manifest.js';

function parseArgs(args) {
  const result = { pull: false, roles: Object.keys(AI_MODEL_MANIFEST.models) };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--pull') result.pull = true;
    else if (value === '--check') result.check = true;
    else if (value === '--role') {
      const role = args[++index];
      if (!AI_MODEL_MANIFEST.models[role]) throw new Error('Papel desconhecido. Use king ou general.');
      result.roles = [role];
    } else if (value === '--help' || value === '-h') result.help = true;
    else throw new Error('Opção desconhecida: ' + value);
  }
  return result;
}

function localOllamaBase() {
  const raw = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'http://' + raw);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (url.protocol !== 'http:' || !(hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname))) {
    throw new Error('Por segurança, OLLAMA_HOST deve usar HTTP em loopback (127.0.0.1 ou ::1).');
  }
  return url.origin;
}

async function api(base, path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ollama respondeu HTTP ' + response.status + '.');
  return payload;
}

async function pullModel(base, name) {
  console.log('Baixando ' + name + ' pelo Ollama; o progresso abaixo é informado pelo runtime.');
  const response = await fetch(base + '/api/pull', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, stream: true })
  });
  if (!response.ok || !response.body) throw new Error('Não foi possível iniciar o download de ' + name + '.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastLine = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      const total = Number(item.total) || 0, completed = Number(item.completed) || 0;
      const percent = total ? ' ' + (100 * completed / total).toFixed(1) + '%' : '';
      const status = String(item.status || 'baixando') + percent;
      if (status !== lastLine) { process.stdout.write('\r' + name + ': ' + status.padEnd(52)); lastLine = status; }
      if (item.error) throw new Error(String(item.error));
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const item = JSON.parse(buffer);
    if (item.error) throw new Error(String(item.error));
  }
  process.stdout.write('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Uso: npm run ai:prepare [-- --check] [--pull] [--role king|general]');
    console.log('Ollama precisa estar instalado e em execução. --pull baixa os modelos definidos no manifesto.');
    return;
  }
  const version = spawnSync('ollama', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (version.error || version.status !== 0) throw new Error('O executável Ollama não foi encontrado. Instale-o e abra o Ollama antes de preparar os modelos.');
  console.log(String(version.stdout || version.stderr || '').trim());
  const base = localOllamaBase();
  let tags;
  try { tags = await api(base, '/api/tags'); }
  catch (_) { throw new Error('Ollama instalado, mas o servidor não responde. Abra o Ollama ou execute “ollama serve”.'); }
  let installed = Array.isArray(tags.models) ? tags.models : [];

  for (const role of options.roles) {
    const model = AI_MODEL_MANIFEST.models[role];
    const present = installed.some(item => item.name === model.model || item.model === model.model);
    if (!present && options.pull) {
      await pullModel(base, model.model);
      tags = await api(base, '/api/tags');
      installed = Array.isArray(tags.models) ? tags.models : [];
    }
    const match = installed.find(item => item.name === model.model || item.model === model.model);
    console.log(JSON.stringify({
      role, model: model.model, installed: !!match,
      digest: match && match.digest || null,
      quantization: match && match.details && match.details.quantization_level || null,
      sizeBytes: match && Number.isFinite(match.size) ? match.size : null,
      contextTokens: model.contextTokens,
      outputTokenCandidates: model.outputTokenCandidates,
      selectedOutputTokens: model.selectedOutputTokens
    }, null, 2));
  }

  const record = {
    checkedAt: new Date().toISOString(),
    ollamaVersion: String(version.stdout || version.stderr || '').trim(),
    ollamaHost: base,
    models: options.roles.map(role => {
      const model = AI_MODEL_MANIFEST.models[role];
      const match = installed.find(item => item.name === model.model || item.model === model.model);
      return {
        role, model: model.model, installed: !!match,
        digest: match && match.digest || null,
        quantization: match && match.details && match.details.quantization_level || null,
        sizeBytes: match && Number.isFinite(match.size) ? match.size : null
      };
    })
  };
  const target = resolve('.local/ai-model-installation.json');
  await mkdir(resolve('.local'), { recursive: true });
  await writeFile(target, JSON.stringify(record, null, 2) + '\n', 'utf8');
  const missing = record.models.filter(model => !model.installed);
  if (missing.length) {
    console.log('Modelos ausentes: ' + missing.map(model => model.model).join(', '));
    console.log('Execute “npm run ai:prepare -- --pull” para baixar pelo Ollama. Pesos ficam fora do Git.');
    process.exitCode = 2;
  } else console.log('Preparação local salva em .local/ai-model-installation.json');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
