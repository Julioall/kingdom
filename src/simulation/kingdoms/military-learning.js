import { brainForward, createBrain, updateBrain } from '../../controllers/individual/neural.js';
import { clamp, distance } from '../core/math.js';
import { moveOne } from '../individuals/movement.js';
import { consumePersonEnergy } from '../individuals/energy.js';

export const MILITARY_ACTIONS = ['guard', 'patrol', 'train', 'campaign', 'drink', 'rest', 'return_garrison'];

const fitForTraining = p => p.alive && p.role === 'soldier' && p.campaignId == null
  && !p.militaryReturningHome && !p.towerDutyId && !p.towerMounted && !p.tacticalRecovering
  && p.militaryRestTargetId == null && p.restingStructureId == null
  && p.health >= 85 && p.energy >= 70 && p.foodReserve >= 35 && p.hydration >= 45 && p.injury < 2;

export function militaryTrainingPairs(world) {
  const pairs = new Map();
  for (const center of world.structures.filter(s => s.complete && s.type === 'centro_militar'
    && s.destroyedDay == null && s.integrity !== 0)) {
    const kingdom = world.kingdoms.find(k => k.id === center.kingdomId);
    if (kingdom?.frontierAlert && world.day - kingdom.frontierAlert.day <= 10
      || (world.wars || []).some(w => w.status === 'active' && [w.attackerId, w.defenderId].includes(center.kingdomId))) continue;
    const roster = world.people.filter(p => fitForTraining(p) && p.kingdomId === center.kingdomId
      && (p.militaryDutyCenterId || p.militaryCenterId) === center.id).sort((a, b) => a.id - b.id);
    if (roster.length < 3) continue;
    const offset = Math.floor(world.day / 10) % roster.length;
    const rotated = roster.slice(offset).concat(roster.slice(0, offset));
    const count = Math.floor(Math.min(roster.length - 1, Math.max(2, roster.length / 3)) / 2) * 2;
    for (let i = 0; i < count; i += 2) {
      pairs.set(rotated[i].id, { partner: rotated[i + 1], center });
      pairs.set(rotated[i + 1].id, { partner: rotated[i], center });
    }
  }
  return pairs;
}

export function chooseMilitaryAction(world, person, options) {
  const inputs = [person.energy / 100, person.health / 100, person.hydration / 100,
    person.foodReserve / 100, person.militaryTraining || 0, options.training ? 1 : 0,
    options.patrol ? 1 : 0, options.campaign ? 1 : 0];
  const brain = person.militaryBrain ||= createBrain(world, MILITARY_ACTIONS, inputs.length, person.id);
  const utility = options.campaign ? { campaign: 1 } : options.resupply ? { return_garrison: 1 }
    : options.thirst ? { drink: 1 } : { guard: .28, ...(person.energy < 70 ? { rest: .25 + (70 - person.energy) * .015 } : {}), ...(options.patrol ? { patrol: .48 } : {}),
      ...(options.training ? { train: .65 + (1 - (person.militaryTraining || 0)) * .2 } : {}) };
  const out = brainForward(brain, inputs, MILITARY_ACTIONS);
  const scores = MILITARY_ACTIONS.map((action, i) => utility[action] == null ? -1e9
    : utility[action] + out.logits[i] * .25 + (brain.actionValues[i] || 0) * .15);
  const best = scores.indexOf(Math.max(...scores));
  const maxLogit = Math.max(...out.logits.filter((_, i) => utility[MILITARY_ACTIONS[i]] != null));
  const weights = out.logits.map((v, i) => utility[MILITARY_ACTIONS[i]] == null ? 0 : Math.exp(v - maxLogit));
  const total = weights.reduce((sum, v) => sum + v, 0);
  brain.pending = { hidden: out.hidden, probs: weights.map(v => v / total), inputs, actionIndex: best };
  brain.decisions++;
  brain.lastAction = MILITARY_ACTIONS[best];
  brain.actionCounts[brain.lastAction]++;
  person.brain.lastAction = brain.lastAction;
  person.lastDecision = { action: brain.lastAction, actions: MILITARY_ACTIONS.slice(), scores, inputs, day: world.day };
  return brain.lastAction;
}

export function learnMilitaryOutcome(person, reward) {
  if (!person.militaryBrain?.pending) return;
  const sample = { brain: person.militaryBrain, lastLesson: person.lastLesson };
  updateBrain(sample, clamp(reward, -.8, .8));
  person.lastReward = sample.lastReward;
}

export function trainMilitaryPair(world, person, session) {
  if (!session || !fitForTraining(person) || !fitForTraining(session.partner)) return false;
  const { partner, center } = session;
  person.militaryTrainingPartnerId = partner.id;
  if (distance(person, center) > 3 || distance(person, partner) > 3) {
    const target = { x: center.x + (person.id < partner.id ? -1 : 1), y: center.y };
    moveOne(world, person, target, false, { arrivalRadius: 1 });
    person.state = 'indo ao treino de combate simulado';
    return false;
  }
  consumePersonEnergy(person, .6);
  person.militaryTraining = Math.min(1, (person.militaryTraining || 0) + .01);
  person.simulatedCombatDays = (person.simulatedCombatDays || 0) + 1;
  person.militaryAnimation = person.militaryClass === 'monge' ? 'idle' : 'attack';
  person.militaryAnimationDay = world.day;
  person.militaryFacingX = partner.x - person.x;
  person.militaryFacingY = partner.y - person.y;
  person.state = 'treinando combate simulado';
  person.lastLesson = 'O exercício com um colega melhorou o preparo militar sem dano real, munição ou mana.';
  return true;
}
