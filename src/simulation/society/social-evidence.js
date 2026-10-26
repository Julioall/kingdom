export const SOCIAL_EVIDENCE_SCHEMA_VERSION = 1;
export const SOCIAL_RECORD_SCHEMA_VERSIONS = Object.freeze({
  fact: 1, memory: 1, belief: 1, relationship: 1, commitment: 1, intention: 1
});
export const SOCIAL_FACT_RETENTION_DAYS = 365;
export const SOCIAL_MEMORY_PER_PERSON_LIMIT = 32;
export const SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT = 16;
export const SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT = 3;
export const SOCIAL_FACT_LIMIT = 512;
const REFERENCE_COLLECTIONS = Object.freeze({
  person: ['people'], animal: ['animals'], community: ['communities'], kingdom: ['kingdoms'],
  structure: ['structures'], settlement: ['settlements']
});

function fail(message) {
  throw new Error('Evidência social inválida: ' + message);
}

function idKey(value, field) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  fail(field + ' deve ser um ID inteiro ou texto não vazio.');
}

function entityExists(world, id) {
  return ['people', 'animals', 'communities', 'kingdoms', 'structures', 'settlements'].some(collection =>
    (world[collection] || []).some(entity => String(entity.id) === id));
}

function freezeRecursively(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeRecursively(child);
  return Object.freeze(value);
}

function uniqueKnownIds(world, values, field) {
  if (!Array.isArray(values)) fail(field + ' deve ser uma lista.');
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const id = idKey(value, field);
    if (!entityExists(world, id)) fail(field + ' referencia ID inexistente: ' + id + '.');
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function uniqueKnownPersonIds(world, values, field) {
  const ids = uniqueKnownIds(world, values, field);
  for (const id of ids) {
    if (!(world.people || []).some(person => String(person.id) === id)) fail(field + ' só pode apontar para pessoas.');
  }
  return ids;
}

function cloneJson(value, field) {
  const seen = new WeakSet();
  const encode = item => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail(field + ' não aceita NaN ou infinito.');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') fail(field + ' deve conter apenas dados JSON.');
    if (seen.has(item)) fail(field + ' não aceita referências cíclicas.');
    seen.add(item);
    const result = Array.isArray(item)
      ? '[' + item.map(encode).join(',') + ']'
      : '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}';
    seen.delete(item);
    return result;
  };
  try { return JSON.parse(encode(value)); }
  catch (error) {
    if (String(error?.message || '').startsWith('Evidência social inválida:')) throw error;
    fail(field + ' não pode ser serializado: ' + error.message);
  }
}

function ensureEvidence(world) {
  if (!world || !Number.isSafeInteger(world.seed) || !Number.isSafeInteger(world.day)) {
    fail('o mundo precisa de seed e dia inteiros.');
  }
  const worldEpoch = world.simulationEpoch ?? 0;
  if (!Number.isSafeInteger(worldEpoch) || worldEpoch < 0) fail('simulationEpoch deve ser um inteiro não negativo.');
  if (!world.socialEvidence) {
    world.socialEvidence = {
      schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION, worldSeed: world.seed, worldEpoch,
      nextFactNumber: 1, nextBeliefNumber: 1,
      nextCommitmentNumber: 1, nextIntentionNumber: 1, facts: [], commitments: [], idempotency: {}
    };
  }
  const evidence = world.socialEvidence;
  if (evidence.schemaVersion !== SOCIAL_EVIDENCE_SCHEMA_VERSION || !Array.isArray(evidence.facts)) {
    fail('versão de esquema do mundo incompatível.');
  }
  if (evidence.worldSeed !== world.seed || evidence.worldEpoch !== worldEpoch) fail('seed/época do estado social não corresponde ao mundo.');
  evidence.idempotency ||= {};
  evidence.commitments ||= [];
  if (!Number.isSafeInteger(evidence.nextFactNumber) || evidence.nextFactNumber < 1) evidence.nextFactNumber = 1;
  for (const field of ['nextBeliefNumber', 'nextCommitmentNumber', 'nextIntentionNumber']) {
    if (!Number.isSafeInteger(evidence[field]) || evidence[field] < 1) evidence[field] = 1;
  }
  return evidence;
}

function personById(world, value) {
  const key = idKey(value, 'personId');
  return (world.people || []).find(person => String(person.id) === key) || null;
}

export function recordSocialFact(world, input = {}) {
  const evidence = ensureEvidence(world);
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(type)) fail('type deve ser um identificador estável em snake_case.');
  const day = input.day === undefined ? world.day : input.day;
  if (!Number.isSafeInteger(day) || day < 0 || day > world.day) fail('day deve pertencer ao passado observável do mundo.');
  const participantIds = uniqueKnownPersonIds(world, input.participantIds || [], 'participantIds');
  const witnessIds = uniqueKnownPersonIds(world, input.witnessIds || [], 'witnessIds');
  const targetId = input.targetId == null ? null : idKey(input.targetId, 'targetId');
  if (targetId !== null && !entityExists(world, targetId)) fail('targetId referencia entidade inexistente: ' + targetId + '.');
  const location = input.location == null ? null : cloneJson(input.location, 'location');
  if (location && (!Number.isFinite(location.x) || !Number.isFinite(location.y))) fail('location requer coordenadas finitas.');
  if (input.references !== undefined && !Array.isArray(input.references)) fail('references deve ser uma lista.');
  const references = (input.references || []).map(reference => {
    if (!reference || typeof reference.kind !== 'string') fail('cada reference precisa de kind e id.');
    if (!REFERENCE_COLLECTIONS[reference.kind]) fail('kind de referência não reconhecido: ' + reference.kind + '.');
    const id = idKey(reference.id, 'references.id');
    const found = REFERENCE_COLLECTIONS[reference.kind].some(collection =>
      (world[collection] || []).some(entity => String(entity.id) === id));
    if (!found) fail('reference aponta para entidade inexistente: ' + reference.kind + ':' + id + '.');
    return { kind: reference.kind, id };
  });
  const factData = {
    schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    day,
    type,
    participantIds,
    targetId,
    location,
    outcome: cloneJson(input.outcome ?? {}, 'outcome'),
    references,
    witnessIds
  };
  const fingerprint = cloneJson(factData, 'fact');
  if (input.idempotencyKey == null) fail('idempotencyKey é obrigatório para registrar um fato social.');
  const idempotencyKey = idKey(input.idempotencyKey, 'idempotencyKey');
  if (evidence.idempotency[idempotencyKey]) {
    const existing = evidence.facts.find(fact => fact.eventId === evidence.idempotency[idempotencyKey].eventId);
    if (!existing) fail('a chave de idempotência aponta para um fato removido.');
    if (JSON.stringify(evidence.idempotency[idempotencyKey].fingerprint) !== JSON.stringify(fingerprint)) {
      fail('a mesma chave de idempotência foi usada para fatos diferentes.');
    }
    return existing;
  }
  const sequence = evidence.nextFactNumber++;
  const eventId = String(world.seed) + ':epoch:' + evidence.worldEpoch + ':social:' + sequence;
  const fact = freezeRecursively({ ...factData, sequence, eventId });
  evidence.facts.push(fact);
  evidence.idempotency[idempotencyKey] = { eventId, fingerprint };
  pruneSocialEvidence(world);
  return fact;
}

export function rememberSocialFact(world, personId, eventId, options = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, personId);
  if (!person) fail('a pessoa que receberá a memória não existe.');
  const fact = evidence.facts.find(item => item.eventId === String(eventId));
  if (!fact) fail('o fato de origem não existe neste mundo.');
  const source = options.source || 'direct';
  if (!['direct', 'reported'].includes(source)) fail('source deve ser direct ou reported.');
  const acquiredDay = options.acquiredDay === undefined ? world.day : options.acquiredDay;
  if (!Number.isSafeInteger(acquiredDay) || acquiredDay < fact.day || acquiredDay > world.day) {
    fail('acquiredDay deve estar entre o fato e o dia atual.');
  }
  let sourcePersonId = null;
  if (source === 'direct') {
    if (!fact.witnessIds.includes(String(person.id))) fail('a pessoa não consta entre as testemunhas do fato.');
  } else {
    sourcePersonId = idKey(options.sourcePersonId, 'sourcePersonId');
    const sourcePerson = personById(world, sourcePersonId);
    if (!sourcePerson || sourcePerson === person) fail('a fonte do relato deve ser outra pessoa existente.');
    if (!(sourcePerson.socialMemories || []).some(memory => memory.rootEventId === fact.eventId)) {
      fail('a fonte ainda não conhece este fato.');
    }
  }
  person.socialMemories ||= [];
  const existing = person.socialMemories.find(memory => memory.rootEventId === fact.eventId);
  if (existing) return existing;
  const memory = freezeRecursively({
    schemaVersion: SOCIAL_EVIDENCE_SCHEMA_VERSION,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    memoryId: fact.eventId + ':person:' + String(person.id),
    rootEventId: fact.eventId,
    sequence: fact.sequence,
    eventType: fact.type,
    eventDay: fact.day,
    acquiredDay,
    source,
    sourcePersonId
  });
  person.socialMemories.push(memory);
  if (!options.deferPrune) pruneSocialEvidence(world);
  return memory;
}

function localEvidenceIds(person, values = []) {
  if (!Array.isArray(values)) fail('evidenceIds deve ser uma lista.');
  const memories = new Set((person.socialMemories || []).map(memory => memory.rootEventId));
  const ids = [...new Set(values.map(value => idKey(value, 'evidenceIds')))];
  for (const id of ids) if (!memories.has(id)) fail('a pessoa não possui memória da evidência ' + id + '.');
  return ids;
}

function unitInterval(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(field + ' deve estar entre 0 e 1.');
  }
  return value;
}

export function defineSocialBelief(world, personId, input = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, personId);
  if (!person) fail('a pessoa dona da crença não existe.');
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(topic)) fail('topic deve ser um identificador estável em snake_case.');
  if (typeof input.evaluation !== 'number' || !Number.isFinite(input.evaluation) || input.evaluation < -1 || input.evaluation > 1) {
    fail('evaluation deve estar entre -1 e 1.');
  }
  const lastReviewedDay = input.lastReviewedDay ?? world.day;
  if (!Number.isSafeInteger(lastReviewedDay) || lastReviewedDay < 0 || lastReviewedDay > world.day) fail('lastReviewedDay inválido.');
  const aboutId = input.aboutId == null ? null : idKey(input.aboutId, 'aboutId');
  if (aboutId !== null && !entityExists(world, aboutId)) fail('aboutId referencia entidade inexistente: ' + aboutId + '.');
  const belief = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.belief,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    beliefId: String(world.seed) + ':epoch:' + evidence.worldEpoch + ':belief:' + evidence.nextBeliefNumber++,
    ownerId: String(person.id),
    topic,
    aboutId,
    evaluation: input.evaluation,
    certainty: unitInterval(input.certainty ?? 0, 'certainty'),
    supportingEventIds: localEvidenceIds(person, input.supportingEventIds || []),
    opposingEventIds: localEvidenceIds(person, input.opposingEventIds || []),
    lastReviewedDay,
    revision: 1,
    evidenceWeight: 0
  });
  person.socialBeliefs ||= [];
  person.socialBeliefs.push(belief);
  return belief;
}

/**
 * Re-evaluates one directed belief from a newly remembered, unique root event.
 * Reports carry less weight than direct observation, and duplicate reports of
 * the same root event never increase certainty a second time.
 */
export function recordSocialBeliefEvidence(world, personId, input = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, personId);
  if (!person) fail('a pessoa dona da crença não existe.');
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(topic)) fail('topic deve ser um identificador estável em snake_case.');
  const aboutId = input.aboutId == null ? null : idKey(input.aboutId, 'aboutId');
  if (aboutId !== null && !entityExists(world, aboutId)) fail('aboutId referencia entidade inexistente: ' + aboutId + '.');
  const eventId = idKey(input.eventId, 'eventId');
  const fact = evidence.facts.find(item => item.eventId === eventId);
  if (!fact) fail('o fato de origem da crença não existe.');
  if (!localEvidenceIds(person, [eventId]).length) fail('a pessoa não possui memória da evidência ' + eventId + '.');
  if (typeof input.polarity !== 'number' || !Number.isFinite(input.polarity)
      || input.polarity === 0 || input.polarity < -1 || input.polarity > 1) {
    fail('polarity deve estar entre -1 e 1 e ser diferente de zero.');
  }

  person.socialBeliefs ||= [];
  const beliefIndex = person.socialBeliefs.findIndex(item => item.topic === topic && item.aboutId === aboutId);
  const previous = beliefIndex < 0 ? null : person.socialBeliefs[beliefIndex];
  const supportingEventIds = previous ? previous.supportingEventIds.slice() : [];
  const opposingEventIds = previous ? previous.opposingEventIds.slice() : [];
  const hasPreviousEvidence = supportingEventIds.length > 0 || opposingEventIds.length > 0;
  const priorClassification = supportingEventIds.includes(eventId) ? 1
    : opposingEventIds.includes(eventId) ? -1 : 0;
  const requestedClassification = Math.sign(input.polarity);
  if (priorClassification) {
    if (priorClassification !== requestedClassification) fail('a mesma evidência não pode sustentar e contrariar a crença.');
    pruneSocialEvidence(world);
    return previous;
  }

  (requestedClassification > 0 ? supportingEventIds : opposingEventIds).push(eventId);
  const memoriesByEvent = new Map((person.socialMemories || []).map(memory => [memory.rootEventId, memory]));
  const weightFor = id => memoriesByEvent.get(id)?.source === 'reported' ? .5 : 1;
  const positiveWeight = supportingEventIds.reduce((sum, id) => sum + weightFor(id), 0);
  const negativeWeight = opposingEventIds.reduce((sum, id) => sum + weightFor(id), 0);
  const priorUncitedWeight = previous && !hasPreviousEvidence
    ? -3 * Math.log(Math.max(1e-9, 1 - previous.certainty)) : 0;
  const totalWeight = positiveWeight + negativeWeight + priorUncitedWeight;
  const priorNet = previous && !hasPreviousEvidence
    ? previous.evaluation * priorUncitedWeight : 0;
  const netWeight = positiveWeight - negativeWeight + priorNet;
  const belief = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.belief,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    beliefId: previous?.beliefId || String(world.seed) + ':epoch:' + evidence.worldEpoch + ':belief:' + evidence.nextBeliefNumber++,
    ownerId: String(person.id),
    topic,
    aboutId,
    evaluation: totalWeight > 0 ? Math.max(-1, Math.min(1, netWeight / totalWeight)) : input.polarity,
    certainty: Math.max(0, Math.min(1, 1 - Math.exp(-totalWeight / 3))),
    supportingEventIds,
    opposingEventIds,
    lastReviewedDay: world.day,
    revision: (previous?.revision || 0) + 1,
    evidenceWeight: totalWeight
  });
  if (beliefIndex < 0) person.socialBeliefs.push(belief);
  else person.socialBeliefs[beliefIndex] = belief;
  pruneSocialEvidence(world);
  return belief;
}

export function defineDirectedSocialRelationship(world, observerId, targetId, input = {}) {
  ensureEvidence(world);
  const observer = personById(world, observerId);
  const target = personById(world, targetId);
  if (!observer || !target || observer === target) fail('a relação dirigida requer duas pessoas distintas e existentes.');
  const evidenceIds = localEvidenceIds(observer, input.evidenceIds || []);
  const relationship = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.relationship,
    worldSeed: world.seed,
    worldEpoch: world.simulationEpoch ?? 0,
    observerId: String(observer.id),
    targetId: String(target.id),
    familiarity: unitInterval(input.familiarity ?? 0, 'familiarity'),
    trust: unitInterval(input.trust ?? 0, 'trust'),
    affinity: unitInterval(input.affinity ?? 0, 'affinity'),
    fear: unitInterval(input.fear ?? 0, 'fear'),
    evidenceIds,
    lastReviewedDay: input.lastReviewedDay ?? world.day
  });
  if (!Number.isSafeInteger(relationship.lastReviewedDay) || relationship.lastReviewedDay < 0
    || relationship.lastReviewedDay > world.day) fail('lastReviewedDay inválido.');
  observer.socialRelations ||= [];
  const existing = observer.socialRelations.find(item => item.targetId === String(target.id));
  if (existing) {
    const requested = cloneJson(relationship, 'relationship');
    if (JSON.stringify(existing) !== JSON.stringify(requested)) fail('a relação dirigida já existe com valores diferentes.');
    return existing;
  }
  if (observer.socialRelations.length >= SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT) {
    fail('a pessoa atingiu o limite de relações detalhadas.');
  }
  observer.socialRelations.push(relationship);
  return relationship;
}

/** Apply a once-per-event directional relationship change using evidence both people know. */
export function updateDirectedSocialRelationship(world, observerId, targetId, input = {}) {
  const evidence = ensureEvidence(world);
  const observer = personById(world, observerId);
  const target = personById(world, targetId);
  if (!observer || !target || observer === target) fail('a relação dirigida requer duas pessoas distintas e existentes.');
  const eventId = idKey(input.eventId, 'eventId');
  const fact = evidence.facts.find(item => item.eventId === eventId);
  if (!fact || !fact.participantIds.includes(String(observer.id)) || !fact.participantIds.includes(String(target.id))) {
    fail('a evidência da relação precisa envolver as duas pessoas.');
  }
  if (!(observer.socialMemories || []).some(memory => memory.rootEventId === eventId)) {
    fail('a pessoa ainda não conhece a evidência da relação.');
  }
  const relations = observer.socialRelations || (observer.socialRelations = []);
  const index = relations.findIndex(item => item.targetId === String(target.id));
  const previous = index >= 0 ? relations[index] : null;
  if (previous?.evidenceIds.includes(eventId)) return previous;
  if (!previous && relations.length >= SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT) return null;
  if (input.familiarityDelta !== undefined && (!Number.isFinite(input.familiarityDelta) || input.familiarityDelta < 0)) {
    fail('familiarityDelta deve ser finito e não negativo.');
  }
  if (input.trustDelta !== undefined && !Number.isFinite(input.trustDelta)) fail('trustDelta deve ser finito.');
  const relationship = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.relationship,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    observerId: String(observer.id),
    targetId: String(target.id),
    familiarity: unitInterval(Math.min(1, (previous?.familiarity || 0) + (input.familiarityDelta || 0)), 'familiarity'),
    trust: unitInterval(Math.max(0, Math.min(1, (previous?.trust || 0) + (input.trustDelta || 0))), 'trust'),
    affinity: previous?.affinity || 0,
    fear: previous?.fear || 0,
    evidenceIds: [...(previous?.evidenceIds || []), eventId],
    lastReviewedDay: world.day
  });
  if (index < 0) relations.push(relationship);
  else relations[index] = relationship;
  return relationship;
}

export function proposeSocialCommitment(world, input = {}) {
  const evidence = ensureEvidence(world);
  const parties = uniqueKnownIds(world, input.parties || [], 'parties');
  if (parties.length < 2 || parties.some(id => !personById(world, id))) fail('um compromisso requer ao menos duas pessoas.');
  const object = typeof input.object === 'string' ? input.object.trim() : '';
  if (!object) fail('object deve descrever o que foi prometido.');
  if (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity < 0) fail('quantity deve ser finita e não negativa.');
  if (!Number.isSafeInteger(input.dueDay) || input.dueDay < world.day) fail('dueDay não pode anteceder a proposta.');
  if (input.resourceReferences !== undefined && !Array.isArray(input.resourceReferences)) fail('resourceReferences deve ser uma lista.');
  const resourceReferences = (input.resourceReferences || []).map(reference => {
    if (!reference || !REFERENCE_COLLECTIONS[reference.kind]) fail('resourceReferences contém um kind inválido.');
    const id = idKey(reference.id, 'resourceReferences.id');
    if (!REFERENCE_COLLECTIONS[reference.kind].some(collection =>
      (world[collection] || []).some(entity => String(entity.id) === id))) fail('resourceReferences aponta para entidade inexistente.');
    return { kind: reference.kind, id };
  });
  if (input.evidenceEventIds !== undefined && !Array.isArray(input.evidenceEventIds)) fail('evidenceEventIds deve ser uma lista.');
  const evidenceEventIds = [...new Set((input.evidenceEventIds || []).map(value => idKey(value, 'evidenceEventIds')))];
  for (const eventId of evidenceEventIds) {
    if (!evidence.facts.some(fact => fact.eventId === eventId)) fail('evidenceEventIds referencia um fato inexistente.');
    for (const partyId of parties) {
      const party = personById(world, partyId);
      if (!(party.socialMemories || []).some(memory => memory.rootEventId === eventId)) {
        fail('cada parte precisa conhecer a evidência do compromisso.');
      }
    }
  }
  if (input.idempotencyKey == null) fail('idempotencyKey é obrigatório para propor um compromisso.');
  const idempotencyKey = idKey(input.idempotencyKey, 'idempotencyKey');
  const data = {
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.commitment,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    day: world.day,
    parties,
    object,
    quantity: input.quantity,
    dueDay: input.dueDay,
    status: 'proposed',
    resourceReferences,
    evidenceEventIds
  };
  const fingerprint = cloneJson(data, 'commitment');
  const existing = evidence.commitments.find(item => item.idempotencyKey === idempotencyKey);
  if (existing) {
    if (JSON.stringify(existing.fingerprint) !== JSON.stringify(fingerprint)) fail('a chave do compromisso foi reutilizada com outro conteúdo.');
    return existing.record;
  }
  const record = freezeRecursively({ ...data, commitmentId: String(world.seed) + ':epoch:' + evidence.worldEpoch
    + ':commitment:' + evidence.nextCommitmentNumber++ });
  evidence.commitments.push({ idempotencyKey, fingerprint, record });
  return record;
}

export function defineSocialIntention(world, ownerId, input = {}) {
  const evidence = ensureEvidence(world);
  const person = personById(world, ownerId);
  if (!person) fail('a pessoa dona da intenção não existe.');
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(type)) fail('type deve ser um identificador estável em snake_case.');
  const priority = unitInterval(input.priority ?? 0, 'priority');
  const targetId = input.targetId == null ? null : idKey(input.targetId, 'targetId');
  if (targetId !== null && !entityExists(world, targetId)) fail('targetId da intenção não existe.');
  if (!Array.isArray(input.steps) || input.steps.some(step => !step || typeof step.action !== 'string' || !step.action.trim())) {
    fail('steps deve listar ações não vazias.');
  }
  const steps = input.steps.map(step => ({
    action: step.action.trim(),
    targetId: step.targetId == null ? null : idKey(step.targetId, 'steps.targetId')
  }));
  for (const step of steps) if (step.targetId !== null && !entityExists(world, step.targetId)) fail('targetId de um passo não existe.');
  const progress = input.progress ?? 0;
  if (!Number.isSafeInteger(progress) || progress < 0 || progress > steps.length) fail('progress deve apontar para um passo válido.');
  const blockers = input.blockers ?? [];
  if (!Array.isArray(blockers) || blockers.some(item => typeof item !== 'string')) fail('blockers deve conter apenas textos.');
  const evidenceIds = localEvidenceIds(person, input.evidenceIds || []);
  const endsWhen = typeof input.endsWhen === 'string' ? input.endsWhen.trim() : '';
  if (!endsWhen) fail('endsWhen deve explicar a condição de encerramento.');
  person.socialIntentions ||= [];
  if (person.socialIntentions.filter(item => item.status === 'active').length >= SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT) {
    fail('a pessoa atingiu o limite de intenções ativas.');
  }
  const intention = freezeRecursively({
    schemaVersion: SOCIAL_RECORD_SCHEMA_VERSIONS.intention,
    worldSeed: world.seed,
    worldEpoch: evidence.worldEpoch,
    intentionId: String(world.seed) + ':epoch:' + evidence.worldEpoch + ':intention:' + evidence.nextIntentionNumber++,
    ownerId: String(person.id),
    type,
    priority,
    targetId,
    steps,
    progress,
    blockers: blockers.slice(),
    evidenceIds,
    endsWhen,
    status: 'active'
  });
  person.socialIntentions.push(intention);
  return intention;
}

export function pruneSocialEvidence(world, currentDay = world.day) {
  const evidence = ensureEvidence(world);
  if (!Number.isSafeInteger(currentDay) || currentDay < world.day) fail('currentDay não pode anteceder o mundo.');
  const cutoff = currentDay - SOCIAL_FACT_RETENTION_DAYS;
  const protectedEventsByPerson = new Map();
  const protect = (person, ids) => {
    if (!person || !Array.isArray(ids)) return;
    const protectedIds = protectedEventsByPerson.get(String(person.id)) || new Set();
    for (const id of ids) protectedIds.add(id);
    protectedEventsByPerson.set(String(person.id), protectedIds);
  };
  for (const person of world.people || []) {
    for (const belief of person.socialBeliefs || []) {
      protect(person, [...(belief.supportingEventIds || []), ...(belief.opposingEventIds || [])]);
    }
    for (const relation of person.socialRelations || []) protect(person, relation.evidenceIds || []);
    for (const intention of person.socialIntentions || []) {
      if (intention.status === 'active') protect(person, intention.evidenceIds || []);
    }
  }
  for (const item of evidence.commitments || []) {
    const commitment = item.record;
    if (!commitment || ['fulfilled', 'rejected', 'cancelled'].includes(commitment.status)) continue;
    for (const partyId of commitment.parties || []) {
      const party = personById(world, partyId);
      protect(party, commitment.evidenceEventIds || []);
    }
  }
  for (const person of world.people || []) {
    if (!Array.isArray(person.socialMemories)) continue;
    const protectedIds = protectedEventsByPerson.get(String(person.id)) || new Set();
    const protectedMemories = person.socialMemories.filter(memory => protectedIds.has(memory.rootEventId));
    const recentMemories = person.socialMemories
      .filter(memory => !protectedIds.has(memory.rootEventId) && memory.acquiredDay >= cutoff)
      .sort((a, b) => b.acquiredDay - a.acquiredDay || b.sequence - a.sequence || b.memoryId.localeCompare(a.memoryId));
    // The 32-record budget applies to consolidatable episodes. Evidence still
    // cited by a belief, active intention, relationship or open commitment is pinned.
    const unpinnedCapacity = Math.max(0, SOCIAL_MEMORY_PER_PERSON_LIMIT - protectedMemories.length);
    person.socialMemories = [...protectedMemories, ...recentMemories.slice(0, unpinnedCapacity)]
      .sort((a, b) => a.acquiredDay - b.acquiredDay || a.sequence - b.sequence || a.memoryId.localeCompare(b.memoryId));
  }
  const referenced = new Set((world.people || []).flatMap(person =>
    (person.socialMemories || []).map(memory => memory.rootEventId)));
  evidence.facts = evidence.facts.filter(fact => fact.day >= cutoff || referenced.has(fact.eventId));
  evidence.facts.sort((a, b) => a.day - b.day || a.sequence - b.sequence);
  while (evidence.facts.length > SOCIAL_FACT_LIMIT) {
    const expendableIndex = evidence.facts.findIndex(fact => !referenced.has(fact.eventId));
    if (expendableIndex < 0) break;
    const [expired] = evidence.facts.splice(expendableIndex, 1);
    for (const person of world.people || []) {
      if (Array.isArray(person.socialMemories)) {
        person.socialMemories = person.socialMemories.filter(memory => memory.rootEventId !== expired.eventId);
      }
    }
  }
  const retainedIds = new Set(evidence.facts.map(fact => fact.eventId));
  for (const [key, item] of Object.entries(evidence.idempotency)) {
    if (!retainedIds.has(item.eventId)) delete evidence.idempotency[key];
  }
  return {
    retainedFacts: evidence.facts.length,
    retainedMemories: (world.people || []).reduce((sum, person) => sum + (person.socialMemories || []).length, 0),
    cutoffDay: cutoff
  };
}
