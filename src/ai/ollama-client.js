import { LOCAL_AI_SERVICE_ORIGIN } from './local-config.js';

const SERVICE_ORIGIN = LOCAL_AI_SERVICE_ORIGIN;

async function readJson(response) {
  let payload;
  try { payload = await response.json(); }
  catch (_) { throw new Error('O serviço local de IA retornou uma resposta inválida.'); }
  if (!response.ok) throw new Error(payload && payload.error || 'O serviço local de IA respondeu HTTP ' + response.status + '.');
  return payload;
}

export async function checkLocalAiService({ signal } = {}) {
  let response;
  try { response = await fetch(SERVICE_ORIGIN + '/health', { signal }); }
  catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new Error('Serviço de IA local indisponível. Inicie-o com “npm run ai:serve” e confira o Ollama.');
  }
  return readJson(response);
}

export async function requestLocalAiDecision(role, request, { signal } = {}) {
  let response;
  try {
    response = await fetch(SERVICE_ORIGIN + '/api/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role, request }),
      signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new Error('Não foi possível consultar o Ollama local. Verifique o serviço e tente novamente.');
  }
  const payload = await readJson(response);
  return payload;
}

export { LOCAL_AI_SERVICE_ORIGIN } from './local-config.js';
