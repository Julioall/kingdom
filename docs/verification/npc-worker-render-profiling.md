# CPU dos NPCs x Worker x Canvas: protocolo de medição

## Objetivo

Identificar as funções mais caras da simulação de NPCs **sem mudar decisões, prioridades, política neural, caminhos ou ritmo dos atores**. Separar o custo de simulação (Worker), a construção dos snapshots, a transferência/aplicação de mensagens e o custo de desenho (thread principal e Canvas). A meta de **144 FPS** continua independente da otimização de uma função isolada.

## 1. Amostragem repetida das funções de NPCs

`npm run bench:npc-hotspots -- --populations=100,500 --seeds=1,42 --warmup=1 --days=2 --repeats=3 --sampling-us=1000 --output=out/npc-workloads/cpu.json --profile-dir=out/npc-workloads/profiles`

A cada repetição:

1. Criar dois mundos autoritativos idênticos, com a mesma população, seed e quantidade de dias de aquecimento.
2. Ativar o profiler de amostragem do V8 **somente durante `stepDay`** do primeiro mundo, sem snapshots.
3. Executar a mesma quantidade de dias no segundo mundo, sem profiler.
4. Comparar os hashes autoritativos **após**, fora das janelas de medição. Diferença falha o benchmark.
5. Escrever tempos de cada dia, sumário de CPU com arquivo/linha, amostras por área e arquivo `.cpuprofile` bruto para cada combinação.

Áreas categorizadas com funções reais de produção:

| Área | Exemplos |
|---|---|
| Busca de rota | `findPreferredRoute`, `findRouteStep` |
| Cache de rota | `rememberedRouteStep`, `commonRouteFrom` |
| Congestionamento | `localCongestionStep`, `persistentCongestionStep`, `respondToPassageRequest` |
| Colisões | `canEnter`, `canStep`, `collidesWithWorldAt`, `hitboxesOverlap`, índice espacial |
| Movimento | `moveOne`, `reachableAreaAround`, `corralWaypoint` |
| Decisões | `selectNpcActivity`, `choosePeopleAction`, `chooseMilitaryAction` |
| Tarefas | `assignCommunityTasks`, `completeCommunityTask`, `constructionTaskProgress` |
| Planejamento de obras | `chooseBuildSite`, `workOnCommunityStructure`, `hasBuildingResourceClearance` |

O relatório contém **amostras exclusivas** (função em execução) e **inclusivas** (a função ou um ancestral está na pilha). Áreas inclusivas se sobrepõem quando A* chama colisão ou o movimento chama A*: **não somar suas porcentagens**. Porcentagem de amostras do V8 não é duração exata de uma função em milissegundos.

A saída inclui média, mediana e p95 do custo de um dia, separadas por população/seed. `controlDayMs` é referência sem instrumentação, não um A/B de implementação: as duas execuções são sequenciais e são afetadas por carga da máquina, compilação JIT e coleta de lixo. Para testar uma otimização, comparar **commits diferentes no mesmo host**, com as mesmas seeds, repetições e paridade.

A CI executa 3 repetições por cenário de 100/500 agentes e seeds 1/42. O acionamento manual para 5.000 personagens usa 2 repetições, seed 42 e nenhum dia de aquecimento, mantendo a comparação autoritativa com controle para limitar o custo do job. Esse modo identifica hotspots na escala de estresse, mas não substitui comparações de longo prazo.

## 2. Navegador: desenhar sem simular x desenhar com Worker ativo

`npm run bench:render-worker -- --duration=3500 --repeats=3 --output=out/npc-workloads/render-worker.json`

O teste abre páginas novas em Chromium, 1440x900 DPR 1, seed 42, efeitos fixos, `renderHz=144` e câmera com o mesmo zoom. Alterna a ordem dos dois cenários a cada repetição:

- **renderOnly:** `?paused=1`. Simulação pausada, RAF e Canvas ativos, revela custo de desenho sem avanço de dias.
- **workerAndRender:** jogo avançando normalmente, com os mesmos instrumentos de renderização e coleta de respostas do Worker.

Coleta separadamente:
- FPS de RAF e p50/p95 do intervalo entre frames;
- duração da execução da thread principal, envio de comandos Canvas e etapas de desenho;
- quando houver respostas `advance`, `workerTiming.simulationMs`, `workerTiming.captureMs` e tempo de ida e volta da mensagem;
- quantidade de dias efetivamente avançados e erros do navegador.

**Não subtraia** o FPS pausado do ativo para estimar custo do Worker: o jogo pausado pode acionar menos redesenhos graças aos caches, e a thread do Worker concorre pela CPU com o navegador. A ida/volta inclui fila e comunicação, enquanto `simulationMs` é a parte interna da simulação. O WebGL/Canvas ainda pode usar GPU assincronamente: RAF e chamadas de desenho não medem o término da GPU.

## 3. Teste na máquina do jogador

Os resultados headless do GitHub Actions usam SwiftShader e **não validam 144 FPS em GPU real**. Rode o navegador com aceleração habilitada:

`npm run bench:render-worker -- --headful=1 --duration=8000 --repeats=3`

Registre monitor/taxa de atualização, modelo de CPU/GPU, navegador, DPR, viewport, renderHz e atividade de outras abas. Para 144 FPS, o orçamento teórico por quadro é aproximadamente **6,94 ms**. É necessário observar cadência sustentada, p95/p99, simulação do Worker, transporte e qualidade visual, em mundo ativo e populoso; a resolução e o hardware influem.

## 4. Decidir sobre novas bibliotecas

Uma biblioteca de pathfinding, motor de física ou rasterização deve entrar **depois** de medir a participação real do seu gargalo no perfil total. Comparar candidatos em A/B com pesos de estrada, permissões territoriais, empates, desvio de ocupantes, gates de currais e captura da mesma configuração. É inadmissível alterar a ordem de decisão do NPC ou consumir RNG de forma diferente para conseguir FPS.

Critério para otimização: ganho repetido no cenário relevante, estado autoritativo idêntico, ausência de regressões de CPU/GC, interatividade e fluxo de renderização. Sem melhora sustentada, rejeitar.

## 5. Execução automatizada

`.github/workflows/npc-repeated-profiles.yml` executa dois jobs independentes: CPU Node/V8 e browser Chromium. Publica arquivos JSON e os `.cpuprofile` para abrir no DevTools. O workflow V2 existente continua com ensaios de paridade em mais dias, e V3 continua responsável pelo stress de 5.000 NPCs, que não deve ser substituído por microbenchmarks.

Esta etapa **adiciona instrumentos**, não uma nova política de NPCs. A meta de 144 FPS permanece aberta enquanto não houver validação de FPS e latências em hardware real.
