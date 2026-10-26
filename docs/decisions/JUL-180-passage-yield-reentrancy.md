# JUL-180 — limitar recursão ao ceder passagem

Data: 26/10/2026

## Evidência e causa

O replay de controle da seed 1 no horizonte de 730 dias parou por `RangeError: Maximum call stack size exceeded`, no dia 125. A reprodução no mesmo SHA `737fce35fd80edb5fffe5d920017ac3a6e06b99f` ocorreu mesmo sem a nova prioridade alimentar, então não é uma regressão dessa mudança. `tests/movement-passage.test.mjs` conserva a reprodução de 125 dias.

O ciclo estava em `moveOne` → `respondToPassageRequest` → `moveOne`: ao tentar ceder, um agente que encontrava outra pessoa no próximo tile iniciava uma segunda solicitação. Várias solicitações pendentes podiam formar um ciclo e esgotar a pilha em vez de devolver o controle à simulação.

## Decisão

Um movimento marcado como `passageYield` não inicia uma nova solicitação de passagem. Se o passo preferido estiver ocupado, a rotina tenta o desvio local e a rota de congestionamento existentes; se ainda estiver bloqueado, a ação termina sem mover. A solicitação original continua sendo limitada e pode ser reavaliada na próxima atualização.

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Remover as solicitações de passagem | Rejeitada | Tiraria a cooperação que ajuda agentes a sair do caminho e não é necessária para eliminar o ciclo. |
| Acrescentar tentativas recursivas com limite alto | Rejeitada | O resultado depende da profundidade da cadeia de pessoas e mantém trabalho repetido sob congestionamento. |
| Não abrir outra solicitação durante um movimento que já está cedendo | Escolhida | Cada pedido concede uma tentativa de movimento; uma obstrução secundária usa os desvios existentes ou aguarda a próxima avaliação sem recursão. |

## Fontes e limites

- Game Studio / arquitetura atual: manter navegação, colisão e replanejamento no motor de simulação, sem duplicar regra no renderer. O ajuste não altera sprite, animação ou combate.
- SciSpace e Consensus não eram necessários para esta falha de controle de fluxo reproduzida diretamente no motor; Consensus também permanece sem cota até 01/11/2026, conforme `docs/decisions/JUL-195-architecture-and-evidence.md`.
- O teste não prova fuga de obra ou retomada resiliente; demonstra apenas que o caso de congestionamento que travava o replay agora termina em até 125 dias.

## Validação

- Antes do ajuste, `node --test tests/movement-passage.test.mjs` falhou no dia 125 com `Maximum call stack size exceeded`.
- Após o ajuste, o mesmo teste passou em 29,1 s e chegou ao dia 125.
- A execução de seed 1 por 730 dias e as seeds de controle 987/2026 ainda serão repetidas no SHA final desta fatia.
