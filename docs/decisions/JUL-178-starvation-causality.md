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

Relatórios: `docs/verification/JUL-178-food-routecooldown-730-multiseed-20261026.json` e `docs/verification/JUL-178-food-routecooldown-730-deaths-seed987-20261026.json`. O trace amostra uma seed e não é prova de uma taxa populacional. Literatura de forrageamento registrada na decisão geral de JUL-178 informa o enquadramento de buffers e custo de busca, mas não calibra este cenário nem determina se a morte específica era necessária. A matriz anual de quatro seeds está em execução e deve completar esta análise.
