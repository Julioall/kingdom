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
* Replays seed 42/253 e quatro seeds/365 ainda pendentes nesta nota; atualizar com SHA, hashes, mortes por ator/causa, reservas, colheita e comida disponível antes de encerrar JUL-204.
* A interface e as paletas sazonais não foram alteradas, então não foi necessária captura de playtest visual nesta fatia. `tests/render-optimization.test.mjs` continua cobrindo invalidação de tiles por mudança de estação.
