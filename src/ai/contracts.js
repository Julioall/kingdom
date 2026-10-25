export const AI_DECISION_CONTRACT_VERSION = 1;
export const AI_DECISION_ROLES = Object.freeze(['king', 'general', 'commander', 'soldier', 'citizen']);

const isId = value => (typeof value === 'string' && value.length > 0)
  || (Number.isSafeInteger(value) && value >= 0);

export function validateDecisionRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'pedido inválido';
  if (request.contractVersion !== AI_DECISION_CONTRACT_VERSION) return 'versão do contrato incompatível';
  if (!isId(request.requestId)) return 'requestId inválido';
  if (!Number.isSafeInteger(request.worldEpoch) || request.worldEpoch < 0) return 'época do mundo inválida';
  if (!AI_DECISION_ROLES.includes(request.role)) return 'papel inválido';
  if (!isId(request.agentId) || !isId(request.kingdomId)) return 'agente ou reino inválido';
  if (request.campaignId !== null && request.campaignId !== undefined && !isId(request.campaignId)) return 'campanha inválida';
  if (!Number.isSafeInteger(request.orderVersion) || request.orderVersion < 0) return 'versão da ordem inválida';
  if (!Number.isSafeInteger(request.reportDay) || request.reportDay < 0) return 'dia do relatório inválido';
  if (!Number.isSafeInteger(request.expiresDay) || request.expiresDay < request.reportDay) return 'validade inválida';
  if (request.priority !== undefined && !['normal', 'urgent'].includes(request.priority)) return 'prioridade inválida';
  if (!Array.isArray(request.allowedActions) || request.allowedActions.length === 0
    || request.allowedActions.some(action => typeof action !== 'string' || !action)
    || new Set(request.allowedActions).size !== request.allowedActions.length) return 'ações permitidas inválidas';
  if (!request.observedFacts || typeof request.observedFacts !== 'object' || Array.isArray(request.observedFacts)) return 'observações inválidas';
  return null;
}

/** Validate an asynchronous result against the exact request still in flight. */
export function validateDecisionResult({ request, pending, worldEpoch, currentDay, orderVersion, campaignId, role }) {
  const invalidRequest = validateDecisionRequest(request);
  if (invalidRequest) return invalidRequest;
  if (!pending || request.requestId !== pending.requestId) return 'pedido duplicado, substituído ou desconhecido';
  if (request.worldEpoch !== worldEpoch || request.worldEpoch !== pending.worldEpoch) return 'época do mundo expirada';
  if (request.role !== (role || pending.role)) return 'papel do agente incompatível';
  if (request.agentId !== pending.agentId || request.kingdomId !== pending.kingdomId) return 'entidade do pedido incompatível';
  if (request.orderVersion !== orderVersion || request.orderVersion !== pending.orderVersion) return 'ordem substituída';
  if ((request.campaignId ?? null) !== (campaignId ?? null) || (request.campaignId ?? null) !== (pending.campaignId ?? null)) return 'campanha encerrada ou substituída';
  if (request.reportDay !== pending.reportDay || request.expiresDay !== pending.expiresDay) return 'relatório ou validade substituídos';
  if (JSON.stringify(request.allowedActions) !== JSON.stringify(pending.candidateActions)
    || JSON.stringify(request.candidateActions) !== JSON.stringify(pending.candidateActions)) return 'ações permitidas substituídas';
  if (!Number.isSafeInteger(currentDay) || currentDay > request.expiresDay) return 'decisão expirada';
  return null;
}

export function validateDecisionAction(request, decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return 'decisão inválida';
  const keys = Object.keys(decision).sort();
  if (keys.length !== 3 || keys[0] !== 'action' || keys[1] !== 'confidence' || keys[2] !== 'reason') return 'formato da decisão inválido';
  if (typeof decision.action !== 'string' || !request.allowedActions.includes(decision.action)) return 'ação fora da lista permitida';
  if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) return 'confiança inválida';
  if (typeof decision.reason !== 'string' || !decision.reason.trim()) return 'justificativa inválida';
  return null;
}
