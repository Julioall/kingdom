# JUL-197 — Loot militar não transporta pedra civil

## Decisão

Soldados podem recolher uma pilha de saque por alimentos, ouro ou outros recursos que já façam parte do fluxo militar existente, mas a coleta genérica não deve transferir pedra para `carriedStone`. A pedra continua na pilha para trabalhadores civis. Uma pilha que contém apenas pedra não é um alvo de saque para um soldado.

Na promoção, a tarefa civil é cancelada e qualquer pedra já carregada volta ao estoque comunitário de origem. O estoque total antes e depois da promoção precisa ser igual.

## Evidência no código e no relato

- O relato do jogador em JUL-197 foi “um soldado carregando uma pedra”; não havia seed, dia nem captura inicial.
- `nearestLoot` escolhia qualquer pilha com recurso disponível e `collectLoot` incluía `stone` na ordem genérica. Durante campanhas, o ramo de ações militares pode executar `collect_loot`; assim, uma pilha deixada por estrutura destruída podia virar carga de pedra em um soldado.
- `enlistSoldier` já chama `clearCivilianDuties`, que limpa a designação civil e transfere `carriedStone` para o estoque comunitário. O caso de promoção, portanto, é uma proteção de regressão, não a origem da carga vista.
- A pose visual usa a carga real `carriedStone` para exibir a pedra. A correção limita a origem da carga, sem esconder carga verdadeira na interface.

## Alternativas consideradas

1. **Excluir pedra do saque militar genérico (escolhida):** menor mudança; civis continuam coletando e o fluxo militar não recebe uma nova regra de mineração.
2. **Permitir a coleta se existir um depósito militar:** exigiria definir prédio, destino e uso militar da pedra; JUL-197 não registra tal necessidade.
3. **Manter a coleta genérica:** deixa a classe militar acumulando material civil sem destino explícito e reproduz o relato.

## Fontes e limites

- Contrato de produto: critérios de aceite de JUL-197, relacionados à exclusividade militar de JUL-166.
- SciSpace encontrou literatura de simulação logística que trata suprimentos como classes com fluxos e destinatários definidos, por exemplo [Modeling the effects of logistics on ground combat and maneuver](https://calhoun.nps.edu/handle/10945/8691). Isso é contexto de modelagem, não uma regra publicada de game design sobre pedra ou pilhagem; a exclusão de pedra é uma decisão específica do projeto derivada dos critérios de JUL-197.
- Consensus está indisponível até 1º de novembro de 2026: o limite mensal de 30 buscas foi atingido.
- Notas do Linear não puderam ser consultadas: `linear_get_agent_context` retorna “Tool get_agent_context not found”. O issue e o código foram usados como fontes primárias.

## Validação

Os testes de JUL-197 cobrem: soldado ignora pilha só de pedra; coleta civil permanece possível; uma pilha mista mantém a pedra após o soldado recolher itens permitidos; promoção cancela a tarefa e transfere a carga sem perda nem duplicação. O replay de múltiplas seeds e o playtest do navegador serão registrados no comentário da issue com o SHA final.
