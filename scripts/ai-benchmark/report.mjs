export function renderMarkdown(summary, baseline) {
  const fmt = n => n == null ? '—' : n.toFixed(1);
  const fmt2 = n => n == null ? '—' : n.toFixed(2);
  const baselineText = baseline.length
    ? `${baseline.filter(row => row.correct).length}/${baseline.length} acertos. Não é uma rede TinyML treinada.`
    : 'não aplicável para a seleção atual de papéis.';
  const lines = ['# Comparação de modelos pequenos — Kingdom', '',
    'Acerto utilizável = ação do gabarito + contrato JSON completo + resposta não truncada. Erros contam como falha.',
    'Gabaritos editoriais; não mede vitória, sobrevivência ou desempenho no navegador/WebLLM.',
    `Referência determinística atual do rei: ${baselineText}`, '',
    '| Papel | Modo | Modelo | N | Utilizável % | Ação correta % | JSON válido % | Parser jogo % | Erros | Mediana ms | p95 ms | tokens/s |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const s of summary) lines.push(`| ${s.role} | ${s.mode} | ${s.model} | ${s.cases} | ${fmt(s.successPct)} | ${fmt(s.correctPct)} | ${fmt(s.schemaPct)} | ${fmt(s.parserPct)} | ${s.errors} | ${fmt(s.medianMs)} | ${fmt(s.p95Ms)} | ${fmt(s.tokensPerSecond)} |`);
  lines.push('', '## Custo e eficiência local', '',
    'Inferência local: US$ 0 por chamada/token (sem API paga). Energia em kWh/R$ não é estimada porque este computador não fornece medição de potência durante cada modelo.',
    'Pesos é o artefato instalado pelo Ollama. Alocação do modelo vem de /api/ps; RAM e CPU de processo são amostradas no Windows durante cada chamada.',
    '', '| Papel | Modo | Modelo | Pesos MB | Aloc. Ollama MB | VRAM reportada MB | RAM processo p95 MB | CPU ms/decisão | CPU % 1 núcleo | Acertos/min | Decisões/CPU-s | s/acerto |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of summary) lines.push(`| ${s.role} | ${s.mode} | ${s.model} | ${fmt(s.modelDiskMb)} | ${fmt(s.ollamaLoadedMb)} | ${fmt(s.ollamaVramMb)} | ${fmt(s.processPeakRamMb)} | ${fmt(s.medianCpuMs)} | ${fmt(s.medianCpuPercent)} | ${fmt2(s.correctActionsPerMinute)} | ${fmt2(s.usableDecisionsPerCpuSecond)} | ${fmt2(s.secondsPerCorrectAction)} |`);
  lines.push('', 'Resultados ordenados por acerto utilizável dentro de cada papel/modo; velocidade desempata.',
    'Latências são de chamadas aquecidas concluídas; falhas/timeouts aparecem na coluna Erros. Acertos/min e segundos/acerto incluem o tempo total das chamadas, inclusive respostas incorretas e erros. CPU é tempo de processador dos processos Ollama; pode passar de 100% ao usar mais de um núcleo. RAM é o working set no Windows. Carregamento e aquecimento estão em metadata.json.',
    'Não compare papéis como se fossem a mesma tarefa. O modo plain expõe falhas de formato; o modo schema limita a estrutura de saída.',
    'Confiança e justificativa são salvas para revisão humana, sem nota automática de qualidade ou de idioma.');
  return lines.join('\n') + '\n';
}
