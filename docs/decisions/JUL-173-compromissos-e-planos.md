# JUL-173 — Compromissos e planos individuais

## Decisão

Construir o ciclo de planos como estado determinístico do Worker, em pequenos passos verificáveis. A primeira fatia de gameplay cobre pedidos de ajuda alimentar, reutilizando a transferência social já existente. A pessoa registra aproximação, pedido e recebimento; uma proposta permanece sem efeito econômico e só a aceitação cria uma obrigação. A conclusão exige um fato observado de transferência que cite o compromisso e atinja a quantidade prometida. Entregas parciais acumulam; vencimento sem entrega produz quebra explícita. O limite de registros sociais nunca bloqueia uma transferência alimentar válida. Nenhum passo adiciona alimento, pagamento ou recompensa neural.

Intenções conservam seu passo atual, prazo, impedimentos e condição de encerramento. O Worker usa o destino social já percebido, sem alterar observações, pesos ou recompensas da rede neural. Fome, sede, saúde, energia, ataque recente, perda de visibilidade e rota inviável suspendem o plano; recuperação ou reabertura da rota permite retomada. Morte do titular, indisponibilidade do ajudante ou prazo vencido abandonam o plano com fato e motivo, sem tarefa de movimento externa órfã. Compromissos e planos ficam ligados a `world.people`/`world.socialEvidence`, por isso troca de papel não zera obrigação nem carteira. A mudança não adiciona pagamentos militares nem outro débito de soldo.

Na revisão do ciclo de ajuda, foi coberto também o caso em que a reserva do solicitante recupera até o limiar de 40 enquanto a intenção ainda está aberta. O plano termina com motivo `need_satisfied` e cancela o compromisso proposto/aceito restante; se a entrega já cumpriu a obrigação, o plano fecha como concluído. Assim a recuperação não deixa movimento ou obrigação social órfãos.

## Evidência e fontes

* O plano do projeto define o fluxo acontecimento → memória → crença → intenção → ação → resultado e exige execução de recursos pelo Worker: [`docs/npc-social-plan.md`](../npc-social-plan.md) e [plano S0–S6 no Linear](https://linear.app/julio-alves/document/plano-de-npcs-inteligentes-e-interacoes-sociais-objetivos-e-entregas-c9754f255ee9).
* No código, `proposeSocialCommitment` já criava um registro imutável `proposed` sem reservar recurso e `defineSocialIntention` guardava passos explícitos, progresso e impedimentos. Não havia transição de compromisso, execução de prazo ou manutenção diária da intenção.
* A transferência de ajuda existente em `resolveFoodAidRequest` já debita a reserva pessoal ou o estoque da comunidade e emite `food_aid_request_resolved` com a quantidade efetivamente movida; essa cadeia agora aceita/recusa o compromisso antes do efeito e liga o fato da transferência ao seu ID.
* SciSpace retornou Topçu, “Adaptive decision making in agent-based simulation” (2014), DOI [10.1177/0037549714536930](https://doi.org/10.1177/0037549714536930). O resumo descreve deliberação explícita de metas, comparação de tarefas concorrentes e monitoramento em tempo de execução. Isso apoia separar plano, condição e monitoramento; não demonstra que uma política específica de ajuda ou migração melhora Kingdom.
* Nova consulta no SciSpace encontrou Singh, “Commitments Among Autonomous Agents in Information-Rich Environments” (1997), DOI [10.1007/3-540-63077-5_31](https://doi.org/10.1007/3-540-63077-5_31), que distingue compromissos satisfeitos e inaplicáveis e trata políticas sociais para criação, satisfação e cancelamento; e Meneguzzi, Magnaguagno e Singh, “GoCo: planning expressive commitment protocols” (2018), DOI [10.1007/S10458-018-9385-0](https://doi.org/10.1007/S10458-018-9385-0), cujo resumo descreve planos coordenados por compromissos, autonomia de objetivos e incerteza de execução. Isso informa as transições explícitas de satisfação/cancelamento e a separação entre promessa e ação, sem validar causalmente os limiares escolhidos no jogo.
* O fluxo usa o contrato Worker→simulação já existente e foi validado por replay determinístico de interação social. A skill Game Studio `game-playtest` está disponível; não há conector MCP Game Studio nesta sessão. Consensus continua indisponível pela cota até 01/11/2026; `linear_get_agent_context` retorna `Tool get_agent_context not found` apesar de aparecer no catálogo.

## Alternativas consideradas

1. Adicionar um planejador BDI geral ou mais chamadas a LLM. Rejeitada nesta etapa: aumentaria superfície e latência antes de testar o ciclo mínimo, e não é requisito para passos determinísticos reutilizarem ações existentes.
2. Reservar recursos ao propor ou aceitar uma promessa. Rejeitada: a obrigação não deve criar nem duplicar alimento; o saldo só muda na transferência efetiva, e cancelamento/quebra não pode perder recurso reservado.
3. Alterar pesos, observações ou recompensas da rede neural individual para “ensinar” os planos. Rejeitada: mistura planejamento com aprendizagem e impediria atribuir o resultado a uma causa; a issue exige experimento separado.
4. Implementar de uma vez ajuda, avaliação de serviço e migração. Adiada: são três domínios com condições e rotas distintas. A fatia de ajuda agora executa aproximação, pedido e transferência; avaliação de serviço e preparação de migração ainda não foram implementadas, então JUL-173 permanece aberta.

## Verificação

Testes cobrem idempotência e aceite, ausência de efeito econômico antes da aceitação, débito/crédito real na entrega, cumprimento e quebra com fato verificável, compromisso exato da entrega, prazo, progresso monotônico, suspensão/retomada por emergência, reabertura de rota, limites de intenção e fallback de ajuda quando o limite de histórico é atingido. A revisão também cobre recuperação da reserva até 40: compromisso proposto/aceito restante é cancelado e a intenção termina com `need_satisfied`; um compromisso já cumprido fecha o plano como concluído. No SHA validado antes deste commit, `npm test` passou com 165/165; `npm run build` passou (typecheck, 107 módulos Vite e otimização de 489 PNGs para WebP). A rede individual, seus inputs e as recompensas ficaram sem alterações.

Playtest no navegador em `http://127.0.0.1:5176/?seed=44`: simulação pausada, mapa aproximado a 153%, seleção da moradora Jaci I e inspeção da seção “Fatos e relatos conhecidos”. O painel mostrou quatro partilhas de alimento de 3 pontos observadas diretamente (dias 37, 35, 27 e 23), além da memória e da lição recente, sem revelar conhecimento privado. A captura visual foi revisada durante o playtest nesta sessão. A revisão econômica final continua vinculada a JUL-162/JUL-178; a política de campanha continua vinculada a JUL-163.

## Limites da fatia em 2026-10-26

* Ajuda alimentar percorre uma rota social existente; uma rota sem avanço registra `route_infeasible`, mantém o progresso anterior e pode ser tentada de novo quando o alvo voltar a estar visível.
* Avaliação de trabalho/serviço e preparação de migração têm schemas genéricos de intenção, mas ainda não têm executores nem critérios de resolução próprios. Não tratar JUL-173 como concluída.
* A evidência do inspetor mostra até seis fatos recentes para conservar a cadeia curta de pedido, aceite, transferência e resolução sem ocultar os eventos do plano.
