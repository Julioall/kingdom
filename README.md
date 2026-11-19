## Mundo ampliado e população

### Composição inicial: 80% militares, 20% civis

Nas novas partidas abertas pelo navegador, a população inicial será composta por
**80% de soldados** e **20% de civis**, incluindo os governantes.
Com o padrão de **500 habitantes**, serão **400 soldados e 100 civis**
(200 militares e 50 civis por reino).
O modo experimental `?population=5000` inicializa **4.000 soldados e 1.000 civis**,
mas **não** constitui promessa de boa velocidade de simulação.

As tropas adicionais são guarnições fundadoras, organizadas em unidades reais
de até dez combatentes com comandantes e generais. O centro militar registra
a capacidade de pessoal fundador. Recrutamento **posterior**, pagamentos e
alimentação continuam usando as regras do mundo, sem recursos infinitos.
Para iniciar um mundo diretamente pela API do motor e preservar os testes
históricos, omita `initialMilitaryShare`; para reproduzir a proporção nova,
use `Sim.createWorld(seed, { initialPopulation: 500, initialMilitaryShare: .8 })`.

A divisão de 80/20 é **inicial**. Óbitos, nascimentos, recrutamento e
desmobilização podem alterar a proporção ao longo dos dias. Um exército
com quatro vezes mais soldados que civis é economicamente frágil:
testes de suprimento, salários e sustentabilidade a longo prazo
são necessários antes de considerá-lo equilibrado.

O mapa novo usa **160 × 160 células** (25.600 tiles), contra as 112 × 112 (12.544 tiles) anteriores: aproximadamente **104% mais área**. A versão no navegador inicia com **500 habitantes** divididos entre os dois reinos, substituindo a população padrão anterior de 96.

Use `?population=96` para uma partida leve, `?population=500` para a ampliação padrão ou `?population=5000` para o teto **experimental de estresse** verificado nos benchmarks. A população escolhida é preservada ao reiniciar por seed. Valores fora do intervalo de 96 a 5.000 não são utilizados. Com `population=5000`, o jogo usa transferência compacta de atores e orçamento cognitivo adaptativo por padrão; `?transport=full&cognitiveBudget=off` permite comparar a versão integral, com alto custo.

**Limite medido (GitHub Actions, seed 42, 19/11/2026):** criar 5.000 habitantes na ilha de 160×160 levou aproximadamente 4,1 s, com 773,8 MB de heap após o primeiro dia; **simular um único dia levou 83,9 s** no runner. É um teto de estresse, **não um tamanho jogável garantido**. Com 500 habitantes e seed 2026, o primeiro dia levou cerca de 1,63 s no mesmo tipo de runner. Desempenho em navegadores e sustentabilidade econômica continuam sujeitos a validação. A densidade inicial grande não cria moradias ou alimentos infinitos.

Ferramenta de reprodução: `node scripts/verify-expanded-world.mjs --seed=42 --population=5000`. A CI de `.github/workflows/expanded-world.yml` exercita a criação e um dia real da simulação. Os benchmarks históricos de paridade continuam usando o mapa clássico de 112×112 via `KINGDOM_WORLD_PRESET=classic`, separadamente da nova validação do mapa ampliado.

# Kingdom

Simulação de dois reinos, seus moradores, território e ecologia, executada no navegador.

O padrão de organização e integração dos recursos está em [Arquitetura dos assets](docs/architecture/assets.md). Sprites, interface e áudio são separados pelo uso no jogo; `npm run assets:check` valida os arquivos registrados antes do build.

> **Direção de produto (17/11/2026):** priorizar economia, política, guerras e comportamento auditável de IAs. Ecologia detalhada e compatibilidade com saves históricos deixam de orientar novas funcionalidades. A substituição dos sistemas ecológicos existentes será incremental para não quebrar produção e suprimento. [Decisão e plano de desempenho](docs/decisions/2026-11-17-focus-economy-politics-military-ai.md).

## Executar localmente

```sh
npm install
npm run dev
```

`npm run dev` inicia apenas o Vite. A integração com modelos de linguagem locais foi removida: o jogo não exige Ollama, WebGPU para LLM, nem download de pesos. Reis e generais usam o planejamento determinístico e os personagens preservam a política neural leve compartilhada.

Para validar o build de produção, execute `npm run build` e depois `npm run preview`.

Durante o build, as imagens PNG publicadas são convertidas para WebP sem perdas apenas em `dist`, reduzindo o tráfego sem alterar os arquivos-fonte.

## Testes de renderização acima de 60 Hz

O limite tradicional de 60 desenhos de mapa por segundo pode ser alterado **somente para comparação**: `?renderHz=144&seed=42&profile=1` solicita até 144 desenhos/s, enquanto `?renderHz=display&seed=42&profile=1` acompanha cada callback de `requestAnimationFrame`. Sem o parâmetro, o limite segue em 60. Eventos urgentes de redesenho continuam atendidos. A frequência real é limitada pelo monitor e pelo custo do quadro; esse parâmetro **não garante** 144 FPS.

Compare o mesmo cenário/zoom/resolução com e sem o parâmetro, observando FPS de RAF, `desenhos/s`, p95 do desenho e tempo de aplicação de snapshots. `npm test` inclui regressões do escalonador e do índice de atores. Para a metodologia e as metas, consulte [a decisão de produto e desempenho](docs/decisions/2026-11-17-focus-economy-politics-military-ai.md).

## Medir a renderização

Abra o jogo com `?profile=1` (por exemplo, `http://127.0.0.1:5173/?profile=1`) para exibir o profiler. Depois do carregamento, use **Zerar** e observe o mapa parado, movendo a câmera e em diferentes níveis de zoom. Compare cenários com a mesma semente, dia, velocidade e tamanho de janela; para isolar a renderização, pause a simulação.

O painel mostra FPS do `requestAnimationFrame`, desenhos do mapa por segundo, tempo de quadro p50/p95/máximo, CPU do callback e do `drawMap`, tempos por camada e reconstruções do cache do terreno. A janela móvel tem 10 segundos e limite de 1.200 amostras. Etapas reaproveitadas do cache contam como zero na média por desenho; o p95 da etapa considera apenas as execuções. Pausas por aba oculta são excluídas, mas travamentos com a página visível entram na medição.

**Exportar JSON** salva os agregados, as amostras e o contexto da câmera/mundo. **Mapa PNG** baixa o Canvas 2D em PNG sem a interface e sem a névoa, para comparar o raster do mapa. No console, `window.kingdomProfiler.enable()` ativa o painel, `enable({ panel: false })` coleta sem painel, `reset()` inicia outra captura, `snapshot()` consulta os agregados, `download()` exporta e `disable()` desativa. Sem ativação, não há painel, timers nem coleta de amostras.

Essas métricas medem CPU e envio de comandos Canvas/WebGL na thread principal. A execução assíncrona na GPU e a simulação no Worker exigem ferramentas de profiling próprias; seus tempos não são inferidos a partir do FPS.

O terreno usa chunks de até 16 × 16 células, com raster em resolução física, descarte das áreas fora da câmera e limite de 32 MiB para as superfícies em cache. Mover a câmera reaproveita os chunks; mudanças no solo/estradas invalidam apenas os blocos afetados e suas bordas. Tiles da atlas pixelada são pré-rasterizados no tamanho físico de destino, mantendo a mesma amostragem nas superfícies de chunks com origens diferentes. Zoom, troca de assets e transição de estação recriam o raster correspondente. Os sprites mantêm a ordenação por profundidade e as animações.

Para comparar com o caminho de renderização sem chunks no mesmo build, use `?profile=1&render=reference&seed=42&paused=1&effects=fixed`. A mesma URL sem `render=reference` usa as otimizações. `seed` fixa o mundo; `paused=1` inicia pausado; `effects=fixed`, disponível no modo de profiling, congela a deriva atmosférica para comparações visuais. Essas opções não alteram a inicialização padrão do jogo.

`npm run verify:images`, depois do build, compara os pixels RGBA de todos os PNGs-fonte com os WebP publicados. `npm run bench:simulation -- --output=reports/optimization/simulation.json` registra tempos por dia e hashes do estado para detectar mudanças na simulação.

## Perfil leve de processamento

A rede neural compartilhada usa 16 neurônios por camada oculta (em vez de 24 para pessoas), sem remover as necessidades, o controle tático ou as decisões individuais. Animais silvestres cujas decisões já são inteiramente determinadas pelas regras de sobrevivência não precisam executar uma inferência neural descartada. A procura por água reutiliza a busca local antes de procurar a uma distância maior.

**Atenção:** a largura menor altera as decisões aprendidas/geradas e pode mudar partidas futuras. O clima, a hidrologia, o metabolismo diário e o ciclo semanal das plantas foram mantidos: desacelerá-los sem validação mudaria a causalidade ecológica. Ganho de FPS, CPU e memória deve ser medido em navegador real e mundo de mesma semente; o ganho de desempenho geral ainda não foi quantificado.
