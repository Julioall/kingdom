# Verificação do profiler de renderização — 26/10/2026

- `node --test tests/render-profiler.test.mjs tests/atmosphere-zoom.test.mjs`: 11 testes aprovados.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado, com o aviso de tamanho do chunk JavaScript do Vite. A conversão de imagens continuou em 489 PNGs → WebP lossless, 8,03 → 5,27 MiB.
- Navegador, versão de produção: carregamento do mapa, ativação por `?profile=1`, pausa, zeragem da coleta, zoom em 200%, exportação JSON e desativação pelo botão conferidos. O painel deixa os controles de zoom acessíveis e pode ser recolhido.
- A abertura sem `?profile=1` não cria o painel. A implementação desativada não coleta amostras; essa condição também é coberta pelo teste de ausência de leituras do relógio.

## Captura de conferência

`production-paused-zoom200.json` foi baixado pelo botão **Exportar JSON** na versão compilada. Contém os agregados e as amostras originais. `production-profiler.png` registra a apresentação do painel, em outro instante da mesma sessão.

A captura JSON tem 335 intervalos RAF e 337 desenhos, com a simulação pausada no dia 69, semente 2537928938, zoom 200%, canvas 1280 × 644 e DPR 1. Foram observados 33,61 FPS, p95 do `drawMap` de 30,20 ms e média de 21,24 ms na etapa de entidades/efeitos, com 100% de acertos do cache do terreno na janela registrada.

Esses números servem para conferir a instrumentação nesta sessão do navegador. Não constituem uma comparação entre renderers nem uma meta de desempenho para outros dispositivos. Não foi capturada uma sequência controlada de pan. O relatório identifica Canvas 2D no mapa e WebGL na atmosfera; os tempos medem CPU/envio de comandos e não a conclusão da execução na GPU ou o processamento do Worker.

## Decisão sobre WebGL

A migração do mapa não é uma alteração pequena: os desenhos usam diretamente o contexto Canvas 2D para sprites, caminhos, padrões, recortes, seleção e composição de canvases auxiliares. Seria necessário adaptar essas operações e conferir a ordem de profundidade e a fidelidade visual. Esta etapa implementa a medição no renderer existente; uma migração deve ser comparada com otimizações locais a partir de capturas controladas.
