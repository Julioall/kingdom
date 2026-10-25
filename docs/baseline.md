# Baseline técnico do Kingdom

Checkpoint de 23/10/2026 preservado como referência histórica. Em 24/10, o mapa 128 × 128 foi revalidado após a integração do AutoTile. As medições indicam o comportamento deste cenário e não certificam escalas maiores.

## Decisão sobre o mapa

O checkpoint medido em 23/10 usava **96 × 96 células**. Em 24/10, o mapa padrão foi ampliado para **128 × 128**, com integração do AutoTile e uma nova bateria de validação. Os números de throughput e memória de 96 × 96 abaixo são históricos; as medições do mapa atual aparecem ao final deste documento. A fixture de movimento agora acompanha `Sim.width` e `Sim.height`. A verificação territorial também foi alinhada ao domínio atual: terras sem dono são comuns e não precisam pertencer a um reino.

A próxima expansão considerada é 288 × 288, ou 82.944 células (9 vezes o checkpoint antigo de 96 × 96 e 5,06 vezes a área atual); esse tamanho ainda não foi medido. `cellAt` usa a largura global configurada, e os testes de movimento seguem o mapa atual.

## Ambiente

- Windows 11 Pro 10.0.26200, 64 bits; Intel Core i3-10105 @ 3.70 GHz.
- Node.js v24.19.0; npm 12.2.0; Vite 8.3.5; TypeScript 7.0.2; `@mlc-ai/web-llm` 0.2.86.
- Smoke test local no navegador integrado: user agent Chromium/Chrome 155.0.0.0, viewport 1280 × 720, DPR 1. O servidor Vite escolheu a porta 5175 porque 5173 e 5174 já estavam ocupadas.
- Medição de throughput e memória feita em Node.js, não no navegador.

## Build e testes

| Comando | Resultado |
| --- | --- |
| `npm run build` | Passou: `tsc --noEmit` e Vite transformaram 49 módulos. Bundle principal 300,29 kB (100,55 kB gzip); Worker de simulação 215,61 kB. |
| `npm test` | 87 passaram, 0 falharam; 27,9 s. |
| `npm run baseline` | Determinismo completo passou nos primeiros 10 dias; três medições de 90 dias, mediana 17,09 dias/s. |
| `npm run worker-baseline` | Três medições do runtime, transferência e hidratação com lote de 3 dias; mediana 12,26 dias/s. O Worker não cria o resumo retornado por `stepDay` nos dias intermediários. |
| Replay frontier de 730 dias, seed 42 | 42 pessoas vivas; contadores globais: 9 mortes por fome e 1 em combate. Colheita vegetal 25.251,7; colheita cultivada 922,5 e regeneração cultivada 1.909,2. Uma roça concluiu no dia 119, com 22 células, e terminou com 746,9 unidades no campo; outra ficou em 0/34 dias de trabalho. |
| Replay frontier de 730 dias, seed 2026 | 46 pessoas vivas; contadores globais: 3 mortes por fome e 1 por ferimento. Colheita vegetal 24.995,4; nenhuma colheita ou regeneração cultivada. Duas roças ficaram incompletas em 19/34 e 27/34 dias de trabalho. |
| Reconciliação econômica frontier, seed 2026/730 | Saldos não atribuídos de tesouro, comunidade e mercado: zero nos dois reinos após registrar transferências de campanha, construção, manutenção, impostos e reposição comunitária. O replay continuou com 3 mortes por fome e 1 por ferimento; reconciliação exata não comprova sustentabilidade alimentar. |
| Replay histórico de 365 dias | No checkpoint anterior de sobrevivência, seed 42 terminou com 50 pessoas e 27 animais vivos e zero mortes. Esse resultado não representa o checkpoint agrícola atual. |
| Diagnóstico histórico de 500 dias | Checkpoint anterior, matriz de sementes: 1 = 52 pessoas/32 animais; 42 = 51/31; 987 = 51/28; 2026 = 50/30. Todas as causas de morte ficaram em zero nas quatro execuções. Esses resultados não substituem os replays atuais de 730 dias nem comprovam a sustentação dos fluxos econômicos. |

O build avisa sobre chunks acima de 500 kB: `lib` tem 6.138,56 kB (2.194,03 kB gzip) e `llm.worker` tem 6.124,25 kB. Na compilação atual, o bundle principal tem 300,29 kB (100,55 kB gzip), o Worker de simulação 215,61 kB, o HTML 9,54 kB (3,29 kB gzip) e o CSS 16,07 kB (4,49 kB gzip). A IA local é opcional; este aviso de tamanho não demonstra que o chunk seja baixado no primeiro carregamento.

Os testes atuais cobrem movimento e rotas no mapa 128 × 128, incluindo desvio de bloqueios e rampas; geração de ilha conectada e relevo, água e percepção costeira, round-trip de snapshots, sobrevivência por 253 dias, economia, estratégia, campanhas e fronteira, replay determinístico do Worker e equivalência da atualização territorial com a regra anterior. A suíte completa passou com 87/87 após a otimização do Worker que descarta resumos diários intermediários. Os replays de 730 dias e os resultados anteriores de 500 dias documentados acima pertencem a checkpoints agrícolas/sobrevivência anteriores e não foram repetidos nesta validação.

## Determinismo, throughput e memória

Execute `npm run baseline` para repetir a medição. O script `scripts/measure-baseline.mjs` usa semente 42, verifica igualdade profunda do estado completo após a criação e após cada um dos primeiros 10 dias, aquece por 5 dias e mede 90 dias em 3 mundos novos.

Configuração inicial: 96 × 96 (9.216 células), 2 reinos, 51 moradores, 26 animais e 40 estruturas. As três amostras foram 15,47, 15,93 e 15,40 dias simulados por segundo; a mediana foi **15,47 dias/s**. Uma execução de 365 dias corresponderia a aproximadamente 23,6 s de tempo de CPU nesta medição Node, sem incluir renderização.

Com coleta explícita de lixo antes das leituras, o RSS foi 280,82 MiB antes de criar o mundo, 286,75 MiB após a criação e 394,03 MiB após 5 dias de aquecimento e 90 dias medidos. O heap usado foi 8,44, 27,23 e 32,13 MiB, respectivamente. Assim, o heap usado após GC cresceu 4,90 MiB durante o trecho simulado; o RSS observado cresceu 107,28 MiB. RSS inclui heap comprometido e memória nativa do processo, portanto esta leitura de um cenário não permite atribuir a diferença a um vazamento nem estimar memória por reino.

No smoke test de navegador, o Canvas tinha backing store de 2048 × 2048 px e aparecia com 646 × 646 px no viewport. `performance.memory` mostrou 27 MiB usados de 86 MiB alocados para o heap JavaScript durante a observação. A interface carregou sem erros ou avisos de console; pausar e avançar manualmente moveu o calendário do dia 56 para o dia 57. Essa leitura pontual não equivale à medição de RSS do Node.

## Comparação após M1

No baseline M0, `GameSession.advance()` chamava `stepDay()` sincronamente na thread principal. O M1 moveu a propriedade mutável do mundo para `src/simulation/simulation.worker.ts`, com protocolo versionado, comandos validados e snapshots compactos. A tela continua em Canvas 2D; pausa, avanço manual, velocidade, inspeção e comandos passam pela projeção retornada pelo Worker. O detalhe fica em [worker-protocol.md](./worker-protocol.md).

O medidor do Worker usa a mesma semente, mapa, 5 dias de aquecimento e 90 dias medidos em 3 execuções. Ele simula `postMessage` com `structuredClone` e transferência dos buffers e hidrata a projeção no lado principal, excluindo renderização Canvas e escalonamento entre threads. A comparação original abaixo é histórica e usa 96 × 96; as medições atuais do mapa 128 × 128 aparecem depois dela.

| Medida histórica (96 × 96) | Motor síncrono | Caminho do Worker, lote de 3 dias |
| --- | ---: | ---: |
| Dias simulados/s (mediana) | 15,47 | 12,36 |
| Amostras | 15,47 · 15,93 · 15,40 | 11,93 · 12,94 · 12,36 |
| Bytes das colunas de tiles | — | 1.133.568 |
| Base serializada (V8) | — | 344.687 bytes |
| Snapshot serializado (V8) | — | 1.480.229 bytes na primeira amostra |

No mapa atual de 128 × 128 (16.384 células), com 2 reinos, 50 moradores, 24 animais e 40 estruturas, o motor síncrono mediu 17,09 dias/s de mediana (amostras 17,09, 17,77 e 16,41). O Worker mediu 12,26 dias/s (11,86, 12,26 e 12,74), com o resumo intermediário de `stepDay` desativado. Em um A/B de três amostras, reativar esse resumo deu 11,85 dias/s; runtime/projeção caiu de 5.917,77 para 5.514,23 ms em 90 dias (−6,8%), enquanto a mediana total variou de 11,85 para 12,26 dias/s (+3,5%). Os bytes do snapshot inicial não mudaram: colunas de tiles 2.342.912 bytes, base serializada 391.809 bytes e snapshot 2.736.694 bytes. A amostra é curta e não comprova as metas gerais; memória pós-GC variou muito entre as execuções A/B e requer repetição controlada. Esses valores excluem o Canvas e o escalonamento real entre threads.

No checkpoint histórico de 96 × 96, o custo mediano por etapa em 90 dias e 30 snapshots de 3 dias foi 6.195 ms no runtime e criação da projeção, 915 ms no clone/transferência e 203 ms na hidratação. Antes do corte do resumo diário, a amostra de 128 × 128 registrou 5.917,77 ms, 1.223,17 ms e 450,54 ms. Com o corte, as medianas foram 5.514,23 ms, 1.269,71 ms e 474,41 ms, respectivamente. O medidor agrupa simulação e criação do snapshot de resposta na primeira etapa; os totais não isolam o custo de `stepDay`.

O `npm run profile-simulation` mede as fases internas de `stepDay`, com instrumentação separada; não compare seu throughput ao modo normal. Antes da otimização territorial, pessoas e os dois recálculos de território consumiam ~69,7% do tempo mediano. O recálculo foi alterado para pré-filtrar castelos e torres elegíveis e indexar reinos, mantendo as distâncias, a ordem dos empates e a aplicação das reivindicações. Um comparativo de 90 dias × 3, seed 42, reduziu os dois recálculos juntos de 30,07 ms para 5,23 ms por dia (~83%); na seed 2026, de 24,68 ms para 5,08 ms (~79%). A comparação dedicada confirma mapa e contagens idênticos à implementação anterior.

Após a mudança, seed 42 teve mediana/p95 diário de 57,53/107,01 ms e seed 2026 de 53,34/105,52 ms, com cobertura de fases de 99,91% e 99,90%. As pessoas ficaram em 47,84% e 47,39%; cada recálculo territorial em ~4,35–4,49%, somando perto de 56,5% com pessoas. A medição foi de três repetições por seed; p95 ainda varia e requer cargas e repetições adicionais. O maior custo atual é o processamento de pessoas, não o clima/ecologia.

Uma comparação histórica de lotes em 96 × 96, com três repetições de 90 dias, mediu:

| Dias por snapshot | Dias/s mediana | Clone/transferência em 90 dias | Hidratação em 90 dias | Snapshots |
| ---: | ---: | ---: | ---: | ---: |
| 3 | 12,36 | 915 ms | 203 ms | 30 |
| 6 | 13,17 | 474 ms | 122 ms | 15 |
| 12 | 13,59 | 256 ms | 62 ms | 8 |

O lote de 12 dias aumentou o throughput medido em 9,9% sobre o de 3 dias, mas a interface mantém o limite de 3 dias por resposta para que a pausa espere no máximo um lote curto. Os lotes de 6 e 12 dias são apenas comparações do medidor e não alteram o comportamento da UI.

Na comparação histórica de 96 × 96, o caminho de snapshots mediu cerca de 15,3% menos throughput que o motor síncrono. Agrupar três dias reduz o número de serializações; uma amostra exploratória anterior de 30 dias mediu 15,84 dias/s com lote de três, comparada com 13,53 com lote de dois. No mapa atual, a interface continua solicitando até três dias por resposta para limitar a pausa.

Na amostra histórica de 96 × 96 do medidor do Worker, o heap usado após GC foi 5,70, 34,34 e 47,30 MiB antes da criação, após a criação e após aquecimento/simulação; RSS foi 66,03, 124,76 e 426,00 MiB. Na amostra atual de 128 × 128, esses valores foram 5,74, 56,80 e 74,26 MiB de heap e 65,25, 170,50 e 544,64 MiB de RSS. A medição mantém runtime e projeção no mesmo processo Node, não é uma leitura isolada do Worker do navegador nem uma projeção de memória por reino.

No smoke test integrado a 12×, a thread principal confirmou pausa, avanço manual e inspeção enquanto recebia snapshots. Após resetar a semente, 47 respostas (incluindo o reset) registraram mediana 175,9 ms, p95 201,8 ms e máximo 304,3 ms. A pausa concluiu no máximo um lote de três dias, e o passo manual avançou exatamente um. O Chrome não expôs `performance.memory` nessa sessão; não há uma nova leitura de heap do navegador para comparar com os 27 MiB pontuais do M0.

O mapa atual de 128 × 128 e dois reinos passou a suíte de integração e a medição de 90 dias, mas os replays agrícolas de 730 dias acima pertencem a checkpoints anteriores. A mortalidade nesses replays apontou questões de alimento, migração, caça de animais domesticados e acesso ao portão do curral que foram corrigidas ou cobertas por testes desde então; ainda falta repetir a auditoria econômica em longo prazo neste checkpoint. Não há evidência para declarar suporte a 288 × 288 ou trocar de engine.

## Revalidação do estoque ecológico — 24/10/2026

O modelo atual atualiza estoques de plantas a cada sete dias, com limite por espécie e sem dependência diária da química do solo. Roças consomem sementes finitas para semear; árvores jovens não se repõem sobre estradas ou estruturas. A percepção já distinguia biomassa total de colhível, e `bestPeopleFoodCell` agora escolhe pelo segundo valor. Isso elimina a seleção contínua de raízes que só conservam a reserva protegida de 1,2 unidade.

| Semente / dias | Pessoas vivas | Animais vivos | Mortes humanas | Mortes animais por fome | Roças completas |
| --- | ---: | ---: | --- | --- | ---: |
| 1 / 730 | 50 | 31 | 1 por fome | 0 | 2 |
| 42 / 730 | 50 | 36 | 1 por fome | 0 | 2 |
| 987 / 730 | 50 | 38 | 1 em combate | 0 | 1 |
| 2026 / 730 | 51 | 38 | 0 | 0 | 1 |

As duas mortes por fome foram dependentes sem ação própria de coleta; não houve reserva alimentar na comunidade. Isso permanece como problema de cuidado e abastecimento e não foi mascarado aumentando o estoque ou transferindo reserva, uma abordagem que já piorou outros replays. Os quatro cenários fizeram colheitas vegetais e completaram ao menos uma roça. `npm test` passou com 89/89; `npm run build` compilou 49 módulos. A animação de riscos de chuva saiu do Canvas, mantendo precipitação na simulação e o indicador `CHUVA`.

Medições exploratórias feitas junto a vários outros processos Node ativos deram 8,78 dias/s no motor (amostras 7,52–9,38) e 6,61 dias/s no caminho Worker (5,79–7,55), comparados às medianas históricas de 17,09 e 12,26. A variação e a carga concorrente impedem atribuir a diferença ao código. Esses números não substituem a linha de base; repetir sem carga concorrente antes de afirmar ganho ou regressão.

## Integração de IA e formações — 24/10/2026

`npm test` passou com 137/137 testes em 44,7 s. `npm run build` passou com 59 módulos: bundle principal 420,81 kB (117,56 kB gzip), Worker 236,87 kB, cliente local de IA 0,92 kB e CSS 15,76 kB. O protocolo de mensagens do Worker está na versão 5, que registra a liderança da formação no snapshot. Esses números são do build local, não incluem os pesos Ollama.

`npm run ai:prepare -- --check` encontrou Ollama 0.40.6, Qwen 0.5B Q4_K_M (397.821.319 bytes; digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`) e SmolLM2 135M F16 (270.898.672 bytes; digest `9077fe9d2ae1a4a41a868836b56b8163731a8fe16621397028c2c76f838c6907`). A verificação não baixou modelos. Em cenário local sintético, um pedido do general atravessou o Worker e o Ollama com SmolLM2 em 369 ms; `advance` foi validado e aplicado, incrementando a época do mundo. A prévia de produção também carregou Qwen e exibiu uma decisão estratégica aplicada. A amostra de justificativa do rei inventou contexto de guarnição; o inspetor identifica justificativas não verificadas. Esses fluxos provam conectividade e aplicação em cenários pontuais, não qualidade geral, T1 aprovado ou 30 seeds independentes.

A referência I4 é testada em geometria de linha/coluna, espaçamento, orientação, mudanças de estado/tipo, linha em frente aberta e coluna em passagem estreita, sucessão de liderança após baixa, reorganização dos postos, bloqueios e registro das duas formações em batalha. Coesão entra no cálculo de força e de exposição a baixas. Ainda faltam cenários integrados T2 para obstáculos de rota, alvo fora de alcance e ordem substituída durante a marcha, além dos experimentos de rede e carga T3–T5; nenhum resultado aqui declara adoção dessas camadas.

Foi acrescentado o avaliador pareado `npm run evaluate:people-networks`. O smoke test de uma seed por cinco dias gerou quatro saídas (regras, 4, 6 e 9 neurônios); com n=1, o relatório marca os intervalos de confiança como indisponíveis. É apenas verificação do fluxo, sem valor de seleção. O relatório está em `reports/neural-evaluation/2026-10-24T07-13-19.497Z/`; a comparação de produção exige o mínimo de 30 seeds de calibração e outras 30 finais, em horizonte adequado.

## Revalidação executada — 24/10/2026

Executada na árvore de trabalho local da branch `main`, HEAD `e758fc0`, com alterações não commitadas. Ambiente: Node.js `v24.19.0`, npm `12.2.0`, TypeScript `7.0.2` e Vite `8.3.5`.

* `npm test`: **137/137 testes passaram** em 29,6 s. `npm run build`: passou; 59 módulos. Bundle principal 424,32 kB (118,76 kB gzip), Worker de simulação 236,87 kB, cliente Ollama 0,92 kB e CSS 31,90 kB.
* `npm run baseline`: comparação profunda do mundo inteiro com seed 42 passou por 10 dias. Configuração medida: 128×128, 16.384 células, 2 reinos, 50 moradores, 25 animais e 40 estruturas; 5 dias de aquecimento, 90 dias medidos por 3 repetições. Throughput: 15,20, 15,98 e 16,00 dias/s; mediana **15,98 dias/s**. Heap usado após GC: 8,44 MiB antes da criação, 23,35 MiB após a criação e 28,51 MiB após simulação; RSS correspondente 270,95, 275,88 e 385,27 MiB.
* `npm run worker-baseline`: mesma seed, configuração, aquecimento e horizonte, com lotes de 3 dias e 30 snapshots. Throughput: 12,20, 12,39 e 11,35 dias/s; mediana **12,20 dias/s**. Snapshot inicial: 2.342.912 bytes de colunas de tiles, 392.455 bytes de entidades serializadas e 2.737.340 bytes no total V8. RSS: 66,25 MiB antes da criação, 167,50 após e 535,93 após aquecimento/simulação; heap usado 5,81, 53,03 e 70,04 MiB. Essa medição reúne runtime, projeção, clone/transferência simulados e hidratação no mesmo processo Node; não é memória isolada do Worker do navegador.
* A configuração canônica é `WIDTH = HEIGHT = 128` em `src/config/ecosystem.js`. A integração de migração cria fixtures com `Sim.width`/`Sim.height`; a expectativa anterior de 192×192 foi removida quando a configuração evoluiu. As menções a 96×96 são checkpoints históricos. Não há benchmark atual de 288×288, FPS de navegador ou capacidade máxima certificada.

Essas medições revalidam o estado atual do workspace e não substituem as comparações históricas feitas em outro checkpoint. A amostra de memória do Worker é sensível ao custo de serialização e ao crescimento de logs; não permite projetar memória por reino nem afirmar vazamento. O próximo avanço deve validar economia, conflitos e crônica em replays pareados de 365/730 dias antes de alterar novamente as regras ecológicas.

## Revalidação após correção de incursões — 24/10/2026

O callback de morte nas incursões agora remove a pessoa correta e registra a causa `invasion`. O novo teste de regressão passou. `npm test`: 138/138; `npm run build`: passou, 59 módulos. Replays pós-correção de 365 e 730 dias, incluindo reprodução pareada das quatro seeds no horizonte longo, estão documentados em [vertical-slice-validation.md](vertical-slice-validation.md). As mortes por invasão mudaram substancialmente; os relatórios anteriores ao conserto foram substituídos.

### Revalidação final de throughput — 24/10/2026

Depois das regras de observação/guarnição na fronteira, repeti as medições no runtime Node `v24.19.0`, seed 42, mapa 128 × 128, após aquecimento de 5 dias e por 90 dias × 3 execuções. O estado medido terminou no dia 95 com 50 moradores vivos.

| Caminho | Amostras (dias/s) | Mediana | Observação |
| --- | --- | ---: | --- |
| Motor síncrono (`npm run baseline`) | 17,97 · 19,05 · 18,67 | **18,67** | Heap após GC: 8,30 → 23,21 → 28,79 MiB; RSS: 271,43 → 273,71 → 283,91 MiB. |
| Runtime Worker + clone/transferência simulados + hidratação (`npm run worker-baseline`) | 12,61 · 12,61 · 12,12 | **12,61** | 30 snapshots de 3 dias; runtime/projeção mediano 5.570,57 ms, clone 1.163,48 ms e hidratação 438,95 ms. |

No caminho Worker, o snapshot inicial contém 2.342.912 bytes em colunas de tiles, 392.455 bytes serializados de entidades e 2.737.340 bytes serializados no total. A memória após GC registrou heap usado de 5,81 → 53,02 → 70,77 MiB e RSS de 66,16 → 161,27 → 479,20 MiB. O Worker continua medido junto ao runtime e à hidratação no mesmo processo Node; essas leituras não estimam a memória isolada do Worker no navegador. As amostras são curtas e servem como baseline do estado atual, não como prova de ganho geral.

### Build e testes após revalidação de cuidado — 24/10/2026

`npm test` passou com 141/141 testes em 26,2 s. `npm run build` passou com 59 módulos; bundle principal 425,25 kB (119,03 kB gzip), Worker de simulação 237,80 kB, cliente Ollama 0,92 kB e CSS 31,90 kB. Os replays pareados atuais de 365 e 730 dias estão em [vertical-slice-validation.md](vertical-slice-validation.md); eles não alteram a medição de throughput e memória acima.

### Build após correção do livro-razão militar — 24/10/2026

`npm test` passou com 141/141 testes (47,05 s, com as quatro auditorias longas em paralelo). `npm run build` passou com 60 módulos; bundle principal 425,63 kB (119,19 kB gzip), Worker de simulação 238,17 kB, cliente Ollama 0,92 kB e CSS 31,90 kB. A correção adiciona o registro de compra da ração militar; não altera o fluxo de simulação nem as medições de throughput e memória.

### Build após observador das reservas pessoais — 24/10/2026

`npm test` passou com 142/142 testes em 24,99 s. O observador opcional das reservas pessoais mede os deltas da simulação diagnóstica e fica desativado no jogo normal. `npm run build` passou com 60 módulos; bundle principal 426,33 kB (119,44 kB gzip), Worker 238,86 kB, cliente Ollama 0,92 kB e CSS 31,90 kB. Nenhum benchmark de throughput ou memória foi repetido; esta verificação confirma compilação, não desempenho.

### Verificação final da regra de patrulha — 24/10/2026

Após as mudanças finais em detecção e força letal, `npm test` passou com 140/140 testes em 30,8 s. `npm run build` passou com 59 módulos; bundle principal 424,84 kB (118,91 kB gzip), Worker 237,39 kB, cliente Ollama 0,92 kB e CSS 31,90 kB.

### Build após contabilidade de rações de campanha — 24/10/2026

`npm test` passou com 144/144 testes em 26,1 s. `npm run build` passou com 60 módulos; bundle principal 428,59 kB (120,01 kB gzip), Worker 241,13 kB, cliente Ollama 0,92 kB e CSS 31,90 kB. Os quatro replays pareados de 730 dias reproduziram estado completo e crônica. Nenhum benchmark de throughput ou memória foi repetido; estes números confirmam compilação e regressões, não desempenho.

### Build após manter defensores em marcha — 24/10/2026

`npm test` passou com 145/145 testes em 35,6 s. `npm run build` passou com 60 módulos; bundle principal 428,47 kB (119,98 kB gzip), Worker 241,01 kB, cliente Ollama 0,92 kB e CSS 31,90 kB. As quatro seeds reproduziram estado completo e crônica por 730 dias. Nenhuma medição de throughput ou memória foi repetida.

### Build após resgate de dependentes órfãos — 24/10/2026

`npm test` passou com 146/146 testes em 27,2 s. `npm run build` passou com 60 módulos; bundle principal 428,62 kB (120,01 kB gzip), Worker 241,15 kB, cliente Ollama 0,92 kB e CSS 31,90 kB. Os quatro replays pareados de 730 dias reproduziram estado e crônica. Nenhum benchmark de throughput ou memória foi repetido.

### Revalidação técnica do workspace atual — 24/10/2026

Executada após a mudança recente de alternância dos painéis; medições de simulação em processos sequenciais. Ambiente: Node.js `v24.19.0`, npm `12.2.0`, TypeScript `7.0.2` e Vite `8.3.5`.

* `npm test`: **154/154 passaram**, 0 falhas, em 37,3 s. `npm run build`: passou com `tsc --noEmit` e 61 módulos; HTML 12,08 kB, bundle principal 433,55 kB (121,45 kB gzip), Worker de simulação 245,64 kB e CSS 32,07 kB.
* `npm run baseline`: seed 42, mapa 128×128 (16.384 células), 2 reinos, 51 moradores, 25 animais e 40 estruturas; 5 dias de aquecimento, 90 dias por repetição e 3 repetições. A comparação profunda do estado completo passou nos primeiros 10 dias. Amostras: 14,74, 15,90 e 15,72 dias/s; mediana **15,72 dias/s**. Heap usado após GC: 8,53 MiB antes da criação, 23,43 MiB após a criação e 28,39 MiB após aquecimento/simulação. RSS correspondente: 271,12, 273,54 e 383,65 MiB.
* `npm run worker-baseline`: mesma seed/configuração/horizonte, lote de 3 dias, 30 snapshots; amostras 11,63, 11,56 e 11,16 dias/s; mediana **11,56 dias/s**. O snapshot inicial tem 2.342.912 bytes em colunas de tiles, 392.455 bytes serializados de entidades e 2.737.340 bytes serializados no total. Heap usado após GC: 5,84 → 53,06 → 70,20 MiB; RSS: 67,20 → 167,50 → 530,39 MiB. Este medidor executa runtime, projeção, clone/transferência simulados e hidratação no mesmo processo Node; exclui Canvas, escalonamento entre threads e a memória isolada do Worker do navegador.

O novo par de medições é uma amostra curta deste checkpoint, não prova regressão frente a benchmarks anteriores nem certifica escala máxima. A divergência histórica de dimensões está resolvida na configuração e nas fixtures: ambas usam `WIDTH = HEIGHT = 128`; não existe benchmark validado de 288×288. A autonomia anual e a repetição pareada das quatro sementes continuam documentadas separadamente em [vertical-slice-validation.md](./vertical-slice-validation.md); M3 ainda não demonstra produção cultivada nem estoques estáveis em horizonte longo.

## Revalidação 200/43 — checkpoint anterior à vida de estruturas — 24/10/2026

A geração atual começa com 200 habitantes (100 por reino) e 43 soldados por reino: 20 de infantaria, 10 lanceiros, 8 arqueiros e 5 clérigos. O checkpoint de 51 moradores e 15,72 dias/s é de outra escala e não permite atribuir diferenças apenas à população.

No seed 42, mapa 128×128, a comparação de estado completo nos primeiros 10 dias passou. Com cinco dias de aquecimento e 3×90 dias medidos, o motor síncrono alcançou 4,58 / 3,42 / 3,84 dias/s (mediana **3,84**). A memória heap após GC foi 8,77 MiB antes da criação, 24,66 MiB após criar o mundo e 41,47 MiB depois do aquecimento/simulação; o RSS foi 415,37 / 422,82 / 442,54 MiB.

No caminho Worker simulado, a mediana foi **3,48 dias/s** (3,30 / 3,51 / 3,48). O snapshot serializado mediu aproximadamente 3,58 MB, com 2,34 MB em colunas de terreno; o tempo mediano por 90 dias foi 19.524 ms no runtime/projeção, 6.223 ms na clonagem/transferência e 559 ms na hidratação. O processo Node terminou em 717,65 MiB RSS e 113,51 MiB de heap após a simulação. Esses valores abrangem runtime, projeção, clonagem e hidratação do benchmark; não medem memória isolada do Worker, renderização nem FPS do navegador.

As medições caracterizam a nova carga, mas não isolam o custo da população, das guarnições ou de outras diferenças de código. O mapa continua 128×128 e o limite 288×288 segue sem validação. Relatórios brutos: [motor síncrono](../reports/baseline-pop200.json) e [caminho Worker](../reports/worker-baseline-pop200.json).

**Limite do par anterior:** os relatórios `baseline-pop200.json` e `worker-baseline-pop200.json` antecedem a revisão de vida de estruturas, cerco e saque. Os números atuais após a revisão estão registrados abaixo, em arquivos separados para preservar o checkpoint anterior.

## Baseline pré-captura e pré-construção — checkpoint anterior de 24/10/2026

Seed 42, mapa 128×128, 202 entidades residentes, 26 animais e 44 estruturas. O motor síncrono repetiu o estado integral nos primeiros 10 dias; após cinco dias de aquecimento e três amostras de 90 dias, marcou 6,43 / 4,55 / 3,03 dias/s (mediana **4,55**). Heap usado após GC: 9,02 MiB antes da criação, 24,97 MiB após criar o mundo e 42,29 MiB após aquecimento/simulação; RSS: 417,13 / 419,15 / 451,90 MiB.

O caminho Worker simulado mediu **3,64 dias/s** de mediana (3,64 / 3,59 / 4,92), com 30 lotes de três dias. O snapshot serializado foi de 3.580.324 bytes, dos quais 2.342.912 bytes correspondem às colunas de terreno. Tempos medianos por 90 dias: 17.693,90 ms no runtime/projeção, 6.074,02 ms na clonagem/transferência e 616,06 ms na hidratação. O processo terminou com 689,99 MiB RSS e 116,35 MiB de heap após a simulação.

Os dois scripts rodam no mesmo processo Node e incluem custos de simulação/snapshot; o caminho Worker simula clone/transferência e hidratação, mas não mede a memória de um Worker isolado, Canvas nem FPS. Os valores variam entre repetições e não sustentam uma alegação de ganho frente ao checkpoint anterior. Relatórios brutos: [síncrono](../reports/baseline-pop200-siege.json) e [Worker](../reports/worker-baseline-pop200-siege.json). O replay de guerra e economia está em [replay atual de 730 dias](../reports/replay-structure-siege-730-20261024.json).

## Baseline após captura e construção — 24/10/2026

Seed 42, mapa 128×128, 202 residentes e 43 estruturas. O baseline síncrono comparou estado completo nos primeiros 10 dias; após cinco dias de aquecimento e três amostras de 90 dias, marcou 5,95 / 6,31 / 6,10 dias/s (mediana **6,10**). O caminho Worker simulado marcou 4,42 / 4,50 / 4,52 dias/s (mediana **4,50**) com 30 lotes de três dias. Payload serializado de 3.580.324 bytes; colunas de terreno, 2.342.912 bytes. Tempos medianos por 90 dias: 14.875,65 ms em runtime/projeção, 4.692,94 ms em clonagem/transferência e 451,97 ms em hidratação.

São três repetições Node sob a mesma seed/configuração; não incluem renderização/FPS nem isolam memória de um Worker real. A variação entre execuções impede atribuir o diferencial ao código. Relatórios: [síncrono](../reports/baseline-capture-current-20261024.json) e [Worker](../reports/worker-baseline-capture-current-20261024.json). O replay pareado da seed 42 está em [replay atual de 730 dias](../reports/replay-current-siege-capture-seed42-730-20261024.json).

## Revalidação técnica do workspace — 24/10/2026, após serviço militar em paz

Executada na branch `main`, HEAD `e758fc0`, com alterações locais ainda não commitadas. Ambiente: Node.js `v24.19.0`, npm `12.2.0`, TypeScript `7.0.2`, Vite `8.3.5`, Windows x64. O build e os testes abaixo descrevem esse workspace, não o HEAD remoto.

* `npm test`: **218/218 passaram**, zero falhas, em 81,9 s. `npm run build`: passou com `tsc --noEmit` e 72 módulos; HTML 12,08 kB, bundle principal 492,44 kB (140,16 kB gzip), Worker 291,97 kB, cliente Ollama 0,92 kB e CSS 32,08 kB.
* A configuração canônica continua em **128×128 (16.384 células)**. O teste de migração deriva dimensões de `Sim.width`/`Sim.height`; a fixture 192×192 remanescente pertence à geometria de câmera, não a uma expectativa de tamanho do mundo. Portanto a antiga divergência 96×96/192×192 não está ativa no código atual.
* `npm run baseline`, seed 42, comparação profunda do estado completo desde a criação e por 10 dias: passou. Configuração: 2 reinos, `world.people.length` 202, 26 animais, 43 estruturas; 5 dias de aquecimento e 3×90 dias medidos. Throughput: 6,52 / 6,77 / 7,03 dias/s; mediana **6,77 dias/s**. Heap usado após GC: 9,23 → 25,12 → 41,23 MiB; RSS: 415,11 → 422,33 → 436,74 MiB.
* `npm run worker-baseline`, mesma seed/configuração/horizonte, lotes de 3 dias: 4,59 / 4,56 / 3,99 dias/s; mediana **4,56 dias/s**. Em 90 dias, tempos medianos: runtime/projeção 14.874,73 ms, clone/transferência simulados 4.514,26 ms, hidratação 468,82 ms. Snapshot inicial V8: 3.580.324 bytes, incluindo 2.342.912 bytes em colunas de tiles e 1.235.361 bytes de base de entidades. Heap após GC: 6,04 → 55,78 → 112,03 MiB; RSS: 65,98 → 173,59 → 727,74 MiB.
* O caminho Worker do script combina runtime, projeção, clone/transferência e hidratação no mesmo processo Node. Ele não mede memória isolada do Worker real, escalonamento entre threads, Canvas, FPS ou responsividade do navegador. As populações/configurações anteriores de 50 moradores não são comparáveis diretamente aos 202 objetos em `world.people` deste cenário.
* `npm run profile-simulation` (seed 42 e 2026; 5 dias de aquecimento; 3×90 dias instrumentados) atribuiu 82,93–83,52% do tempo à fase `people`; cada recálculo territorial ficou em 1,35–1,63%. Mediana por dia: 120,76–134,50 ms; p95 combinado por seed: 256,31–289,94 ms; cobertura das fases: 99,79–99,81%. O perfil é instrumentado e não deve ser comparado diretamente ao throughput sem profiler.

Os resultados confirmam a stack atual, mas não certificam escala superior. Próximo passo: reduzir ou explicar o custo dominante em `people` e repetir as medições sem alterar causalidade, percepção ou determinismo. Replays econômicos multissemente deste checkpoint seguem pendentes. Relatórios brutos: [testes](../reports/current-baseline-tests-2026-10-24.txt), [build](../reports/current-baseline-build-2026-10-24.txt), [motor](../reports/current-baseline-engine-2026-10-24.json), [Worker](../reports/current-baseline-worker-2026-10-24.json), [perfil](../reports/current-baseline-profile-2026-10-24.json).

## Replay econômico atualizado após serviço militar em paz — 24/10/2026

As quatro seeds (1, 42, 987, 2026) completaram 730 dias; a verificação integral de estado e crônica da seed 42 passou. Mortes: 18 em combate, uma por ferimento, zero por fome ou desidratação. Reserva adulta final média: 9,09–14,99 pontos; exposição abaixo de 20 em 49,17–55,16% dos dias-adulto e reserva zerada em 36,03–42,86%. As roças foram concluídas em todas as seeds, mas estoque comunitário de comida e tesouro de comida/ouro terminaram zerados.

O salário atual é **15 ouro/30 dias = 0,5 ouro/dia por soldado**; para 43 soldados, são 645 ouro por reino a cada 30 dias. Uma taxa de 1 ouro/dia resultaria em 30 por mês por soldado e dobraria a folha atual. A regra salarial não mudou enquanto se esclarece qual valor por período atende à redução pretendida. Resultado econômico completo em [replay atual de 730 dias](../reports/current-replay-military-peace-730-20261024.json); detalhe e limites em [validação do vertical slice](./vertical-slice-validation.md).

## Investigação de desempenho e redução da população — 25/10/2026

O perfil curto do código anterior à redução (seeds 42 e 2026, 30 dias, uma execução por seed) atribuiu **90,47% e 96,79%** do tempo da simulação à fase `people`. O navegador aberto avançava o mundo ao mesmo tempo, então os tempos totais — 14,97 s e 50,13 s por 30 dias — sofreram concorrência de CPU e não servem como baseline controlado. Em uma observação de 1,25 s da página, o canvas manteve 144 FPS sem quadros acima de 25 ms; uma resposta recente do Worker, porém, levou 13,9 s. Isso aponta atraso no avanço da simulação, não lentidão do desenho do mapa. A janela de FPS foi curta.

A investigação localizou um custo que cresce com o número de pessoas: a percepção de cada pessoa percorre a lista completa de pessoas vivas e valida entidades lembradas com novas buscas nessa lista. Como esse trabalho se repete para cada indivíduo, reduzir 200 pessoas para 100 deve aliviar especialmente as comparações entre pessoas. O valor do ganho precisa ser medido novamente em execução isolada.

O mapa permanece em **128×128 (16.384 células)**: a renderização do terreno é armazenada em cache, e as fases de mapa/território medidas ficaram abaixo de 1% cada no perfil curto. Reduzi-lo para 64×64 cortaria espaço de jogo sem atingir o gargalo observado. A nova configuração começa com **50 habitantes por reino**, incluindo **21 soldados** (10 infantes, 5 lanceiros, 4 arqueiros e 2 clérigos); as metas de reposição acompanham esses números. As medições acima são anteriores à alteração e não demonstram ainda o ganho pós-redução.
