import { createRenderProfiler, RENDER_PHASES } from './render-profiler.js';

export function createRenderDiagnostics() {
  const profiler = createRenderProfiler();
  let host = null, fields = null, rows = null, lastRefresh = -Infinity;
  const ms = value => value.toFixed(2);

  function removePanel() { host?.remove(); host = fields = rows = null; }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download() {
    const report = profiler.snapshot({ includeSamples: true });
    saveBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      'kingdom-render-profile-' + new Date().toISOString().replaceAll(':', '-') + '.json');
  }

  function downloadMap() {
    document.getElementById('world')?.toBlob(blob => {
      if (blob) saveBlob(blob, `kingdom-map.${blob.type.split('/')[1] || 'png'}`);
    }, 'image/png');
  }

  function mountPanel() {
    if (host) return;
    host = document.createElement('kingdom-render-profiler');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = [
      '<style>',
      ':host{position:fixed;right:12px;bottom:80px;z-index:1100;display:block;width:min(360px,calc(100vw - 24px));color:#eee;font:12px/1.4 ui-monospace,monospace;color-scheme:dark}',
      '*{box-sizing:border-box}details{border:1px solid #77927f;border-radius:6px;background:#14231aef;box-shadow:0 4px 20px #0005}',
      'summary{padding:9px 12px;cursor:pointer;font-weight:600}.body{padding:0 12px 10px;max-height:min(50dvh,470px,calc(100dvh - 240px));overflow:auto}',
      'p{margin:7px 0}table{width:100%;border-collapse:collapse;font-size:11px}th,td{text-align:right;padding:3px 0;border-bottom:1px solid #ffffff16;font-variant-numeric:tabular-nums}',
      'th:first-child,td:first-child{text-align:left}th{color:#b6cbbd;font-weight:400}small{display:block;color:#b6cbbd;font-size:10px;margin-top:8px}',
      '.buttons{display:flex;gap:6px;padding:8px 12px;border-top:1px solid #ffffff16}details:not([open]) .buttons{display:none}button{font:inherit;font-size:11px;cursor:pointer;color:#eee;background:#294332;border:1px solid #647d6b;border-radius:3px;padding:5px 7px}button:hover{background:#3a5844}',
      'button:focus-visible,summary:focus-visible{outline:2px solid #e6c477;outline-offset:2px}@media(max-width:520px){:host{right:6px;bottom:76px;width:min(330px,calc(100vw - 12px))}}',
      '</style>',
      '<details open><summary id="headline">Profiler · aguardando quadros</summary><div class="body">',
      '<p id="cadence"></p><p id="frame"></p><p id="map"></p><p id="cache"></p><p id="chunks"></p>',
      '<table aria-label="Tempos das etapas de desenho"><thead><tr><th>Etapa</th><th>Média/desenho</th><th>p95/exec.</th></tr></thead><tbody id="stages"></tbody></table>',
      '<table aria-label="Entidades por categoria (amostragem)"><thead><tr><th>Entidade</th><th>Itens/desenho</th><th>CPU estimada</th></tr></thead><tbody id="entity-stages"></tbody></table>',
      '<p id="atmosphere"></p><p id="context"></p>',
      '<small>Janela móvel de 10 s, até 1.200 amostras. Tempos de CPU e envio de comandos; GPU e Worker não incluídos. A tabela por entidade só aparece com ?profile=1&amp;entityProfile=1; conta itens exatos e estima o tempo por amostragem rotativa (1/16), não inclui overlays fora do painter loop. Instrumentação altera os próprios tempos.</small>',
      '</div>',
      '<div class="buttons"><button id="reset" type="button">Zerar</button><button id="export" type="button">Exportar JSON</button><button id="map-png" type="button" title="Exportar o Canvas 2D sem a UI e a névoa separada">Mapa PNG</button><button id="close" type="button">Desativar</button></div>',
      '</details>',
    ].join('');
    fields = Object.fromEntries(['headline', 'cadence', 'frame', 'map', 'cache', 'chunks', 'atmosphere', 'context'].map(id => [id, root.getElementById(id)]));
    rows = {};
    const body = root.getElementById('stages');
    for (const [key, label] of Object.entries(RENDER_PHASES)) {
      const row = document.createElement('tr');
      const name = document.createElement('td'), average = document.createElement('td'), p95 = document.createElement('td');
      name.textContent = label;
      row.append(name, average, p95);
      body.append(row);
      rows[key] = { row, average, p95 };
    }
    root.getElementById('reset').addEventListener('click', reset);
    root.getElementById('export').addEventListener('click', download);
    root.getElementById('map-png').addEventListener('click', downloadMap);
    root.getElementById('close').addEventListener('click', disable);
    document.body.append(host);
    lastRefresh = -Infinity;
  }

  function refresh(timestamp = performance.now()) {
    if (!profiler.enabled || !host || document.hidden || timestamp - lastRefresh < 1000) return;
    lastRefresh = timestamp;
    const report = profiler.snapshot(), frames = report.frames, map = report.map;
    fields.headline.textContent = frames.samples ? 'Perf · RAF ' + frames.fps.toFixed(0) + ' FPS · mapa p95 ' + ms(map.p95Ms) + ' ms' : 'Profiler · aguardando quadros';
    fields.cadence.textContent = 'RAF ' + frames.fps.toFixed(1) + ' FPS · mapa ' + map.drawsPerSecond.toFixed(1) + ' desenhos/s';
    fields.frame.textContent = 'Intervalo p50/p95/máx: ' + [frames.p50Ms, frames.p95Ms, frames.maxMs].map(ms).join(' / ') + ' ms';
    fields.map.textContent = 'CPU RAF média/p95: ' + ms(frames.cpu.meanMs) + '/' + ms(frames.cpu.p95Ms) + ' ms · mapa: ' + ms(map.meanMs) + '/' + ms(map.p95Ms) + ' ms';
    fields.cache.textContent = 'Cache do terreno: ' + map.cache.hitPercent.toFixed(1) + '% acertos · ' + map.cache.rebuilt + '/' + map.samples + ' reconstruções';
    const chunks = report.context?.terrainChunks;
    fields.chunks.textContent = chunks ? 'Chunks: ' + chunks.entries + ' · ' + (chunks.bytes / 1024 / 1024).toFixed(1) + ' MiB · ' + chunks.rebuilds + ' rasterizações acumuladas' : '';
    for (const [key, values] of Object.entries(map.stages)) {
      rows[key].average.textContent = ms(values.meanMs);
      rows[key].p95.textContent = values.executions ? ms(values.executionP95Ms) : '—';
      rows[key].row.title = values.executions + ' execuções em ' + map.samples + ' desenhos; média por execução ' + ms(values.executionMeanMs) + ' ms';
    }
    const entityBody = host.shadowRoot.getElementById('entity-stages');
    const categoryStats = map.entityBreakdown;
    const ranked = Object.entries(categoryStats.categories).filter(([, value]) => value.count > 0)
      .sort((a, b) => (b[1].estimatedMsPerDraw ?? -1) - (a[1].estimatedMsPerDraw ?? -1))
      .slice(0, 12);
    const fragment = document.createDocumentFragment();
    for (const [name, values] of ranked) {
      const row = document.createElement('tr');
      const label = document.createElement('td'), count = document.createElement('td'), estimated = document.createElement('td');
      label.textContent = name;
      count.textContent = values.averageCountPerDraw.toFixed(1);
      estimated.textContent = values.estimatedMsPerDraw === null ? '—' : ms(values.estimatedMsPerDraw) + ' ms';
      row.title = values.samples + ' elementos amostrados; valores de CPU estimados, não tempos exatos/GPU';
      row.append(label, count, estimated); fragment.append(row);
    }
    entityBody.replaceChildren(fragment);
    fields.atmosphere.textContent = 'CPU névoa/update RAF: ' + ms(frames.stages.atmosphere.meanMs) + ' ms · quadros >33 ms: ' + frames.over33MsPercent.toFixed(1) + '%';
    const context = report.context;
    fields.context.textContent = context ? 'Zoom ' + Math.round(context.zoom * 100) + '% · ' + context.canvasWidth + '×' + context.canvasHeight + ' px · dia ' + context.day + ' · ' + (context.paused ? 'pausado' : context.speed + '×') : '';
  }

  function reset() { profiler.reset(); lastRefresh = -Infinity; refresh(); }
  function enable({ panel = true } = {}) {
    profiler.setEnabled(true);
    profiler.setVisible(!document.hidden);
    if (panel) mountPanel(); else removePanel();
    refresh();
  }
  function disable() { profiler.setEnabled(false); removePanel(); }
  const onVisibility = () => profiler.setVisible(!document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  const api = { enable, disable, reset, snapshot: options => profiler.snapshot(options), download, downloadMap,
    destroy() { disable(); document.removeEventListener('visibilitychange', onVisibility); if (window.kingdomProfiler === api) delete window.kingdomProfiler; } };
  window.kingdomProfiler = api;
  if (new URLSearchParams(window.location.search).get('profile') === '1') enable();
  return { profiler, refresh };
}
