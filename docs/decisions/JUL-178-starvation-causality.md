# JUL-178 — fome como consequência e diagnóstico causal

**Data:** 26/10/2026  
**Implementação analisada:** `adbad1a2138da80e84dddbb4f35b9c2752502f7f`  
**Resultado:** distinguir mortalidade por oferta finita de falha de acesso; não exigir sobrevivência universal.

## Decisão de gameplay

Morrer de fome é uma consequência possível e válida quando reservas e alimento realmente acessível não cobrem a demanda. O simulador não deve garantir que todos vivam em qualquer duração, seed, guerra ou política. Isso também não transforma toda morte em “natural”: cada morte de fome em uma validação deve ser classificada por reserva pessoal, estoque coletivo, alimento acessível, caminho, energia, cuidado e decisões anteriores.

O zero de mortes exigido por JUL-162 é local ao cenário aprovado de seed 42 por 253 dias; não é um contrato global para todos os replays. A regressão de conservação em `tests/economy-conservation.test.mjs` também protege o caso oposto: sem transferência efetiva de comida, a necessidade não atendida deve resultar em morte real por fome, em vez de alimento inventado.

## O que a evidência permite concluir

No replay de 730 dias da seed 987, Ema E morreu no dia 666 por `starvation`: reserva 0, saúde 0, hidratação 33,92 e sem ferimento. Na véspera, a decisão registrada era `forage`, sem scores neurais (`lastDecision.scores: null`). O fluxo de `actions.js` força uma ação de sobrevivência quando a reserva cai abaixo do limite crítico; nessa situação a rede neural não escolheu a ação final.

O caso não está provado como fome inevitável por falta absoluta de recurso. A comunidade tinha estoque 0 e os adultos próximos estavam com reservas entre 2,87 e 5,74. Ao mesmo tempo, o snapshot da morte encontrou biomassa de berry perto da posição da pessoa e o histórico final registra trocas de alvo durante o deslocamento. Esse snapshot não demonstra que a pessoa percebia a mesma oferta, que a rota terminaria antes da queda de saúde ou que a biomassa seria colhível naquele tick. Portanto, a evidência indica crise coletiva real e deixa uma possível falha anterior de acesso/planejamento em aberto.

## Como o agente participa

Em condição ordinária, `choosePeopleAction` compara utilidades, logits da rede, valores aprendidos e plano estratégico. A fome crítica altera esse fluxo: sobrevivência pode suspender a política normal. A seleção do alimento e a rota são funções determinísticas (`bestPeopleFoodCell`, `foodApproachTiles`, `moveTowardFood`); colheita, custo de deslocamento e energia também são resolvidos no motor. Logo, a rede pode contribuir para decisões anteriores à crise, mas o log `forage` no fim não é evidência de que a rede “decidiu morrer”.

## Critério de análise

| Situação observada | Interpretação |
| --- | --- |
| Estoques e manchas utilizáveis esgotados, rota sem opção, ausência de alimento compartilhado e necessidade contínua | Mortalidade plausível sob recursos finitos; registrar a cadeia de oferta e consumo. |
| Biomassa colhível conhecida e alcançável, mas alvo troca repetidamente, viagem excede a reserva ou a ação falha sem nova percepção | Possível falha de decisão, caminho ou contrato de sobrevivência; reproduzir antes de ajustar a rede. |
| A pessoa age corretamente, mas a política social/militar deixa indivíduos sem acesso apesar de excedente alocável | Falha de coordenação/distribuição, não inevitabilidade ecológica. |

Manter metas e resultados separados por cenário. Não reduzir taxas de mortalidade mudando números globais sem identificar qual cadeia falhou. A versão exploratória de persistência de alvo por dois dias foi rejeitada porque não mudou o dia da morte, a crônica ou a série observada de trocas de alvo na seed 987.

## Evidência e limites

Relatórios: `docs/verification/JUL-178-food-routecooldown-730-multiseed-20261026.json` e `docs/verification/JUL-178-food-routecooldown-730-deaths-seed987-20261026.json`. O trace amostra uma seed e não é prova de uma taxa populacional. Literatura de forrageamento registrada na decisão geral de JUL-178 informa o enquadramento de buffers e custo de busca, mas não calibra este cenário nem determina se a morte específica era necessária.

Uma busca SciSpace em 27/10/2026 encontrou referências metodológicas sobre validação de modelos multiagentes e avaliação explícita das decisões dos agentes: Fagiolo, Moneta e Windrum, [Confronting Agent-Based Models with Data](https://doi.org/10.1007/3-540-37249-0_18); Anand et al., [Validation of an agent based model using a participatory simulation gaming approach](https://doi.org/10.1016/J.TRC.2016.08.002); e Wijermans et al., [Agent decision-making: The Elephant in the Room](https://doi.org/10.1016/j.envsoft.2023.105850). Esses trabalhos apoiam separar traços de decisão de resultados agregados e justificar se o modelo de decisão serve ao contexto; não determinam a taxa aceitável de mortalidade do Kingdom nem provam a causa da morte da Ema. A regra adotada, portanto, é permitir mortalidade sob escassez finita e auditar cada cadeia causal por reservas, oferta acessível, caminho, energia, cuidado e decisões precedentes. Sobrevivência universal não é meta; ausência de diagnóstico tampouco torna uma morte correta.

Consensus foi tentado novamente em 27/10, mas a cota continua esgotada até 01/11/2026. O conector Game Studio MCP permanece indisponível nesta sessão. Essas limitações não impedem a avaliação causal por testes e replays determinísticos.

## Replay alimentar atual — 365 dias, quatro seeds e repetição pareada — 27/10/2026

No código `7c67efe794cb5aae1b7be5d132f737b77fe806a0`, as seeds 1, 42, 987 e 2026 terminaram 365 dias e a seed 42 foi repetida. Estado completo e crônica coincidiram na repetição. **Nenhuma pessoa morreu por fome** no horizonte: as mortes humanas foram combate/invasão (2, 2, 1 e 2, respectivamente). O campo amplo `deathsByCause.starvation` agrega fauna e pessoas: os registros correspondem a 4/5/3/20 mortes de animais selvagens, sem morte humana por fome e sem morte de animal doméstico.

| Seed | Pessoas no fim | Morte humana por fome | Outras mortes humanas | Adulto-dias com reserva <20 | Mortes de animais selvagens por fome |
| ---: | ---: | ---: | --- | ---: | ---: |
| 1 | 101 | 0 | 0 | 7.385 | 4 |
| 42 | 98 | 0 | 1 combate, 1 invasão | 11.771 | 5 |
| 987 | 99 | 0 | 1 invasão | 12.014 | 3 |
| 2026 | 98 | 0 | 2 invasões | 9.895 | 20 |

Os replays registraram 22 campanhas-lado, 236 batalhas e 282 transações de mercado no conjunto; todos os lados de campanha têm ledger completo, sem saldo alimentar desbalanceado. Três seeds terminaram com estoque comunitário, tesouro e mercado em zero, enquanto reservas pessoais continuaram positivas. Isso demonstra uma economia sob pressão e mortalidade animal por falta de oferta, mas não permite inferir morte humana por fome neste horizonte. A exposição a reserva baixa continua relevante para avaliar robustez, embora não seja prova de decisão neural ruim nem, isoladamente, defeito.

Relatório reproduzível: `docs/verification/JUL-178-food-audit-365-multiseed-7c67efe-20261027.json`; comando: `npm run audit:food -- --days 365 --seeds 1,42,987,2026 --repeat-seed 42 --output <arquivo>`. A matriz de 365 dias não substitui o trace de 730 dias de Ema nem prova que toda morte longa seja inevitável; as diferenças entre horizontes e atores devem permanecer explícitas nos relatórios.

## Revisão da prioridade entre comida e água — 27/10/2026

Ao revisar o caso de sede crítica, uma regressão reproduziu um erro de política determinística: com reserva de 0,5 e hidratação 8, o motor selecionava `forage` porque havia uma roça a dois tiles, mesmo com uma barreira contínua de água sem rota. A comida tinha uma borda de interação válida do outro lado; distância em linha reta não provava que Ema pudesse alcançá-la. O agente não estava preso por uma decisão neural: a urgência de alimento sobrescrevia a sede antes da execução, e então a tentativa de rota falhava.

Alterei a regra para que fome crítica só substitua sede crítica por `forage` se `canHarvestFoodAt` confirmar que a comida pode ser colhida no local neste tick, e quando não houver água já ao alcance de ingestão. Assim, a rotina preserva a refeição realmente imediata, mas não chama uma mancha separada por caminho incerto de oportunidade de emergência. “Comida está perto” e “comida é acessível agora” são condições diferentes.

SciSpace retornou Dall e Johnstone (2002), [Managing uncertainty: information and insurance under the risk of starvation](https://doi.org/10.1098/RSTB.2002.1061), e Guo e Hermundstad (2026), [Efficient planning and implementation of optimal foraging strategies under energetic constraints](https://doi.org/10.1093/pnasnexus/pgag009). Ambos apoiam cautela com busca incerta quando reservas são baixas; nenhum estabelece o limiar de hidratação/fome do Kingdom. Consensus continua sem cota mensal e o conector Game Studio permanece indisponível; a decisão foi baseada no contrato local, na reprodução determinística e no teste de regressão.

Validação no SHA `7c67efe794cb5aae1b7be5d132f737b77fe806a0`: `tests/food-survival.test.mjs`, `tests/food-navigation.test.mjs` e `tests/economy-conservation.test.mjs` passaram 18/18; `npm run typecheck`, `npm run build` (107 módulos; 489 PNGs convertidos em WebP lossless) e `git diff --check` passaram. O teste novo falhava antes do fix (`forage` em vez de `drink`) e passou depois, confirmando também o deslocamento para a água. CI run #61 e o replay anual multissemente ainda estão em execução neste SHA. A tentativa anual anterior foi interrompida após a primeira seed porque usava o código sem esta correção; não produziu relatório e não é contabilizada como evidência.
