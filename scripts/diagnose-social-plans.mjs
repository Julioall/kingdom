import { writeFileSync } from 'node:fs';
import engine from '../src/simulation/engine.js';
import { renderSocialInspectorSections } from '../src/ui/social-inspector.js';

// Read-only diagnostic: replay the normal engine without overriding decisions or resources.
const seed = Number(process.argv[2] || 42);
const days = Number(process.argv[3] || 120);
const name = process.argv[4] || 'Oru P';
const output = process.argv[5] || 'reports/social-plan-investigation-seed42.json';
if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff
    || !Number.isSafeInteger(days) || days < 1) throw new Error('Use seed uint32 e dias positivos.');
const world = engine.createWorld(seed);
const person = world.people.find(candidate => candidate.name === name);
if (!person) throw new Error('Pessoa não encontrada: ' + name);
const trace = [];
const openPlanDaysByRole = {};
for (let index = 0; index < days; index++) {
  const executedDay = world.day;
  engine.stepDay(world, { includeSnapshot: false });
  for (const candidate of world.people) {
    if (!candidate.alive || !(candidate.socialIntentions || []).some(plan => plan.type === 'seek_food_aid'
      && ['active', 'suspended'].includes(plan.status))) continue;
    const actions = openPlanDaysByRole[candidate.role] ||= {};
    const action = candidate.lastDecision?.action || 'none';
    actions[action] = (actions[action] || 0) + 1;
  }
  const plan = person.socialIntentions?.at(-1);
  if (!plan) continue;
  const helper = world.people.find(candidate => String(candidate.id) === String(plan.targetId));
  const sighting = person.perception?.people?.find(candidate => String(candidate.id) === String(plan.targetId));
  trace.push({ executedDay, snapshotDay: world.day, role: person.role, alive: person.alive,
    action: person.lastDecision?.action, scoredDecision: person.lastDecision?.scores != null,
    state: person.state, food: person.foodReserve, hydration: person.hydration, energy: person.energy,
    position: { x: person.x, y: person.y },
    assignment: person.assignment ? { action: person.assignment.action, source: person.assignment.source,
      expiresDay: person.assignment.expiresDay, pauseReason: person.assignment.pauseReason } : null,
    plan: { id: plan.intentionId, created: plan.createdDay, due: plan.dueDay, status: plan.status,
      progress: plan.progress, blockers: plan.blockers, reason: plan.terminationReason },
    helper: helper ? { id: helper.id, name: helper.name, alive: helper.alive,
      distanceAfterActions: Math.hypot(helper.x - person.x, helper.y - person.y),
      visibleAtObservation: sighting?.visible, surplusAtObservation: sighting?.visibleSignals?.foodSurplus } : null
  });
}
const commitments = (world.socialEvidence?.commitments || []).map(entry => entry.record)
  .filter(record => record.parties.includes(String(person.id)));
const openDays = trace.filter(row => ['active', 'suspended'].includes(row.plan.status));
const actions = openDays.reduce((counts, row) => {
  counts[row.action] = (counts[row.action] || 0) + 1;
  return counts;
}, {});
const aidPlanOutcomes = {};
for (const candidate of world.people) for (const plan of candidate.socialIntentions || []) {
  if (plan.type !== 'seek_food_aid') continue;
  const key = candidate.role + ':' + plan.status;
  aidPlanOutcomes[key] = (aidPlanOutcomes[key] || 0) + 1;
}
const commitmentOutcomes = {};
for (const entry of world.socialEvidence?.commitments || []) {
  const status = entry.record.status;
  commitmentOutcomes[status] = (commitmentOutcomes[status] || 0) + 1;
}
const summary = { seed, days, person: { id: person.id, name: person.name, role: person.role, alive: person.alive },
  plans: (person.socialIntentions || []).map(plan => ({ id: plan.intentionId, created: plan.createdDay,
    due: plan.dueDay, progress: plan.progress, status: plan.status, reason: plan.terminationReason })),
  openDays: openDays.length, actions, openPlanDaysByRole, aidPlanOutcomes, commitmentOutcomes,
  reportedMemories: world.people.reduce((sum, candidate) => sum
    + (candidate.socialMemories || []).filter(memory => memory.source === 'reported').length, 0) };
writeFileSync(output, JSON.stringify({ ...summary, trace, plans: person.socialIntentions, commitments }, null, 2));
// Optional production-renderer preview, generated from this exact replay rather than synthetic UI state.
if (process.argv[6]) {
  const example = world.people.filter(candidate => (candidate.socialIntentions || []).some(plan => plan.status === 'completed'
    && plan.type === 'seek_food_aid')).sort((a, b) => (b.socialIntentions?.length || 0) - (a.socialIntentions?.length || 0))
    .find(candidate => renderSocialInspectorSections(candidate, world).planSection.includes('concluído')) || person;
  const sections = renderSocialInspectorSections(example, world);
  const safeName = String(example.name).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  writeFileSync(process.argv[6], '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Planos sociais — replay verificado</title>'
    + '<link rel="stylesheet" href="/src/ui/styles/main.css"><style>body{margin:0;background:#d9d5ba;font-family:Arial,sans-serif}'
    + '.right-panel{display:block!important;opacity:1!important;transform:none!important;position:relative!important;inset:auto!important;'
    + 'margin:20px auto;width:390px;color:#4b3928;background:#eadbbc;max-height:none!important;padding:18px;box-sizing:border-box}'
    + '.inspector{overflow:visible!important;max-height:none!important}</style><body><aside class="right-panel">'
    + '<small>REPLAY REAL · SEED ' + seed + ' · DIA ' + world.day + '</small><h2>' + safeName + '</h2>'
    + '<p>Renderizador de produção; estado dos planos neste replay. Não é a sessão original de Oru J.</p>'
    + '<div class="inspector">' + sections.planSection + sections.commitmentSection + sections.memorySection + sections.beliefSection
    + '</div></aside></body></html>');
}
console.log(JSON.stringify(summary, null, 2));
