(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GenesisLocalAI = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  'use strict';

  const MODEL_ID = 'SmolLM2-360M-Instruct-q4f32_1-MLC';
  const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.86';
  const scriptBase = typeof document !== 'undefined' && document.currentScript
    ? document.currentScript.src : (typeof location !== 'undefined' ? location.href : 'http://localhost/');

  function parseDecision(text) {
    const source = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = source.indexOf('{'), end = source.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Resposta sem objeto JSON.');
    const value = JSON.parse(source.slice(start, end + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resposta JSON inválida.');
    return value;
  }

  function parseStrategicDecision(text, candidateActions) {
    const source = String(text || '').trim();
    let parsed = null;
    try { parsed = parseDecision(source); } catch (_) { /* Some small models return the selected action as plain text. */ }
    if (parsed && typeof parsed.action === 'string') return parsed;

    const candidates = Array.isArray(candidateActions) ? candidateActions : [];
    const normalized = source.toLowerCase();
    const labeled = normalized.match(/(?:action|a[cç][aã]o)\s*[:=]\s*["'`]?([a-z_]+)/i);
    if (labeled && candidates.includes(labeled[1])) {
      return { action: labeled[1], confidence: .55, reason: 'Ação selecionada a partir do contexto individual.' };
    }
    const tokens = normalized.match(/[a-z_]+/g) || [];
    const matches = candidates.filter(action => tokens.includes(action));
    if (matches.length === 1) {
      return { action: matches[0], confidence: .55, reason: 'Ação selecionada a partir do contexto individual.' };
    }
    throw new Error(matches.length > 1
      ? 'A resposta citou mais de uma ação candidata.'
      : 'A resposta não identificou uma ação candidata.');
  }

  function describeError(error) {
    if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 320);
    if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim().slice(0, 320);
    if (error && typeof error.reason === 'string' && error.reason.trim()) return error.reason.trim().slice(0, 320);
    if (typeof error === 'number') return 'erro interno ' + error;
    try {
      const detail = JSON.stringify(error);
      if (detail && detail !== '{}') return detail.slice(0, 320);
    } catch (_) { /* Fall through to a clear diagnostic. */ }
    return 'erro sem detalhes retornados pelo navegador; consulte o console para “Genesis IA local”.';
  }

  function create(options) {
    const settings = options || {};
    const Sim = settings.Sim;
    const getWorld = settings.getWorld || (() => null);
    const onStatus = typeof settings.onStatus === 'function' ? settings.onStatus : () => {};
    const customLoader = settings.loadEngine;
    let engine = null, worker = null, enabled = false, loading = null, busy = false, pumpPromise = null;
    let state = { phase: 'idle', text: 'Desativada. A IA neural individual continua controlando as ações do dia a dia.', progress: 0, model: MODEL_ID };

    function report(phase, text, progress) {
      state = { phase, text: String(text || ''), progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : state.progress, model: MODEL_ID };
      onStatus(Object.assign({}, state));
    }

    async function loadEngine() {
      if (customLoader) return customLoader((progress) => {
        const update = progress || {};
        report('loading', update.text || 'Carregando o modelo local…', update.progress);
      });
      if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('Este navegador não oferece WebGPU. A IA neural existente permanece ativa.');
      report('loading', 'Carregando o motor local de IA…', 0);
      const webllm = await import(WEBLLM_URL);
      if (typeof Worker === 'undefined' || !webllm.CreateWebWorkerMLCEngine) throw new Error('O navegador não conseguiu iniciar o Web Worker do modelo.');
      worker = new Worker(new URL('./genesis-llm.worker.mjs', scriptBase), { type: 'module' });
      try {
        return await webllm.CreateWebWorkerMLCEngine(worker, MODEL_ID, {
          initProgressCallback: progress => {
            const update = progress || {};
            report('loading', update.text || 'Preparando o modelo…', update.progress);
          }
        });
      } catch (error) {
        worker.terminate(); worker = null;
        throw error;
      }
    }

    async function enable(world) {
      if (enabled && engine) { if (world && Sim) Sim.modules.SocietyExperiment.setStrategicAiEnabled(world, true); return true; }
      if (loading) return loading;
      report('loading', 'Preparando IA local. O primeiro uso baixa o modelo para este navegador…', 0);
      loading = (async () => {
        try {
          engine = await loadEngine();
          if (!engine || !engine.chat || !engine.chat.completions) throw new Error('O motor não disponibilizou a interface de geração de decisões.');
          enabled = true;
          const currentWorld = world || getWorld();
          if (currentWorld && Sim) Sim.modules.SocietyExperiment.setStrategicAiEnabled(currentWorld, true);
          report('ready', 'IA local ativa. Os NPCs recebem planos individuais em fila; as ações continuam limitadas pelo estado do mundo.', 1);
          pump(currentWorld);
          return true;
        } catch (error) {
          enabled = false; engine = null;
          const currentWorld = world || getWorld();
          if (currentWorld && Sim) Sim.modules.SocietyExperiment.setStrategicAiEnabled(currentWorld, false);
          report('error', error && error.message ? error.message : 'Não foi possível carregar o modelo local.', 0);
          throw error;
        } finally { loading = null; }
      })();
      return loading;
    }

    function disable(world) {
      enabled = false;
      const currentWorld = world || getWorld();
      if (currentWorld && Sim) Sim.modules.SocietyExperiment.setStrategicAiEnabled(currentWorld, false);
      if (worker) { worker.terminate(); worker = null; }
      engine = null;
      report('idle', 'Desativada. A IA neural individual continua controlando as ações do dia a dia.', 0);
    }

    async function answerRequest(request, world) {
      const response = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: 'Você é o conselheiro estratégico de uma única pessoa em um simulador de ecossistema. Considere apenas os dados recebidos e as necessidades dessa pessoa. Escolha UMA ação somente entre candidateActions. Não invente recursos nem alvos. Responda com JSON contendo action (texto exato de uma ação candidata), confidence (número de 0 a 1) e reason (frase curta em português). Se não conseguir gerar JSON, escreva apenas o identificador exato de UMA ação candidata.' },
          { role: 'user', content: JSON.stringify(request.context) }
        ],
        temperature: .15,
        max_tokens: 72
      });
      const choice = response && response.choices && response.choices[0];
      if (!choice) throw new Error('WebLLM retornou uma resposta sem opções.');
      if (choice.finish_reason === 'error') throw new Error('WebLLM encerrou a geração com erro.');
      const text = choice.message ? choice.message.content : '';
      const decision = parseStrategicDecision(text, request.candidateActions);
      const accepted = Sim.modules.SocietyExperiment.applyStrategicAiDecision(world, request.personId, request.requestedDay, decision);
      if (!accepted) Sim.modules.SocietyExperiment.failStrategicAiRequest(world, request.personId, request.requestedDay);
      return { accepted, decision };
    }

    function pump(world) {
      if (!enabled || !engine || busy || !Sim) return pumpPromise || Promise.resolve(false);
      const currentWorld = world || getWorld();
      if (!currentWorld) return Promise.resolve(false);
      const requests = Sim.modules.SocietyExperiment.pullStrategicAiRequests(currentWorld, 1);
      if (!requests.length) return Promise.resolve(false);
      const request = requests[0];
      busy = true;
      report('working', 'Analisando ' + request.context.person.name + ' · dia ' + request.requestedDay + '…', 1);
      pumpPromise = answerRequest(request, currentWorld).then(result => {
        if (enabled) {
          if (result.accepted) report('ready', 'Plano individual de ' + request.context.person.name + ': ' + result.decision.action + '.', 1);
          else report('ready', 'Resposta descartada: a ação não estava disponível para ' + request.context.person.name + '.', 1);
        }
        return result.accepted;
      }).catch(error => {
        Sim.modules.SocietyExperiment.failStrategicAiRequest(currentWorld, request.personId, request.requestedDay);
        const detail = describeError(error);
        console.error('[Genesis IA local] falha na decisão estratégica:', error);
        if (enabled) report('ready', 'A decisão local falhou; a rede neural individual assumiu. Detalhe: ' + detail, 1);
        return false;
      }).finally(() => {
        busy = false; pumpPromise = null;
        if (enabled) pump(getWorld() || currentWorld);
      });
      return pumpPromise;
    }

    function syncWorld(world) {
      const currentWorld = world || getWorld();
      if (currentWorld && Sim) Sim.modules.SocietyExperiment.setStrategicAiEnabled(currentWorld, enabled && !!engine);
    }

    return { enable, disable, pump, syncWorld, isEnabled: () => enabled, getStatus: () => Object.assign({}, state), modelId: MODEL_ID };
  }

  return { create, parseDecision, parseStrategicDecision, describeError, MODEL_ID };
});
