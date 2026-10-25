import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const preview = process.argv.includes('--preview');
const root = process.cwd();
const node = process.execPath;
const vite = resolve(root, 'node_modules/vite/bin/vite.js');
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const service = spawn(node, [resolve(root, 'src/ai/ollama-service.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true });
children.push(service);
service.on('error', error => { console.error('Não foi possível iniciar o serviço de IA:', error.message); stop(1); });
service.on('exit', code => { if (!stopping && code !== 0) stop(code || 1); });

const viteArgs = [vite, ...(preview ? ['preview'] : []), '--host', '127.0.0.1'];
const web = spawn(node, viteArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
children.push(web);
web.on('error', error => { console.error('Não foi possível iniciar o servidor local do jogo:', error.message); stop(1); });
web.on('exit', code => { if (!stopping) stop(code || 0); });
