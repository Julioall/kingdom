# JUL-178 — acesso ao alimento e replanejamento local

Data: 26/10/2026  
SHA validado: `0b4d633fe7930bd1011ca00a2acbd22f9f230414`

## Pergunta

Como impedir que um agente repita um alvo de alimento sem rota alcançável sem alterar a oferta, a demanda ou a finitude dos recursos?

## Evidência usada

- A issue JUL-178 exige validar deslocamento, troca de alvo e conservação com replays repetíveis; seus critérios de rebanho, cultivo e logística militar continuam separados e abertos.
- O trace da seed 42 antes da correção mostrava o soldado Ayo J parado em `(76,81)`, com alvo de fruto em `(77,82)`. O tile de fruto também era âncora de árvore e bloqueava movimento; o agente repetia `forage` sem alcançar a máscara de colheita.
- A matriz de 730 dias em `docs/verification/JUL-178-food-replays-final-20261026.json` reduziu mortes por fome de `60/62/70/83` no baseline para `26/26/3/14` no SHA deste documento. A repetição da seed 42 reproduziu estado e crônica integralmente. A escassez, medida por adultos-dia com reserva inferior a 20, continua alta.
- Game Studio orienta preservar o Worker determinístico e separar regra de simulação de renderização; a mudança permanece em `individuals/actions.js`, sem alterar o Canvas. SciSpace sustenta indiretamente a separação entre seleção em camadas e execução local ([LGOAP](https://doi.org/10.1109/CIG.2013.6633624)); esse trabalho não prova que o algoritmo de rotas do Kingdom melhora sobrevivência. Consensus continua indisponível até o reset mensal de 01/11/2026, já registrado em `docs/decisions/JUL-195-architecture-and-evidence.md`.

## Alternativas consideradas

1. **Mover ao centro do arbusto:** rejeitada porque o tile pode ter uma árvore ou depósito que bloqueia a colisão do agente.
2. **Excluir o alvo por sete dias após uma falha:** testada em `20e5ec1` e rejeitada. O replay marcou `31/47/47/61` mortes por fome, total 186, pior que a abordagem sem cooldown (`64/33/27/21`). O prazo longo descartava uma oportunidade por muitos dias.
3. **Criar alimento ou reduzir a demanda para compensar a rota:** rejeitada porque esconderia o erro de navegação e quebraria a contabilidade auditável.
4. **Escolher um tile cardinal que toca a máscara de colheita, preservar navegação direta para roça e tentar outro alvo imediatamente se o caminho falhar:** escolhida. O conjunto de alvos falhos fica limitado ao replanejamento atual, sem cooldown entre dias.

## Validação e limite

`tests/food-navigation.test.mjs` cobre tronco bloqueando o alvo, aproximação por tile cardinal livre, seleção de alvo alternativo e retorno a um talhão. No SHA validado, `npm test` passou 63/63 e `npm run build` passou, incluindo TypeScript. Os replays 730d foram determinísticos e não encontraram estoques negativos; a fome caiu de 275 para 69 mortes no total de quatro seeds.

A decisão melhora o acesso e a sobrevivência medida, mas não fecha JUL-178. Ainda faltam cenários controlados de choque, reservas civis durante guerra, reconciliação de origem/destino, métrica de distância/entrega e uma decisão validada sobre entrada e saída alimentar do rebanho.
