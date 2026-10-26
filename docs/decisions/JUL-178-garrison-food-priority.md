# JUL-178 — prioridade de alimento para soldados em recuperação

Data: 26/10/2026  
Branch: `codex/jul195-integration`

## Evidência e causa

No replay repetido de seed 42, dia 730, no SHA `8d6071a5339e7a1c915ecf94c096af1b4bcdf9f2`, ocorreram 47 mortes por fome. Estado e crônica repetiram sem divergência; os detalhes estão em `docs/verification/JUL-178-food-current-730-20261026.json`. A auditoria até o dia 253 registrou zero mortes por fome, mas 4.288 adultos-dia com reserva menor que 20 (`JUL-178-food-current-253-20261026.json`).

O trace `JUL-178-food-death-trace-current-730-20261026.json` capturou as oito primeiras mortes até o dia 479 (nove já contadas no mundo): seis soldados morreram com reserva zero, saúde abaixo de 0,45 e a ação anterior `rest`, embora o sensor encontrasse biomassa de fruto a até cerca de dois tiles. O fluxo calculava `survivalAction` como nulo para todo soldado em paz antes de testar a reserva crítica; a regra de recuperação então sobrepunha o retorno à guarnição e a colheita. A regressão `tests/food-survival.test.mjs` reproduziu o caso com um soldado seed 42: antes da correção a decisão era `rest`, apesar de um alvo alcançável.

Os outros dois casos capturados eram dependentes. Eles não compartilham essa prioridade militar: os estoques comunitários estavam zerados e os adultos próximos também tinham reservas baixas. Não atribuo essas mortes a transferência inventada de alimento, que os testes de conservação já descartam; o limite de cuidado continua uma lacuna separada da auditoria.

## Decisão

Aplicar a regra de sobrevivência de fome crítica (`foodReserve <= 8`) aos soldados em paz antes da exclusão de sua política militar diária. Água em estado crítico continua tendo prioridade. Quando comida já está visível, o soldado vai colher da biomassa existente; a regra não cria oferta, não reduz demanda e não altera a taxa de recuperação. Reservas acima do limiar continuam usando a volta à guarnição e sua ração finita.

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Repor o estoque militar automaticamente ou reduzir a necessidade diária | Rejeitada | Esconderia um erro de prioridade com alimento criado ou menor demanda, sem prova de que a reserva faltante seja a causa imediata. |
| Desabilitar descanso de soldados feridos | Rejeitada | Removeria a recuperação mesmo quando não há comida; não resolve o caso específico observado. |
| Priorizar a busca emergencial apenas quando a reserva chega a 8 pontos ou menos | Escolhida | Usa a fonte finita já percebida pelo agente, preserva a recuperação fora da emergência e respeita a precedência da sede crítica. |

## Fontes e limites

- Game Studio / arquitetura atual: manter as decisões econômicas em `simulation/individuals/actions.js`, sem deslocá-las ao Canvas/renderer ou trocar o Worker. Como a alteração é somente da escolha de ação e não muda UI, efeitos ou contato de golpes, a prova direta é o teste de simulação mais o replay determinístico; não é uma captura visual de combate.
- SciSpace: van Voorn et al., [“An agent based model representation to assess resilience and efficiency of food supply chains”](https://doi.org/10.1371/journal.pone.0242323) (PLOS ONE, 2020). O estudo informa a utilidade de observar fluxos e a troca entre eficiência e resiliência; não calibra ração ou prioridade para o Kingdom.
- SciSpace: Angourakis et al., [“Food for all: An agent-based model to explore the emergence and implications of cooperation for food storage”](https://doi.org/10.1179/1749631414Y.0000000041) (2015). Serve como contexto para distinguir alimento pessoal e estoque comum; não substitui a contabilidade do jogo.
- Consensus: cota indisponível, com reset anunciado para 01/11/2026; documentado em `docs/decisions/JUL-195-architecture-and-evidence.md`. A pesquisa não bloqueou a correção.
- A evidência acadêmica orienta a escolha de medir estoques e resultados; o teste e o replay são a evidência sobre o Kingdom. A conclusão desta fatia não fecha o critério de sustentabilidade de JUL-178.

## Validação

- O teste foi executado antes da alteração e falhou como esperado (`rest` em vez de `forage`); após a alteração, `node --test tests/food-survival.test.mjs` passou e colheu alimento finito no segundo ciclo.
- A auditoria curta de 253 dias e a longa de 730 dias serão repetidas no SHA final da correção, incluindo estado e crônica para a mesma seed.
- A issue JUL-178 permanece aberta: os choques de estoque/cuidador, múltiplas seeds/horizontes, origem/destino e reconciliação quantitativa ainda não foram todos demonstrados.
