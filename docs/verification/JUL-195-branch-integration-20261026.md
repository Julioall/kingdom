# Integração da base e verificação visual — JUL-195 — 26/10/2026

## Integração sem descarte de trabalho

- `kingdom/main` em `b36727648370ac52a02707b86fbcfcb5a9315d10` foi integrado à branch remota `test/kingdom-autonomous`, que estava em `3d54a5607fd91e6209c076242b9bf27635eb149b`.
- O merge `a0b1aca` preserva os cinco commits da branch de testes. O único conflito foi a adição complementar no fim de `README.md`; a solução manteve tanto as instruções de renderização quanto a validação de imagens e o benchmark de simulação.
- A branch da PR recebeu o merge da branch de testes em `1063468f54159169699af89b608b45f0cb10ccc2`. O único conflito de código foi no bloco de imports de `src/ui/game.js`; a resolução manteve o inspetor social e os módulos/caches/profiler do renderer.
- Os cinco relatórios locais não rastreados de JUL-178 foram mantidos fora do commit.

## Verificação no SHA integrado

- `npm ci`: concluído pelo `package-lock.json`, zero vulnerabilidades.
- `npm test`: **111/111 aprovados**; inclui combate, Worker, dependentes, mercados, logística de alimento, ajuda social e cache/profiler de renderização.
- `npm run build`: **aprovado**; TypeScript, Vite e otimização lossless de 489 PNGs para WebP, de 8,03 MiB para 5,27 MiB.
- `git diff --check`: sem erros.

## Playtest visual

- Servidor Vite local, mundo de seed 42, dia 0, simulação pausada. A abertura, pausa, zoom de 50% a 200%, painel opt-in do profiler e controles do mapa foram conferidos no navegador.
- A coleta do profiler mostrou 99,7% de acertos de cache depois do zoom e uma reconstrução de chunk. Uma janela do renderer otimizado registrou 36,4 FPS e p95 de desenho de 28,7 ms; a janela da referência registrou 32,1 FPS e p95 de 38,8 ms. São observações curtas em janelas diferentes, úteis para confirmar instrumentação, não uma comparação estatística de desempenho.
- Os screenshots controlados já versionados em `reports/optimization/optimized-map-final.png` e `reference-map-final.png` foram comparados no mesmo cenário. `visual-comparison-final.json` registra 0 de 824.320 pixels alterados e nenhuma diferença de canal. O painel está capturado em `reports/optimization/optimized-profiler.png` e `reports/render-profiler/production-profiler.png`.
- A UI permanece jogável com o painel recolhível; o painel é uma ferramenta de diagnóstico e cobre parte do mapa enquanto aberto.

## Decisão e limites

Manter a arquitetura Canvas 2D do mapa com simulação separada, cache por chunks e instrumentação opt-in. Os screenshots de referência e otimizado são visualmente idênticos no caso controlado. Não iniciar migração para WebGL: ela atravessaria desenho de sprites, recortes, caminhos, efeitos e ordem de profundidade sem benefício de gameplay demonstrado. O playtest confirma o fluxo e a comparabilidade visual; não satisfaz sozinho as lacunas abertas de gameplay em JUL-162, JUL-163, JUL-172 ou no marco M6.

Referências de arquitetura: skill Game Studio `web-game-foundations` e skill `game-playtest`. Evidência de comparação: `reports/optimization/visual-comparison-final.json`; instrumentação: `reports/render-profiler/verification.md` e `reports/render-profiler/production-paused-zoom200.json`.
