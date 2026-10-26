# Kingdom

Simulação de dois reinos, seus moradores, território e ecologia, executada no navegador.

## Executar localmente

```sh
npm install
npm run dev
```

`npm run dev` inicia o Vite e o serviço de IA local. O Ollama precisa estar instalado e aberto. Confira os modelos com `npm run ai:prepare -- --check`; `npm run ai:prepare -- --pull` baixa somente os modelos que faltam. Os pesos ficam no armazenamento do Ollama e o registro local de digest fica em `.local/`, fora do Git.

Para validar o build de produção com o mesmo serviço local, execute `npm run build` e depois `npm run preview`.

Durante o build, as imagens PNG publicadas são convertidas para WebP sem perdas apenas em `dist`, reduzindo o tráfego sem alterar os arquivos-fonte.

## Medir a renderização

Abra o jogo com `?profile=1` (por exemplo, `http://127.0.0.1:5173/?profile=1`) para exibir o profiler. Depois do carregamento, use **Zerar** e observe o mapa parado, movendo a câmera e em diferentes níveis de zoom. Compare cenários com a mesma semente, dia, velocidade e tamanho de janela; para isolar a renderização, pause a simulação.

O painel mostra FPS do `requestAnimationFrame`, desenhos do mapa por segundo, tempo de quadro p50/p95/máximo, CPU do callback e do `drawMap`, tempos por camada e reconstruções do cache do terreno. A janela móvel tem 10 segundos e limite de 1.200 amostras. Etapas reaproveitadas do cache contam como zero na média por desenho; o p95 da etapa considera apenas as execuções. Pausas por aba oculta são excluídas, mas travamentos com a página visível entram na medição.

**Exportar JSON** salva os agregados, as amostras e o contexto da câmera/mundo. **Mapa PNG** baixa o Canvas 2D em PNG sem a interface e sem a névoa, para comparar o raster do mapa. No console, `window.kingdomProfiler.enable()` ativa o painel, `enable({ panel: false })` coleta sem painel, `reset()` inicia outra captura, `snapshot()` consulta os agregados, `download()` exporta e `disable()` desativa. Sem ativação, não há painel, timers nem coleta de amostras.

Essas métricas medem CPU e envio de comandos Canvas/WebGL na thread principal. A execução assíncrona na GPU e a simulação no Worker exigem ferramentas de profiling próprias; seus tempos não são inferidos a partir do FPS.

O terreno usa chunks de até 16 × 16 células, com raster em resolução física, descarte das áreas fora da câmera e limite de 32 MiB para as superfícies em cache. Mover a câmera reaproveita os chunks; mudanças no solo/estradas invalidam apenas os blocos afetados e suas bordas. Tiles da atlas pixelada são pré-rasterizados no tamanho físico de destino, mantendo a mesma amostragem nas superfícies de chunks com origens diferentes. Zoom, troca de assets e transição de estação recriam o raster correspondente. Os sprites mantêm a ordenação por profundidade e as animações.

Para comparar com o caminho de renderização sem chunks no mesmo build, use `?profile=1&render=reference&seed=42&paused=1&effects=fixed`. A mesma URL sem `render=reference` usa as otimizações. `seed` fixa o mundo; `paused=1` inicia pausado; `effects=fixed`, disponível no modo de profiling, congela a deriva atmosférica para comparações visuais. Essas opções não alteram a inicialização padrão do jogo.

`npm run verify:images`, depois do build, compara os pixels RGBA de todos os PNGs-fonte com os WebP publicados. `npm run bench:simulation -- --output=reports/optimization/simulation.json` registra tempos por dia e hashes do estado para detectar mudanças na simulação.
