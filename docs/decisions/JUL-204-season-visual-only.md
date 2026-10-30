# JUL-204 — estações somente visuais

Data: 27/10/2026
Estado: implementação em validação
Issue: JUL-204; relacionada à avaliação JUL-165 e à exceção estreita de ovelhas em JUL-199.

## Decisão

Manter o calendário de 365 dias para a interface e para a troca gradual das paletas de terreno. O calendário não deve controlar temperatura, chuva, crescimento de plantas, decisões do rei ou decisões do general. Variação local de clima, água e recursos finitos continua ativa; a regeneração por pressão e capacidade continua ativa. Não adicionar biomas nem mecânicas ecológicas sazonais. A taxa menor de respawn selvagem no inverno segue isolada em JUL-199.

O prompt da IA não recebe campos que revelem estação ou data absoluta. Metadados de relatório/expiração continuam fora das observações e preservam validação de pedidos. Durações relativas úteis para o agente, como `shortageDays` e `stalledDays`, continuam disponíveis.

## Parâmetros e justificativa

| Sistema | Regra anterior | Regra escolhida | Racional |
| --- | --- | --- | --- |
| Temperatura regional média | 19, 25, 21 e 15 °C por estação | Média anual ponderada, 20 °C arredondados (20,003 °C) | Remove o calendário como causa de temperatura mantendo altitude, latitude e variação diária aleatória. |
| Chuva regional | Fatores 1,14; 0,72; 0,84; 1,26 escalavam probabilidade e volume | Fator constante 1,0109 | Preserva aproximadamente a chuva esperada anual, não o momento dos eventos. |
| Raízes cultivadas | Crescimento-base 6 com fatores 1,20; 1,15; 0,88; 0,52 | Crescimento-base 5,625 | Média dos quatro fatores é 0,9375; `6 × 0,9375 = 5,625`. O tick continua a cada sete dias e respeita capacidade e uso. |
| Brotos para ovelhas | Crescimento-base 0,15 com fatores 1,08; 0,22; 0,72; 1,22 | Crescimento-base 0,1215 | Média dos fatores é 0,81; `0,15 × 0,81 = 0,1215`. |

Para chuva, o evento antigo tinha probabilidade `0,19 × f` e magnitude `2 + U(0,17 × f)`. Sua expectativa diária em cada estação era proporcional a `0,19 × f × (2 + 8,5 × f)`. A média ponderada pelos dias `91/91/92/91` equivale ao fator constante aproximado `1,01089296`. Isso preserva expectativa anual matemática, não sazonalidade, ordem de tempestades ou sobrevivência. O teste usa estados iniciais e RNG iguais; o replay ainda precisa medir consequências na população.

## IA estratégica e militar

O relatório de reino ainda mantém `day` e `calendar` para a interface e inspeção, mas estes campos são removidos do objeto copiado para a inferência. Removi também a estação da evidência interna que decide quando uma estratégia precisa ser reavaliada. O general recebe observações sem `day`, `startedDay`, `lastBattleDay`, `incidentDay` ou datas equivalentes nos relatos. Nenhum peso, entrada neural, recompensa ou regra de combate mudou.

O sanitizador é recursivo e preserva durações que usam a forma plural, incluindo `shortageDays`, `stalledDays` e `ageDays`. `reportDay` e `expiresDay` continuam nos metadados internos do contrato para rejeitar respostas atrasadas; não são enviados ao modelo como observações.

## Alternativas

* **Manter temperatura, chuva e regeneração sazonais:** rejeitada porque conflita com a diretriz de JUL-195 e torna escassez dependente de uma mecânica fora do escopo.
* **Remover clima, hidrologia e regeneração:** rejeitada porque água e biomassa finitas sustentam coleta, cultivo e sobrevivência.
* **Tornar a ecologia constante e preservar variação espacial, chuva diária, recursos finitos e paletas sazonais:** escolhida. Reduz o sistema ao mínimo que ainda é consumido pelo gameplay.
* **Remover apenas o nome “estação” dos prompts, mantendo datas:** rejeitada porque o modelo ainda poderia derivar a estação de dia/ano e datas de incidentes.

## Pesquisa e limites

Game Studio: usei a skill local para preservar a separação entre simulação e apresentação e verificar gameplay pelo comportamento observável. O runtime atual é JavaScript próprio; não migrei de engine nem alterei UI/assets. Não há ferramenta conectada do Game Studio nesta sessão.

SciSpace: Guerrin, [“Agent-Based Modelling of a Simple Synthetic Rangeland Ecosystem”](https://doi.org/10.1007/978-3-030-37421-1_10) (2020), descreve herbívoros que consomem vegetação em parcelas e avalia biomassa, população e mortalidade ao longo de anos. A referência apoia medir estoques e fluxos relevantes ao gameplay, mas não prova que esta ecologia simplificada seja biologicamente suficiente nem calibra seus valores.

Consensus: cota de busca indisponível até 01/11/2026. A ferramenta de notas do Linear falha com `Tool get_agent_context not found`; continuei com JUL-165/JUL-204, código e validação local. Literatura informa a escolha, não substitui replay do Kingdom.

## Validação

* Direcionados `node --test tests/ecology-seasonality.test.mjs tests/ai-calendar-observations.test.mjs`: 5/5.
* `npm test`: 185/185.
* `npm run typecheck`: passou.
* `npm run build`: passou; 108 módulos transformados e 489 PNGs convertidos em WebP sem perdas (8,03 MiB → 5,27 MiB).
* `git diff --check`: passou.
* Replays no SHA `c2eef7a0bd695cc3d8871a6afbc6635855a0fd6a`: seed 42 por 253 dias e seeds 1, 42, 987 e 2026 por 365 dias; a seed 42 repetida foi determinística em ambos.
* Resultados anuais:

  | Seed | Pessoas vivas ao fim | Nascimentos | Mortes totais | Mortes humanas (causa) | Ovelhas selvagens mortas de fome | Colheita de plantas / roça | Biomassa alimentar final | Pessoa-dias adultas com reserva <20 |
  | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
  | 1 | 100 | 12 | 18 | 0 | 18 | 13347,59 / 6660,06 | 135539,49 | 9789 |
  | 42 | 96 | 14 | 7 | 4 (3 invasão, 1 combate) | 3 | 10473,99 / 0 | 128592,08 | 12576 |
  | 987 | 99 | 13 | 13 | 2 (1 invasão, 1 combate) | 11 | 14575,95 / 8811,65 | 136134,32 | 8934 |
  | 2026 | 100 | 10 | 19 | 1 invasão | 18 | 12460,81 / 3711,63 | 122414,89 | 10295 |

  Não houve morte humana por fome ou sede nesses quatro replays; as mortes agregadas por fome foram de ovelhas selvagens. Isso demonstra que a ecologia permite mortalidade animal, mas não prova que a população humana morrerá de fome em condições mais severas. A quantidade de pessoa-dias com reserva baixa mostra pressão alimentar persistente e permanece um problema de JUL-178/JUL-201. O relatório `docs/verification/JUL-204-food-365-multiseed-20261027.json` contém estoques, campanhas, reservas e os demais campos por seed.
* Estoques finais anuais: o mercado, tesouro e estoque comunitário estavam zerados nas seeds 1, 42 e 2026; a seed 987 terminou com 9,49 no comunitário e zero no mercado/tesouro. Reservas pessoais finais: 2530,79; 1522; 2527,25; 2028,30, respectivamente. Os relatórios também confirmam que os ledgers logísticos de campanha fecharam sem divergências. A seed 42/253 colheu 3710,83 de alimento silvestre e nenhuma raiz cultivada; terminou com 1890,37 de reserva pessoal e zero no mercado, tesouro e comunidade. Isso sustenta que a preocupação de acesso/fluxo da roça segue aberta em JUL-178/JUL-201, sem atribuir a falha à remoção da sazonalidade.
* Hashes anuais (estado / crônica):

  | Seed | SHA-256 do estado | SHA-256 da crônica |
  | ---: | --- | --- |
  | 1 | `47d9bbaccac53f05ed16d0d1c4794fdea90b2720e3ab0a96a888cdf928788e5e` | `339e9255875a3dfeb1cd704305b98df6bee1c07e2a257859e0e03524c580a17b` |
  | 42 | `bc6c30241495ade900999eb9e27d9a7c0cf18e30cccb485384c6a884d3a1793a` | `972d8b364b3ae14f60bd87479d2f54534550bf10273f67d00a87e43fd387d9e5` |
  | 987 | `a4e94ad8ecaedcf251540120c4d139d123399ce2c1a6ce792d8e80261fc81030` | `2ddc88099f49744108ce3b85eac3e5ac987cdb70d1631ced12341ebb3b1daf35` |
  | 2026 | `75ce926bd73d30fe340903b33467c22c289e502fc99115d4d8c5b572b8f08290` | `b55eae3c6c1cf9a19119f03e59d27a861a1db3ce153f4370f7d40b0a4cc4d981` |

* Replay de 253 dias, seed 42: estado `17d93c589c1de6a958782654e05b5b0e0dc020cedbc44bd0462c71576572911c`; crônica `2d20c4b5a4c1b668a97009f54a77d92a5100bd6d12ad21de8e8b39cac9db4813`; repetição determinística; 99 pessoas vivas, 10 nascimentos, 4 mortes (3 ovelhas selvagens por fome e 1 pessoa em combate), biomassa alimentar 122149,31 e 4215 pessoa-dias adultas com reserva <20. Evidência completa em `docs/verification/JUL-204-food-253-seed42-repeat-20261027.json`.
* A interface e as paletas sazonais não foram alteradas, então não foi necessária captura de playtest visual nesta fatia. `tests/render-optimization.test.mjs` continua cobrindo invalidação de tiles por mudança de estação.
