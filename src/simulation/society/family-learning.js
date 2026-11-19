import { distance } from '../core/math.js';
import { HUMAN_ADOLESCENT_AGE_DAYS } from '../individuals/human-age.js';

// Education is observation plus real care, not genetic skill copying and not
// neural-weight inheritance. Experience must originate with the mentor's
// performed work and be seen by a nearby dependent.
const OBSERVABLE_WORK = Object.freeze({
  harvest: 'forage',
  forage: 'forage',
  fish: 'forage',
  hunt: 'hunt',
  chop: 'gather',
  mine: 'gather',
  build: 'build',
  repair: 'build',
  care: 'care'
});
const MAX_TEACHING_DISTANCE = 4;
const LEARNING_GAIN_PER_OBSERVATION = .006;

export function observeFamilyWork(world, child, mentor) {
  if (!child?.alive || !mentor?.alive || child.id === mentor.id
    || child.ageDays >= HUMAN_ADOLESCENT_AGE_DAYS
    || !((child.parents || []).includes(mentor.id) || child.guardianId === mentor.id)
    || distance(child, mentor) > MAX_TEACHING_DISTANCE
    || mentor.foodReserve < 10 || mentor.health < 20) return false;

  const demonstration = mentor.visualActivity;
  const skill = OBSERVABLE_WORK[demonstration?.kind];
  const day = world.day + 1;
  if (!skill || !Number.isInteger(demonstration.day)
    || demonstration.day !== day) return false;

  const teacherLevel = Number(mentor.skills?.[skill]);
  const current = Number(child.skills?.[skill]);
  if (!Number.isFinite(teacherLevel) || !Number.isFinite(current)
    || teacherLevel <= current) return false;

  const ledger = child.familyLearning || (child.familyLearning = {});
  const previous = ledger[skill];
  if (previous?.lastObservedDay === day) return false;
  const gained = Math.min(teacherLevel - current, LEARNING_GAIN_PER_OBSERVATION);
  child.skills[skill] = Math.min(1, current + gained);
  ledger[skill] = {
    fromPersonId: mentor.id,
    observations: (previous?.observations || 0) + 1,
    lastObservedDay: day,
    lastDemonstration: demonstration.kind
  };
  return true;
}

export function familyKnowledgeReport(person) {
  return Object.entries(person?.familyLearning || {})
    .filter(([skill, row]) => skill in (person.skills || {}) && row.observations > 0)
    .map(([skill, row]) => ({ skill, mentorId: row.fromPersonId,
      observations: row.observations, lastObservedDay: row.lastObservedDay,
      currentSkill: person.skills[skill] }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}
