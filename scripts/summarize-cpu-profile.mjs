// Usage: node scripts/summarize-cpu-profile.mjs --input=out/npc.cpuprofile --output=out/summary.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { summarizeCpuProfile } from '../src/simulation/observability/cpu-profile-summary.js';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const equal = arg.indexOf('=');
  if (!arg.startsWith('--') || equal < 0) throw new Error('Expected --key=value');
  return [arg.slice(2, equal), arg.slice(equal + 1)];
}));
if (!options.input) throw new Error('Provide --input=path.cpuprofile');
const summary = summarizeCpuProfile(JSON.parse(await readFile(resolve(options.input), 'utf8')));
if (options.output) {
  const target = resolve(options.output);
  await mkdir(dirname(target), {recursive:true});
  await writeFile(target, JSON.stringify(summary, null, 2));
}
console.log(JSON.stringify(summary, null, 2));
