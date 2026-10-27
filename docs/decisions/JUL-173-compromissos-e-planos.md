# JUL-173 — Compromissos e planos individuais

## Decisão

Construir o ciclo de planos como estado determinístico do Worker, em pequenos passos verificáveis. A primeira fatia de gameplay cobre pedidos de ajuda alimentar, reutilizando a transferência social já existente. A pessoa registra aproximação, pedido e recebimento; uma proposta permanece sem efeito econômico e só a aceitação cria uma obrigação. A conclusão exige um fato observado de transferência que cite o compromisso e atinja a quantidade prometida. Entregas parciais acumulam; vencimento sem entrega produz quebra explícita. O limite de registros sociais nunca bloqueia uma transferência alimentar válida. Nenhum passo adiciona alimento, pagamento ou recompensa neural.

Intenções conservam seu passo atual, prazo, impedimentos e condição de encerramento. O Worker usa o destino social já percebido, sem alterar observações, pesos ou recompensas da rede neural. Fome, sede, saúde, energia, ataque recente, perda de visibilidade e rota inviável suspendem o plano; recuperação ou reabertura da rota permite retomada. Morte do titular, indisponibilidade do ajudante ou prazo vencido abandonam o plano com fato e motivo, sem tarefa de movimento externa órfã. Compromissos e planos ficam ligados a `world.people`/`world.socialEvidence`, por isso troca de papel não zera obrigação nem carteira. A mudança não adiciona pagamentos militares nem outro débito de soldo.

Na revisão do ciclo de ajuda, foi coberto também o caso em que a reserva do solicitante recupera até o limiar de 40 enquanto a intenção ainda está aberta. O plano termina com motivo `need_satisfied` e cancela o compromisso proposto/aceito restante; se a entrega já cumpriu a obrigação, o plano fecha como concluído. Assim a recuperação não deixa movimento ou obrigação social órfãos.

Uma fatia seguinte conecta atraso de soldo ao plano `evaluate_service`: o evento de folha já registrado e lembrado pelo soldado inicia a revisão; uma execução posterior compara eventos de atraso/recuperação com o saldo devedor e produz `military_service_evaluated`. A revisão não transfere ouro, não aplica soldo novamente e não muda observações ou recompensas da rede individual. Atraso e pagamento são as fontes de verdade já existentes; o plano acrescenta leitura e conclusão verificáveis, sem duplicar o débito.

## Evidência e fontes

* O plano do projeto define o fluxo acontecimento → memória → crença → intenção → ação → resultado e exige execução de recursos pelo Worker: [`docs/npc-social-plan.md`](../npc-social-plan.md) e [plano S0–S6 no Linear](https://linear.app/julio-alves/document/plano-de-npcs-inteligentes-e-interacoes-sociais-objetivos-e-entregas-c9754f255ee9).
* No código, `proposeSocialCommitment` já criava um registro imutável `proposed` sem reservar recurso e `defineSocialIntention` guardava passos explícitos, progresso e impedimentos. Não havia transição de compromisso, execução de prazo ou manutenção diária da intenção.
* A transferência de ajuda existente em `resolveFoodAidRequest` já debita a reserva pessoal ou o estoque da comunidade e emite `food_aid_request_resolved` com a quantidade efetivamente movida; essa cadeia agora aceita/recusa o compromisso antes do efeito e liga o fato da transferência ao seu ID.
* SciSpace retornou Topçu, “Adaptive decision making in agent-based simulation” (2014), DOI [10.1177/0037549714536930](https://doi.org/10.1177/0037549714536930). O resumo descreve deliberação explícita de metas, comparação de tarefas concorrentes e monitoramento em tempo de execução. Isso apoia separar plano, condição e monitoramento; não demonstra que uma política específica de ajuda ou migração melhora Kingdom.
* Nova consulta no SciSpace encontrou Singh, “Commitments Among Autonomous Agents in Information-Rich Environments” (1997), DOI [10.1007/3-540-63077-5_31](https://doi.org/10.1007/3-540-63077-5_31), que distingue compromissos satisfeitos e inaplicáveis e trata políticas sociais para criação, satisfação e cancelamento; e Meneguzzi, Magnaguagno e Singh, “GoCo: planning expressive commitment protocols” (2018), DOI [10.1007/S10458-018-9385-0](https://doi.org/10.1007/S10458-018-9385-0), cujo resumo descreve planos coordenados por compromissos, autonomia de objetivos e incerteza de execução. Isso informa as transições explícitas de satisfação/cancelamento e a separação entre promessa e ação, sem validar causalmente os limiares escolhidos no jogo.
* O fluxo usa o contrato Worker→simulação já existente e foi validado por replay determinístico de interação social. Para a revisão de soldo, os testes exercitam a função de folha de pagamento de produção e o resultado aparece no inspetor individual. A skill Game Studio `game-playtest` está disponível; não há conector MCP Game Studio nesta sessão. Consensus continua indisponível pela cota até 01/11/2026; `linear_get_agent_context` retorna `Tool get_agent_context not found` apesar de aparecer no catálogo.

## Alternativas consideradas

1. Adicionar um planejador BDI geral ou mais chamadas a LLM. Rejeitada nesta etapa: aumentaria superfície e latência antes de testar o ciclo mínimo, e não é requisito para passos determinísticos reutilizarem ações existentes.
2. Reservar recursos ao propor ou aceitar uma promessa. Rejeitada: a obrigação não deve criar nem duplicar alimento; o saldo só muda na transferência efetiva, e cancelamento/quebra não pode perder recurso reservado.
3. Alterar pesos, observações ou recompensas da rede neural individual para “ensinar” os planos. Rejeitada: mistura planejamento com aprendizagem e impediria atribuir o resultado a uma causa; a issue exige experimento separado.
4. Implementar de uma vez ajuda, avaliação de serviço e migração. Adiada: são três domínios com condições e rotas distintas. Ajuda e revisão de remuneração já têm executores pequenos; a migração ganhou um executor delimitado, que retoma a rota registrada sem alterar a política neural.

## Verificação

Testes cobrem idempotência e aceite, ausência de efeito econômico antes da aceitação, débito/crédito real na entrega, cumprimento e quebra com fato verificável, compromisso exato da entrega, prazo, progresso monotônico, suspensão/retomada por emergência, reabertura de rota, limites de intenção e fallback de ajuda quando o limite de histórico é atingido. A revisão também cobre recuperação da reserva até 40: compromisso proposto/aceito restante é cancelado e a intenção termina com `need_satisfied`; um compromisso já cumprido fecha o plano como concluído. No SHA validado antes deste commit, `npm test` passou com 165/165; `npm run build` passou (typecheck, 107 módulos Vite e otimização de 489 PNGs para WebP). A rede individual, seus inputs e as recompensas ficaram sem alterações.

Playtest anterior no navegador em `http://127.0.0.1:5176/?seed=44`: simulação pausada, mapa aproximado a 153%, seleção da moradora Jaci I e inspeção da seção “Fatos e relatos conhecidos”. O painel mostrou quatro partilhas de alimento de 3 pontos observadas diretamente (dias 37, 35, 27 e 23), além da memória e da lição recente, sem revelar conhecimento privado. A captura visual foi revisada durante o playtest nesta sessão. A revisão econômica final continua vinculada a JUL-162/JUL-178; a política de campanha continua vinculada a JUL-163.

### Revisão de soldo após compromisso atrasado

No branch `codex/jul195-integration`, `node --test tests/military-pay-social.test.mjs tests/social-plans.test.mjs tests/social-aid.test.mjs tests/social-inspector.test.mjs` passou 21/21; `npm run typecheck` passou; `npm test` passou 166/166 sem falhas ou cancelamentos (147,14 s); `npm run build` passou (107 módulos Vite e otimização de imagens); `git diff --check` passou. O cenário de teste observa atraso, revisa histórico em dois passos e então verifica a recuperação de 15 ouro. A tesouraria vai de 15 a 0 uma vez, a carteira do soldado recebe 15, e a inspeção renderiza “avaliação do serviço militar · soldo em dia”.

Playtest visual do browser no build local, seed 42, dia 76: carregamento, pausa/retomada, velocidade, zoom de 200% e painel do reino/campanha foram exercitados; o mapa permaneceu visível atrás do painel e não houve erro visual observado. Esse replay não apresentou um fato de avaliação de soldo selecionável durante a inspeção; a linha específica do evento foi verificada no renderer por teste determinístico, não por captura de tela. A nova regra registra apenas leitura de eventos e saldo atual: não paga, cobra, recruta, desmobiliza nem altera a política militar. Consensus segue sem cota; SciSpace não foi consultado novamente para esta fatia, que reutiliza os contratos e fontes já registrados acima.

## Limites da fatia em 2026-10-26

* Ajuda alimentar percorre uma rota social existente; uma rota sem avanço registra `route_infeasible`, mantém o progresso anterior e pode ser tentada de novo quando o alvo voltar a estar visível.
* A revisão de remuneração verifica o saldo e os fatos de folha, mas ainda não altera retenção, recrutamento ou resposta política a soldo atrasado. O plano de migração mantém e executa uma rota individual; provisões, acolhimento e entrada comunitária continuam fora desta fatia.
* A evidência do inspetor mostra até seis fatos recentes para conservar a cadeia curta de pedido, aceite, transferência e resolução sem ocultar os eventos do plano.

## Execução do plano de migração — 27/10/2026

A ação `migrate` agora cria ou retoma uma intenção `prepare_migration` com destino determinístico, dois passos (`select_viable_destination`, `reach_destination`), prazo de 14 dias e condição explícita de encerramento. Cada tentativa de movimento atualiza progresso e evidencia destino; rota fechada mantém `route_infeasible`, e fome crítica/ataque recente são impedimentos físicos registrados pela mesma função usada na manutenção diária. Quando a rota abre e os impedimentos desaparecem, a mesma intenção continua. A chegada fecha o plano com fato verificável. Não há tarefa de movimento paralela que possa ficar órfã.

A coordenada de destino foi adicionada ao contrato versionado da intenção como campo opcional para compatibilidade com registros antigos. O inspetor do indivíduo agora mostra até quatro planos e compromissos, incluindo estado, progresso, prazo, destino, próximo passo e impedimento. A seleção continua no motor atual; não adiciona entrada, recompensa, observação ou atualização à rede neural individual.

Teste integrado em seed 42 cobre migração forçada e preservação do vetor neural de 18 entradas; outra execução fecha a rota com um anel de terreno intransitável, confirma os impedimentos `route_infeasible`, `critical_hunger` e `recent_attack`, abre o corredor e recupera a fome, e então verifica retomada do mesmo ID/destino com deslocamento. A integração também usa `enlistSoldier` para confirmar persistência de carteira, intenção e compromisso durante a mudança real de papel. Testes direcionados dos planos, inspetor, ajuda e soldo passaram 25/25:

```text
node --test tests/social-plans.test.mjs tests/social-inspector.test.mjs tests/migration-plans-runtime.test.mjs tests/social-aid.test.mjs tests/military-pay-social.test.mjs
25 passed, 0 failed
```

Game Studio orientou manter o plano no estado determinístico do Worker, validar o fluxo no jogo e apresentar a progressão no inspetor. As fontes SciSpace já registradas acima apoiam separar deliberação e execução, mas não calibram prazo nem destino. Consensus continua indisponível pela cota e `linear_get_agent_context` continua retornando `Tool get_agent_context not found`; não foram usadas como evidência de comportamento.

### Decisão revista

Agora há execução para os três contratos desta issue: ajuda, avaliação de serviço militar e preparação de migração. O destino fixo do plano foi escolhido em vez de recalculá-lo sem registro todos os dias, pois isso preserva o objetivo e torna tentativas/impedimentos auditáveis. Um planejador geral ou novo estado neural continua adiado.

### Gates e playtest final — SHA `10e375ef6ffc0787cb994cec8b787e39a1b11d76`

No SHA final desta fatia, `npm test` passou 180/180, `npm run typecheck` passou, `npm run build` passou com 107 módulos e 489 PNGs otimizados para WebP (8,03 MiB → 5,27 MiB), e `git diff --check` passou. Os testes direcionados passaram 25/25; após adicionar a asserção explícita de que migração forçada preserva `actionValues`, `updates` e `rewardMean`, `node --test tests/migration-plans-runtime.test.mjs` passou 2/2.

Playtest no navegador: `http://127.0.0.1:4173/?seed=42&paused=1`, simulação avançada a 3× até o dia 238, selecionado Ivo J e painel do indivíduo rolado até “Planos individuais”. O painel tornou visíveis estado terminal, passos, prazo e `deadline expired`; compromissos vencidos e fatos associados aparecem logo abaixo. A captura completa, com o mapa preservado ao fundo, foi anexada ao comentário de JUL-173. A leitura de logs do navegador não encontrou erros. Isso demonstra apresentação e rastreabilidade na UI; a retomada e as condições do plano são demonstradas pelo teste integrado no Worker.

Com esses critérios demonstrados, JUL-173 está pronta para Done. O limite permanece: a migração guarda/executa uma rota individual; provisões, acolhimento e entrada comunitária ficam para outra fatia.
