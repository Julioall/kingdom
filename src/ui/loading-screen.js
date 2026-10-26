const MINIMUM_VISIBLE_MS = 650;
const QUIET_PERIOD_MS = 550;
const EXIT_TRANSITION_MS = 420;

export function createLoadingScreen() {
  const screen = document.getElementById('loadingScreen');
  const app = document.querySelector('.app');
  const message = document.getElementById('loadingMessage');
  const percent = document.getElementById('loadingPercent');
  const progress = document.getElementById('loadingProgress');
  const progressFill = document.getElementById('loadingProgressFill');
  const resourceCount = document.getElementById('loadingResourceCount');
  const error = document.getElementById('loadingError');
  const retry = document.getElementById('loadingRetry');
  const startedAt = performance.now();
  const trackedImages = new WeakSet();
  const settledImages = new WeakSet();
  let requested = 0;
  let settled = 0;
  let worldReady = false;
  let lastActivityAt = startedAt;
  let furthestProgress = 0;
  let finishTimer = 0;
  let finished = false;
  let hasFailed = false;
  let imageObserver = null;

  function update() {
    if (!screen || finished) return;
    const assetProgress = requested ? settled / requested : 0;
    const nextProgress = worldReady ? 84 + assetProgress * 14 : assetProgress * 74;
    furthestProgress = Math.max(furthestProgress, nextProgress);
    const value = Math.min(98, Math.round(furthestProgress));
    progress?.setAttribute('aria-valuenow', String(value));
    if (progressFill) progressFill.style.width = value + '%';
    if (percent) percent.textContent = value + '%';

    if (worldReady && settled < requested) message.textContent = 'Carregando paisagem e estandartes…';
    else if (worldReady) message.textContent = 'Alinhando os últimos detalhes…';
    else if (requested && settled >= requested) message.textContent = 'Erguendo o mapa e fundando os reinos…';
    else message.textContent = 'Preparando o reino para despertar…';

    resourceCount.textContent = requested
      ? `Recursos visuais · ${settled} de ${requested}`
      : 'Preparando os primeiros recursos';
    scheduleFinish();
  }

  function settle(image) {
    if (!image || settledImages.has(image)) return;
    settledImages.add(image);
    settled++;
    lastActivityAt = performance.now();
    update();
  }

  function settleAfterDecode(image) {
    if (typeof image.decode === 'function' && image.naturalWidth > 0) {
      image.decode().catch(() => {}).finally(() => settle(image));
    } else settle(image);
  }

  function trackImage(image) {
    if (!image || trackedImages.has(image)) return image;
    trackedImages.add(image);
    requested++;
    lastActivityAt = performance.now();
    image.addEventListener('load', () => settleAfterDecode(image), { once: true });
    image.addEventListener('error', () => settle(image), { once: true });
    if (image.currentSrc && image.complete) queueMicrotask(() => settleAfterDecode(image));
    update();
    return image;
  }

  function scheduleFinish() {
    if (!worldReady || settled < requested || finishTimer || finished || hasFailed) return;
    const visibleRemaining = Math.max(0, MINIMUM_VISIBLE_MS - (performance.now() - startedAt));
    const quietRemaining = Math.max(0, QUIET_PERIOD_MS - (performance.now() - lastActivityAt));
    finishTimer = window.setTimeout(() => {
      finishTimer = 0;
      if (!worldReady || settled < requested || hasFailed) return;
      const remaining = Math.max(
        MINIMUM_VISIBLE_MS - (performance.now() - startedAt),
        QUIET_PERIOD_MS - (performance.now() - lastActivityAt)
      );
      if (remaining > 0) {
        finishTimer = window.setTimeout(() => { finishTimer = 0; scheduleFinish(); }, remaining);
        return;
      }
      finish();
    }, Math.max(visibleRemaining, quietRemaining));
  }

  function finish() {
    if (finished || !screen) return;
    finished = true;
    message.textContent = 'Tudo pronto. Os portões estão abertos.';
    progress?.setAttribute('aria-valuenow', '100');
    if (progressFill) progressFill.style.width = '100%';
    if (percent) percent.textContent = '100%';
    resourceCount.textContent = requested ? `${settled} recursos visuais preparados` : 'Mundo pronto';
    screen.setAttribute('aria-hidden', 'true');
    screen.classList.add('is-leaving');
    window.setTimeout(() => {
      screen.hidden = true;
      if (app) {
        app.inert = false;
        app.removeAttribute('aria-busy');
      }
      imageObserver?.disconnect();
    }, EXIT_TRANSITION_MS);
  }

  function fail(reason) {
    if (!screen || finished || hasFailed) return;
    hasFailed = true;
    imageObserver?.disconnect();
    window.clearTimeout(finishTimer);
    finishTimer = 0;
    message.textContent = 'Não foi possível preparar o reino.';
    resourceCount.textContent = '';
    error.textContent = reason?.message || 'O carregamento foi interrompido. Tente abrir o jogo novamente.';
    error.hidden = false;
    retry.hidden = false;
    retry.focus({ preventScroll: true });
  }

  function markWorldReady() {
    worldReady = true;
    lastActivityAt = performance.now();
    update();
  }

  retry?.addEventListener('click', () => window.location.reload());

  if (screen) {
    const trackAddedImages = node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node instanceof HTMLImageElement) trackImage(node);
      for (const image of node.querySelectorAll?.('img') || []) trackImage(image);
    };
    for (const image of document.images) trackImage(image);
    imageObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) trackAddedImages(node);
    });
    imageObserver.observe(document.body, { childList: true, subtree: true });
    retry.hidden = true;
    error.hidden = true;
  }

  return { trackImage, markWorldReady, fail };
}
