import { validateDecisionRequest } from './contracts.js';
import { AI_MODEL_MANIFEST, getAiModelForRole } from './model-manifest.js';
import { buildKingdomStrategySystemPrompt } from './kingdom-strategy-prompt.js';

const MODEL_ID = getAiModelForRole('king').model;
const GENERAL_MODEL_ID = getAiModelForRole('general').model;

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
    const candidates = Array.isArray(candidateActions) ? candidateActions : [];
    let parsed = null;
    try { parsed = parseDecision(source); } catch (_) { /* Some small models return the selected action as plain text. */ }
    if (parsed && typeof parsed.action === 'string') {
      if (candidates.includes(parsed.action)) return parsed;
      throw new Error('A resposta JSON selecionou uma ação fora da lista permitida.');
    }

    const normalized = source.toLowerCase();
    const labeled = normalized.match(/(?:action|a[cç][aã]o)\s*[:=]\s*["'`]?([a-z_]+)/i);
    if (labeled && candidates.includes(labeled[1])) {
      return { action: labeled[1], confidence: .55, reason: 'Ação selecionada a partir do contexto do reino.' };
    }
    const tokens = normalized.match(/[a-z_]+/g) || [];
    const matches = candidates.filter(action => tokens.includes(action));
    if (matches.length === 1) {
      return { action: matches[0], confidence: .55, reason: 'Ação selecionada a partir do contexto do reino.' };
    }
    throw new Error(matches.length > 1
      ? 'A resposta citou mais de uma ação candidata.'
      : 'A resposta não identificou uma ação candidata.');
  }

  function parseStrictStrategicDecision(text, candidateActions) {
    let decision;
    try { decision = JSON.parse(String(text || '').trim()); }
    catch (_) { throw new Error('A resposta estratégica não é um objeto JSON completo.'); }
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      throw new Error('A resposta estratégica não é um objeto JSON completo.');
    }
    const keys = Object.keys(decision).sort();
    if (keys.length !== 3 || keys[0] !== 'action' || keys[1] !== 'confidence' || keys[2] !== 'reason') {
      throw new Error('A decisão deve conter somente action, confidence e reason.');
    }
    const candidates = Array.isArray(candidateActions) ? candidateActions : [];
    if (typeof decision.action !== 'string' || !candidates.includes(decision.action)) {
      throw new Error('A resposta JSON selecionou uma ação fora da lista permitida.');
    }
    if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
      throw new Error('A confiança da decisão deve ser um número entre 0 e 1.');
    }
    if (typeof decision.reason !== 'string' || !decision.reason.trim()) {
      throw new Error('A decisão precisa incluir uma justificativa curta.');
    }
    return decision;
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
    return 'erro sem detalhes retornados pelo navegador; consulte o console para “Kingdom IA local”.';
  }

function decisionLabel(request, decision) {
  const action = decision && decision.action;
  if (request.role === 'king') {
    return request.context?.choices?.find(choice => choice.id === action)?.label || String(action || 'ordem estratégica');
  }
  const labels = { advance: 'avançar ao objetivo', hold_position: 'manter posição', withdraw: 'retirada ordenada' };
  return labels[action] || String(action || 'ordem militar');
}

  function create(options) {
    const settings = options || {};
    const getWorld = settings.getWorld || (() => null);
    const getWorldEpoch = settings.getWorldEpoch || (() => 0);
    const setKingdomAiEnabled = settings.setKingdomAiEnabled || (async () => false);
    const pullKingdomAiRequest = settings.pullKingdomAiRequest || (async () => null);
    const applyKingdomAiDecision = settings.applyKingdomAiDecision || (async () => false);
    const failKingdomAiRequest = settings.failKingdomAiRequest || (async () => false);
    const onStatus = typeof settings.onStatus === 'function' ? settings.onStatus : () => {};
    const customLoader = settings.loadEngine;
    let engine = null, enabled = false, loading = null, busy = false, pumpPromise = null;
    let pendingEngine = null;
    let activeAbortController = null;
    let lastPollAt = 0;
    let generation = 0;
    let currentModel = MODEL_ID;
    let state = { phase: 'idle', text: 'Desativada. Reis e generais seguem as políticas determinísticas de contingência.', progress: 0, model: MODEL_ID };

    function report(phase, text, progress) {
      state = { phase, text: String(text || ''), progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : state.progress, model: currentModel };
      onStatus(Object.assign({}, state));
    }

    async function loadEngine(token) {
      if (customLoader) return customLoader((progress) => {
        if (token !== generation) return;
        const update = progress || {};
        report('loading', update.text || 'Carregando o modelo local…', update.progress);
      });
      if (AI_MODEL_MANIFEST.provider === 'transformers-js-browser') {
        const browserModel = AI_MODEL_MANIFEST.browser;
        report('loading', 'Preparando ' + MODEL_ID + ' no navegador · primeira ativação baixa cerca de '
          + (browserModel.approximateDownloadBytes / 1_000_000).toFixed(0) + ' MB; não exige Ollama.', 0);
        const browserProvider = await import('./browser-engine.js');
        const browserWorkerFactory = await import('./browser-worker-factory.js');
        const browserEngine = browserProvider.createBrowserEngine({
          model: browserModel,
          createWorker: browserWorkerFactory.createBrowserInferenceWorker,
          onStatus: update => {
            if (token !== generation) return;
            report(update.phase || 'loading', update.text || 'Carregando modelo no navegador…', update.progress);
          }
        });
        pendingEngine = browserEngine;
        try {
          browserEngine.runtime = await browserEngine.ready;
          if (token !== generation) {
            browserEngine.dispose();
            if (pendingEngine === browserEngine) pendingEngine = null;
            return null;
          }
          return browserEngine;
        } catch (error) {
          browserEngine.dispose();
          if (pendingEngine === browserEngine) pendingEngine = null;
          throw error;
        }
      }
      report('loading', 'Conectando ao serviço local do Ollama…', 0);
      const ollama = await import('./ollama-client.js');
      const health = await ollama.checkLocalAiService();
      if (token !== generation) return null;
      const models = health.models || [];
      const kingModel = models.find(item => item.role === 'king');
      const generalModel = models.find(item => item.role === 'general');
      if (!kingModel?.installed) throw new Error('O modelo do rei ' + MODEL_ID + ' não está instalado. Execute “npm run ai:prepare -- --pull”.');
      if (!generalModel?.installed) throw new Error('O modelo do general ' + GENERAL_MODEL_ID + ' não está instalado. Execute “npm run ai:prepare -- --pull”.');
      report('loading', 'Serviço ativo · rei ' + MODEL_ID + ' e general ' + GENERAL_MODEL_ID + ' disponíveis no Ollama.', 1);
      return { decide: (request, options) => ollama.requestLocalAiDecision(request.role, request, options) };
    }

    async function enable() {
      if (enabled && engine) { await setKingdomAiEnabled(true); return true; }
      if (loading) return loading;
      report('loading', AI_MODEL_MANIFEST.provider === 'transformers-js-browser'
        ? 'Preparando o modelo de IA dentro do navegador…'
        : 'Preparando IA do reino pelo Ollama local…', 0);
      const token = generation;
      loading = (async () => {
        try {
          const loadedEngine = await loadEngine(token);
          if (token !== generation) return false;
          engine = loadedEngine;
          pendingEngine = null;
          if (!engine || (typeof engine.decide !== 'function' && (!engine.chat || !engine.chat.completions))) throw new Error('O provedor não disponibilizou a interface de geração de decisões.');
          enabled = true;
          await setKingdomAiEnabled(true);
          report('ready', (AI_MODEL_MANIFEST.provider === 'transformers-js-browser'
            ? 'IA ativa no navegador · ' : 'IA experimental ativa · rei ')
            + MODEL_ID + ' e general ' + GENERAL_MODEL_ID
            + (engine.runtime?.device ? ' · ' + engine.runtime.device : '')
            + '. Uma inferência atende a fila compartilhada por vez.', 1);
          pump();
          return true;
        } catch (error) {
          if (token !== generation) return false;
          enabled = false; engine = null;
          try { await setKingdomAiEnabled(false); } catch { /* Keep the visible load failure as the primary status. */ }
          report('error', error && error.message ? error.message : 'Não foi possível carregar o modelo local.', 0);
          throw error;
        } finally { if (token === generation) loading = null; }
      })();
      return loading;
    }

    function disable() {
      generation++;
      loading = null; busy = false; pumpPromise = null;
      if (activeAbortController) { activeAbortController.abort(); activeAbortController = null; }
      if (pendingEngine && typeof pendingEngine.dispose === 'function') pendingEngine.dispose();
      pendingEngine = null;
      if (engine && typeof engine.dispose === 'function') engine.dispose();
      lastPollAt = 0;
      enabled = false;
      setKingdomAiEnabled(false).catch(error => {
        if (error && error.name === 'AbortError') return;
        console.warn('[Kingdom IA local] não foi possível atualizar o estado da IA:', describeError(error));
      });
      engine = null;
      report('idle', 'Desativada. Reis e generais seguem as políticas determinísticas de contingência.', 0);
    }

    async function answerRequest(request, signal) {
      const contractError = validateDecisionRequest(request);
      if (contractError) throw new Error('Pedido estratégico inválido: ' + contractError + '.');
      const token = generation;
      const requestEpoch = request.worldEpoch;
      const requestModel = getAiModelForRole(request.role);
      currentModel = requestModel?.model || MODEL_ID;
      const decisionSchema = JSON.stringify({
        type: 'object',
        properties: {
          action: { type: 'string', enum: request.candidateActions },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' }
        },
        required: ['action', 'confidence', 'reason'],
        additionalProperties: false
      });
      let response;
      if (typeof engine.decide === 'function') {
        response = await engine.decide(request, { signal });
      } else {
        response = await engine.chat.completions.create({
          messages: [
            { role: 'system', content: request.role === 'general'
              ? 'Você é o general de um reino simulado. Use apenas os fatos observados da campanha deste lado. Uma unidade de alimento paga um dia para um soldado; os estoques e dias de ração são apresentados como números inteiros. Escolha exatamente um ID permitido: ' + request.candidateActions.join(', ') + '. A simulação controla recursos, alvos e resultados; não invente informações nem emita ordens fora da lista. Responda com um único JSON contendo action, confidence e reason curta em português.'
              : buildKingdomStrategySystemPrompt(request.candidateActions) },
            { role: 'user', content: JSON.stringify(request.context) }
          ],
          temperature: .1,
          max_tokens: requestModel?.selectedOutputTokens || 192,
          response_format: { type: 'json_object', schema: decisionSchema }
        });
      }
      if (token !== generation || !enabled || requestEpoch !== getWorldEpoch()) return { accepted: false, decision: {} };
      const choice = response && response.choices && response.choices[0];
      if (!response || (!response.decision && !choice)) throw new Error('O provedor de IA retornou uma resposta sem decisão.');
      if (choice && choice.finish_reason === 'error') throw new Error('O provedor de IA encerrou a geração com erro.');
      const text = response.decision ? JSON.stringify(response.decision) : choice.message ? choice.message.content : '';
      let decision;
      try {
        decision = parseStrictStrategicDecision(text, request.candidateActions);
      } catch (error) {
        console.warn('[Kingdom IA navegador] saída recusada pelo validador ' + JSON.stringify({
          provider: response.provider || AI_MODEL_MANIFEST.provider,
          model: response.model || requestModel?.model || MODEL_ID,
          device: response.device || null,
          elapsedMs: response.elapsedMs || null,
          outputPreview: String(text).slice(0, 320)
        }));
        throw error;
      }
      const providerMetadata = {
        provider: response.provider || 'custom',
        model: response.model || requestModel?.model || MODEL_ID,
        ...(typeof response.device === 'string' ? { device: response.device } : {}),
        ...(Number.isFinite(response.elapsedMs) ? { elapsedMs: response.elapsedMs } : {}),
        ...(Number.isFinite(response.outputTokens) ? { outputTokens: response.outputTokens } : {}),
        ...(Number.isFinite(response.inputTokens) ? { inputTokens: response.inputTokens } : {}),
        ...(Number.isFinite(response.contextTokens) ? { contextTokens: response.contextTokens } : {})
      };
      if (providerMetadata.provider === 'transformers-js-browser') {
        console.info('[Kingdom IA navegador] decisão validada ' + JSON.stringify({
          role: request.role,
          model: providerMetadata.model,
          device: providerMetadata.device || null,
          elapsedMs: providerMetadata.elapsedMs ?? null,
          inputTokens: providerMetadata.inputTokens ?? null,
          contextTokens: providerMetadata.contextTokens ?? null,
          outputTokens: providerMetadata.outputTokens ?? null
        }));
      }
      const accepted = await applyKingdomAiDecision(request, decision, providerMetadata);
      return { accepted, decision, providerMetadata };
    }

    function pump(force = false) {
      if (!enabled || !engine || busy) return pumpPromise || Promise.resolve(false);
      const currentWorld = getWorld();
      if (!currentWorld) return Promise.resolve(false);
      const now = Date.now();
      if (!force && now - lastPollAt < 500) return Promise.resolve(false);
      lastPollAt = now;
      const currentEpoch = getWorldEpoch();
      const token = generation;
      busy = true;
      pumpPromise = (async () => {
        let request = null;
        try {
          request = await pullKingdomAiRequest(1);
          if (!request || token !== generation || !enabled || currentEpoch !== getWorldEpoch()) return false;
          if (request.worldEpoch !== currentEpoch) return false;
          const requestModel = getAiModelForRole(request.role);
          currentModel = requestModel?.model || MODEL_ID;
          const roleLabel = request.role === 'general' ? 'campanha do general' : 'reino ' + request.context.kingdom.name;
          report('working', 'Analisando a ' + roleLabel + ' · dia ' + request.requestedDay + ' · ' + currentModel + '…', 1);
          activeAbortController = new AbortController();
          try {
            const result = await answerRequest(request, activeAbortController.signal);
            if (enabled && token === generation && currentEpoch === getWorldEpoch()) {
              const label = decisionLabel(request, result.decision);
              const decisionSummary = request.role === 'general'
                ? 'O general de ' + (request.context.kingdom?.name || 'um reino') + ' definiu: ' + label + '.'
                : 'O rei de ' + request.context.kingdom.name + ' escolheu: ' + label + '.';
              const latency = result.providerMetadata?.elapsedMs
                ? ' · ' + (result.providerMetadata.elapsedMs / 1000).toFixed(1) + ' s' : '';
              const device = result.providerMetadata?.device ? ' · ' + result.providerMetadata.device : '';
              if (result.accepted) report('ready', decisionSummary + latency + device, 1);
              else report('ready', 'Resposta descartada: a opção não está mais válida para ' + (request.context.kingdom?.name || 'a campanha') + '.', 1);
            }
            return result.accepted;
          } catch (error) {
            if (token !== generation || currentEpoch !== getWorldEpoch()) return false;
            const detail = describeError(error);
            await failKingdomAiRequest(request, { reason: detail, provider: AI_MODEL_MANIFEST.provider, model: requestModel?.model || MODEL_ID });
            console.warn('[Kingdom IA local] resposta estratégica inválida; o fallback determinístico assumiu:', detail);
            if (['TimeoutError', 'InferenceBackendError'].includes(error?.name) && enabled) {
              disable();
              report('error', (error.name === 'TimeoutError' ? 'A inferência excedeu o limite.'
                : 'A GPU falhou e a recuperação em CPU não foi concluída.')
                + ' As regras determinísticas assumiram. Reative a IA para tentar novamente.', 0);
            } else if (enabled) report('ready', 'A decisão de ' + (request.role === 'general' ? 'campanha' : 'estratégia do rei')
              + ' falhou; as regras determinísticas assumiram. Detalhe: ' + detail, 1);
            return false;
          }
        } catch (error) {
          if (token !== generation || currentEpoch !== getWorldEpoch()) return false;
          const detail = describeError(error);
          console.warn('[Kingdom IA local] não foi possível consultar a fila:', detail);
          if (enabled) report('ready', 'A fila dos reis falhou; a estratégia determinística continua ativa. Detalhe: ' + detail, 1);
          return false;
        } finally {
          if (token === generation) {
            activeAbortController = null;
            busy = false; pumpPromise = null;
            if (request && enabled) pump(true);
          }
        }
      })();
      return pumpPromise;
    }

    function syncWorld() { return setKingdomAiEnabled(enabled && !!engine); }

    return { enable, disable, pump, syncWorld, isEnabled: () => enabled, getStatus: () => Object.assign({}, state), modelId: MODEL_ID };
  }

  export default { create, parseDecision, parseStrategicDecision, parseStrictStrategicDecision, describeError, MODEL_ID };
