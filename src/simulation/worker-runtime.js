import engine from './engine.js';
import { dispatchCommand } from './commands.js';
import { createWorldSnapshot } from './render-snapshot.js';
import { SIMULATION_PROTOCOL_VERSION } from './protocol-version.js';

const MAX_ADVANCE_DAYS = 12;

export function createSimulationWorkerRuntime({ includeDailySnapshots = false, createWorldImpl = engine.createWorld } = {}) {
  let world = null;
  let epoch = -1;
  let revision = 0;
  let paused = false;

  function envelope(request, type, body = {}) {
    return {
      protocolVersion: SIMULATION_PROTOCOL_VERSION,
      requestId: Number.isSafeInteger(request?.requestId) ? request.requestId : -1,
      epoch: Number.isSafeInteger(request?.epoch) ? request.epoch : epoch,
      revision,
      type,
      ...body
    };
  }

  function capture(request, { reset = false, result } = {}) {
    const snapshot = createWorldSnapshot(world, { reset });
    return envelope(request, 'snapshot', { snapshot, result });
  }

  function requireWorld(request) {
    if (!world) throw new Error('A simulação ainda não foi inicializada.');
    if (request.epoch !== epoch) throw new Error('Época de simulação expirada.');
  }

  function handle(request) {
    try {
      if (!request || typeof request !== 'object') throw new Error('Mensagem do Worker inválida.');
      if (request.protocolVersion !== SIMULATION_PROTOCOL_VERSION) throw new Error('Versão de protocolo incompatível.');
      if (!Number.isSafeInteger(request.requestId) || request.requestId < 0 || !Number.isSafeInteger(request.epoch) || request.epoch < 0) {
        throw new Error('Envelope do Worker inválido.');
      }

      if (request.type === 'initialize') {
        if (world) throw new Error('A simulação já foi inicializada.');
        if (request.epoch <= epoch) throw new Error('Época de inicialização inválida.');
        if (!request.config || request.config.scenario !== 'kingdom') throw new Error('Cenário não implementado.');
        world = createWorldImpl(request.seed);
        epoch = request.epoch;
        world.simulationEpoch = epoch;
        paused = false;
        revision++;
        return capture(request, { reset: true });
      }

      if (request.type === 'reset') {
        if (request.epoch <= epoch) throw new Error('Época de reset inválida.');
        world = createWorldImpl(request.seed);
        epoch = request.epoch;
        world.simulationEpoch = epoch;
        paused = false;
        if (request.kingdomAiEnabled) engine.modules.KingdomStrategy.setStrategicAiEnabled(world, true);
        revision++;
        return capture(request, { reset: true });
      }

      requireWorld(request);
      switch (request.type) {
        case 'set-paused': {
          if (typeof request.paused !== 'boolean') throw new Error('Estado de pausa inválido.');
          paused = request.paused;
          revision++;
          return envelope(request, 'ack', { result: { paused } });
        }
        case 'advance': {
          if (!Number.isInteger(request.days) || request.days < 1 || request.days > MAX_ADVANCE_DAYS) {
            throw new Error('O avanço deve ser de 1 a ' + MAX_ADVANCE_DAYS + ' dias.');
          }
          const source = request.source || 'manual';
          if (source !== 'clock' && source !== 'manual') throw new Error('Origem do avanço inválida.');
          if (paused && source === 'clock') throw new Error('A simulação está pausada.');
          for (let day = 0; day < request.days; day++) {
            engine.stepDay(world, { includeSnapshot: includeDailySnapshots });
          }
          revision++;
          return capture(request);
        }
        case 'dispatch': {
          const result = dispatchCommand(world, request.command);
          revision++;
          return capture(request, { result });
        }
        case 'set-kingdom-ai': {
          if (typeof request.enabled !== 'boolean') throw new Error('Estado da IA estratégica inválido.');
          const result = engine.modules.KingdomStrategy.setStrategicAiEnabled(world, request.enabled);
          engine.modules.KingdomCampaigns.setGeneralAiEnabled(world, request.enabled);
          revision++;
          return capture(request, { result });
        }
        case 'pull-kingdom-ai-request': {
          if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 3) throw new Error('Limite de solicitações inválido.');
          const kingdomQueue = world.strategicAI?.requests || [];
          const generalQueue = world.campaignGeneralAi?.requests || [];
          const kingHead = kingdomQueue[0];
          const generalHead = generalQueue[0];
          const generalFirst = !!generalHead && (!kingHead
            || generalHead.priority === 'urgent' && kingHead.priority !== 'urgent'
            || generalHead.priority === kingHead.priority && generalHead.reportDay < kingHead.reportDay);
          const [kingRequest = null] = generalFirst ? []
            : engine.modules.KingdomStrategy.pullStrategicAiRequests(world, 1);
          const generalRequest = generalFirst || !kingRequest
            ? engine.modules.KingdomCampaigns.pullGeneralAiRequest(world) : null;
          const nextRequest = generalRequest || kingRequest;
          if (nextRequest) revision++;
          return envelope(request, 'kingdom-ai-request', { request: nextRequest });
        }
        case 'apply-kingdom-ai-decision': {
          const aiRequest = request.aiRequest;
          const result = aiRequest
            ? aiRequest.worldEpoch === epoch
              ? aiRequest.role === 'general'
                ? engine.modules.KingdomCampaigns.applyGeneralAiDecision(world, aiRequest, request.decision, request.providerMetadata)
                : engine.modules.KingdomStrategy.applyStrategicAiDecision(world, aiRequest, request.decision, request.providerMetadata)
              : aiRequest.role === 'general'
                ? engine.modules.KingdomCampaigns.failGeneralAiRequest(world, aiRequest, { reason: 'época do mundo expirada' })
                : engine.modules.KingdomStrategy.failStrategicAiRequest(world, aiRequest, { reason: 'época do mundo expirada' })
            : false;
          revision++;
          return capture(request, { result });
        }
        case 'fail-kingdom-ai-request': {
          const aiRequest = request.aiRequest;
          const result = aiRequest
            ? aiRequest.worldEpoch === epoch
              ? aiRequest.role === 'general'
                ? engine.modules.KingdomCampaigns.failGeneralAiRequest(world, aiRequest, request.failure)
                : engine.modules.KingdomStrategy.failStrategicAiRequest(world, aiRequest, request.failure)
              : aiRequest.role === 'general'
                ? engine.modules.KingdomCampaigns.failGeneralAiRequest(world, aiRequest, { reason: 'época do mundo expirada' })
                : engine.modules.KingdomStrategy.failStrategicAiRequest(world, aiRequest, { reason: 'época do mundo expirada' })
            : false;
          revision++;
          return capture(request, { result });
        }
        case 'inspect-tile': {
          return envelope(request, 'query', { result: engine.inspectTile(world, request.x, request.y) });
        }
        default:
          throw new Error('Tipo de mensagem não reconhecido: ' + request.type);
      }
    } catch (error) {
      return envelope(request, 'error', { message: error && error.message ? error.message : String(error) });
    }
  }

  return { handle };
}
