# JUL-180 — limitar recursão ao ceder passagem

Data: 26/10/2026

Commit da fatia: `dae979502b8d02b3e5b9cd97570cb1682c29f210` (`fix(JUL-180): stop recursive passage yielding`).

## Evidência e causa

O replay de controle da seed 1 no horizonte de 730 dias parou por `RangeError: Maximum call stack size exceeded`, no dia 125. A reprodução no mesmo SHA `737fce35fd80edb5fffe5d920017ac3a6e06b99f` ocorreu mesmo sem a nova prioridade alimentar, então não é uma regressão dessa mudança. `tests/movement-passage.test.mjs` conserva a reprodução de 125 dias.

O ciclo estava em `moveOne` → `respondToPassageRequest` → `moveOne`: ao tentar ceder, um agente que encontrava outra pessoa no próximo tile iniciava uma segunda solicitação. Várias solicitações pendentes podiam formar um ciclo e esgotar a pilha em vez de devolver o controle à simulação.

## Decisão

O primeiro reparo impedia toda solicitação aninhada durante `passageYield`, mas o replay da seed 42 mudou de 5 para 25 mortes por fome e de 34.914 para 38.148 adultos-dia com reserva baixa em relação ao SHA anterior. Isso não prova causalidade exclusiva, mas mostra que a guarda ampla não é neutra. A revisão mantém repasses cooperativos e acompanha apenas a cadeia ativa: bloqueia IDs já visitados ou mais de 12 transferências; em ciclos, o agente usa o desvio local e a rota de congestionamento existentes.

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Remover as solicitações de passagem | Rejeitada | Tiraria a cooperação que ajuda agentes a sair do caminho e não é necessária para eliminar o ciclo. |
| Proibir qualquer pedido aninhado | Rejeitada após replay | Evita recursão, mas o amplo bloqueio coincide com uma diferença material na sobrevivência e restringe cadeias válidas. |
| Rastrear IDs ativos e limitar profundidade a 12 | Escolhida para validação | Mantém repasses para pessoas ainda não visitadas e encerra repetição de ID ou cadeia excessiva. O limite é uma proteção, não evidência de comportamento tático completo. |

## Fontes e limites

- Game Studio / arquitetura atual: manter navegação, colisão e replanejamento no motor de simulação, sem duplicar regra no renderer. O ajuste não altera sprite, animação ou combate.
- SciSpace e Consensus não eram necessários para esta falha de controle de fluxo reproduzida diretamente no motor; Consensus também permanece sem cota até 01/11/2026, conforme `docs/decisions/JUL-195-architecture-and-evidence.md`.
- O teste não prova fuga de obra ou retomada resiliente; demonstra apenas que o caso de congestionamento que travava o replay agora termina em até 125 dias.

## Validação

- Antes do ajuste, `node --test tests/movement-passage.test.mjs` falhou no dia 125 com `Maximum call stack size exceeded`.
- A primeira correção ampla passou o teste de 125 dias em 29,1 s; o replay seed 42 de 730 dias repetiu exatamente, mas divergiu materialmente do SHA anterior. A revisão de cadeia limitada também passou `node --test tests/movement-passage.test.mjs` em 26,9 s e chegou ao dia 125.
- `npm test` passou em 125/125, incluindo a reprodução de 125 dias; `npm run build` passou com typecheck, Vite (107 módulos) e otimização de imagens.
- No replay de 730 dias no mesmo SHA, as seeds 1, 987 e 2026 concluíram sem a recursão nem estoques negativos. Resultados: seed 1, 12 mortes por fome e 2 por invasão; seed 987, 27 por fome, 2 em combate e 7 por invasão; seed 2026, 2 por fome, 1 em combate, 1 na colheita e 3 por invasão. Esses resultados não são pareados e não comprovam melhora uniforme da sobrevivência. O holdout da revisão limitada em `09d3933` está em `docs/verification/JUL-178-bounded-passage-holdouts-730-20261026.json`; nele a seed 987 cai para 7 mortes por fome, mas a seed 2026 sobe para 27, reforçando que o resultado depende da seed.
- A guarda ampla no SHA `dae9795` teve 25 mortes por fome e 38.148 adultos-dia de reserva abaixo de 20 (`JUL-178-garrison-priority-730-after-passage-20261026.json`). A revisão `09d3933` repetiu estado `6d272cd56cc103b978a189f2e641f184339d38eb50491327bcd563090cea1af5` e crônica `7c1ee5ec265254c557c1499bce244b3da9b170410df29e38d00c7269e55f1c5b`; teve 0 mortes por fome, 10 por invasão e 36.913 adultos-dia abaixo de 20 (`JUL-178-garrison-priority-730-after-bounded-passage-20261026.json`). A regressão de fome retornou abaixo do checkpoint com guarda ampla, mas a diferença de invasões e a falta de replays pareados para as demais seeds impedem concluir neutralidade ou melhoria geral.
- Após os follow-ups de retenção social, o código `c5f3bb2ece1313a82bd527a85314751f47235277` repetiu a seed 42/730 duas vezes com os mesmos hashes de estado `6d272cd56cc103b978a189f2e641f184339d38eb50491327bcd563090cea1af5` e crônica `7c1ee5ec265254c557c1499bce244b3da9b170410df29e38d00c7269e55f1c5b` do código `09d3933`. Resultado: 0 mortes por fome, 2 em combate e 10 por invasão. O relatório integral está em `docs/verification/JUL-178-final-social-fix-seed42-730-20261026.json`.
- JUL-180 continua aberto: esta fatia elimina a recursão e mantém a rota de replanejamento; não demonstra fuga de obra, cover sob ameaça, substituição ou retomada da construção.
