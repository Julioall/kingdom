# JUL-178 — Construção de roça durante escassez

## Problema observado

O lote da roça agora é limitado pela massa de sementes e pelos tiles realmente ocupados: `min(sementes × 1.250, tiles × 420)`. A meta padrão continua em 10.000 para 8 unidades de semente e 24 tiles. O replay da seed 42 no SHA `2b66d1c86e7e74899aa874afc42688f78cf2b3e2` mostrou que essa produção não ajudaria enquanto as roças ficassem incompletas (33/34 e 0/34); ambas as comunidades terminaram sem comida.

## Evidência e diagnóstico

O replay de 365 dias no SHA `7fd1778684ff71924338484cf4110b3e2e2bfe2b` repetiu a seed 42 de forma idêntica. A exceção de reserva alimentar ajudou uma roça da seed 1 a chegar a 34/34 e entregar 9.953,36 das 10.000 unidades colhidas; a outra comunidade daquela seed continuou sem produção. Na seed 42, as roças terminaram em 33/34 e 6/34, sem colheita, e os estoques comunitários chegaram a zero.

O rastreamento diário da seed 42 localizou duas barreiras distintas: construtores de roça com reserva entre 8 e 24 eram tratados como indisponíveis; depois de permitir que um construtor persistisse acima de 8, os candidatos paravam quando energia chegava a 27. A recuperação domiciliar só começa em 24 (`GARRISON_RECOVERY.startRestEnergy`), portanto pessoas entre 24 e 27 não construíam nem descansavam. A mesma inspeção também mostrou dias em que todos os adultos próximos estavam retidos em tarefas de coleta urgente.

## Decisão

Manter uma exceção estreita, somente para obra de roça já financiada ou atribuída como `invest-in-cultivated-food`:

- um construtor pode continuar enquanto sua reserva alimentar estiver acima de 8;
- a energia mínima acompanha o início do descanso (`>24`); ao alcançar 24, a política de recuperação pode agir;
- outros edifícios mantêm os limites anteriores (24 de reserva e mais de 27 de energia);
- a tarefa imediata de sobrevivência ainda substitui a construção no limiar crítico de comida.

Alternativas rejeitadas: aumentar artificialmente o estoque ou a colheita para esconder a obra travada; reduzir limites de energia e fome para todo tipo de construção; deixar todo o reino construir e interromper a coleta de curto prazo. A exceção de um trabalhador preserva a coleta dos demais e não altera as regras de sobrevivência nem a unidade dos estoques.

## Fontes e limites

O requisito de sementes/área está registrado em [JUL-178-field-yield-area-seed.md](JUL-178-field-yield-area-seed.md), com a consulta SciSpace sobre simulação de lavoura até a colheita. Os coeficientes são calibração de gameplay, não estimativas agronômicas. Consensus continua indisponível até o reset de cota informado para 01/11/2026. A escolha dos limites de trabalho decorre do comportamento concreto do motor: fome crítica começa em 8 e descanso em casa em 24. Não foi adicionada mecânica ecológica ou sazonal.

## Verificação

- No SHA `7fd1778`, 30/30 testes focados passaram e `npm run build` passou. O replay anual confirmou melhora parcial, mas não o aceite alimentar: seed 42 continuou sem colheita e ambas as reservas comunitárias terminaram em zero.
- No SHA `66092bab2a33fddfcd38820856422c76d8e778fe`, a mesma suíte focada passou em 30/30 e o build local passou. O replay 365 dias da seed 42 completou com hash de estado `2b2c1d8d30affd0bce21d270b393feb8793ddb1fe0ba8c716bec996c16222067` e crônica `27bc09fd7af8b4094152fcf31107f1aea906bf2b5758ff864b1c36b619c0a004`. A roça da Corvânia concluiu no dia 154, colheu 10.000 e entregou 9.962,02; a comunidade terminou com 2.774,26 unidades e recuperou o estoque acima de 300. Valedouro continuou sem produção, com a outra roça em 4/34, estoque final zero e 230 dias abaixo de 300. O total caiu de 12.138 para 8.496 adulto-dias abaixo de 20, mas isso não demonstra alimentação estável para ambos os reinos.
- A repetição exata da seed 42 foi confirmada no SHA `7fd1778`, antes do ajuste de energia. O mundo seed 42 começa com zero madeira e pedra nas duas comunidades, enquanto `nextCommunityStructure` exige esses materiais para uma roça. A inspeção do fallback e das opções do rei confirma que, quando o alimento está abaixo da meta e os materiais faltam, o plano seleciona coleta de alimento e não expõe a reunião dos materiais da roça. Isso é consistente com a roça tardia (6/34 no SHA `7fd1778`; 4/34 no `66092ba`). O próximo passo é atacar esse gargalo sem tirar todos os trabalhadores da busca de comida.
- Ainda não há critério para encerrar JUL-178: faltam a repetição da suficiência em ambas as comunidades/seeds, os demais horizontes e seeds, o mercado explícito de sementes de JUL-201 e a cadeia alimentar do rebanho onde aplicável.

## Diagnóstico adicional — tarefa de construção encerrada cedo demais

O rastreamento diário da seed 42 no SHA `b7fb972a6cf3eb2b0e4894f14e8a40014899f788` confirmou que Valedouro tinha sementes, madeira e pedra para iniciar a primeira roça. O canteiro avançou a 17/34 no dia 33 e 19/34 no dia 100, mas ficou parado enquanto o estoque comum acabava. Portanto, o segundo gargalo não era o rendimento por semente nem a falta inicial de materiais.

`completeCommunityTask` tratava qualquer aumento de progresso de uma obra de vários dias como conclusão da tarefa. Isso limpava a designação do construtor após cada dia de trabalho. Com os demais adultos ocupados por coleta urgente, a governança não encontrava outro trabalhador livre, e o canteiro parava até surgir alguém elegível. Corrigi esse contrato para conservar `complete-funded-project` enquanto a estrutura financiada ainda estiver incompleta; o prestígio e a liberação da tarefa ocorrem somente quando a obra termina. O teste de regressão cobre os dois momentos.

Alternativas rejeitadas: reduzir novamente limites de fome/energia sem evidência de que eles eram a causa; elevar o lote ou criar alimento para compensar um canteiro que não terminava; reservar mais trabalhadores à obra, o que reduziria a coleta corrente. A mudança preserva um único construtor e o limite crítico de sobrevivência.

SciSpace foi consultado novamente em 27/10/2026. *The EPIC crop growth model* (Williams et al., 1989, [DOI 10.13031/2013.31032](https://doi.org/10.13031/2013.31032)) descreve crescimento, conversão em biomassa e partição do rendimento; isso apoia manter ciclo e rendimento finitos, mas não valida os coeficientes de jogo nem substitui a evidência do replay. A busca de Consensus segue indisponível pela cota mensal com reset informado em 01/11/2026. O conector de contexto do Linear continua respondendo `Tool get_agent_context not found`; a tentativa foi registrada e o trabalho prosseguiu usando as issues e o repositório. A fatia é lógica e não muda a apresentação visual; a verificação primária é o replay determinístico.

Commit da correção: `20c81ef6e415c03712a2bf16777f1defa839c6a3`. Teste direcionado (`ai-calendar-observations`, `field-construction-reserve`, `cultivated-food-batch`): 16/16 passaram. `npm run build`: typecheck, Vite e otimização de imagens passaram.

No replay pós-correção de 365 dias, as seeds 1 e 42 completaram ambas as roças de cada mundo, colheram 10.000 por roça e entregaram de 9.856,51 a 9.965,54 unidades por lote. Nenhuma comunidade ficou abaixo de 300; os estoques finais foram 2.478,28–3.340,58 (seed 1) e 2.469,03–2.530,10 (seed 42). A repetição da seed 42 foi idêntica: estado `af89aa3558fc247382469f585e2489244745b18f617ba5a43d33fe95b4a7be9c`, crônica `88be587c6048fa162acd802a50c3eb67d2dac60af76af0fd3dfe84321fcd9994`. Não houve morte por fome; as mortes registradas foram por invasão na seed 1 e combate/invasão na seed 42. Adulto-dias com reserva pessoal abaixo de 20: 4.263 e 3.921. Relatório: `docs/verification/JUL-178-field-builder-persistence-365-20261027.json`.

Os holdouts 987 e 2026 também concluíram as duas roças por mundo, colheram 10.000 cada e mantiveram o estoque comum acima de 300 em todos os dias. Os saldos finais foram 3.086,09/3.392,27 (seed 987) e 2.325,38/2.605,98 (seed 2026). Uma morte por fome aparece na seed 2026, mas o registro identifica o morto como soldado em campanha 182: a reserva pessoal era zero, a campanha consumiu exatamente as 4.237,75 unidades entregues (309,80 iniciais + 3.927,95 de reposição), o ledger fecha sem diferença, e o estoque civil permaneceu acima de 2.300. Classifico essa morte como consequência plausível de uma campanha que esgotou sua ração, não como falha de produção civil; ela deve continuar visível nos critérios de logística/retirada militar, pois morrer em guerra é um resultado possível das decisões do reino. Não houve morte civil por fome nas quatro seeds de 365 dias.

Relatório de holdouts: `docs/verification/JUL-178-field-builder-persistence-365-holdouts-20261027.json`. Isso demonstra que a tarefa persistente removeu o gargalo observado e mantém uma reserva comum acima do limite crítico no primeiro ano para quatro seeds. Não demonstra seis meses de reserva total no fim do ano nem compra/replantio de sementes; a validação do horizonte de 730 dias e a repetição exata do comportamento em seeds longas continuam pendentes. JUL-178 permanece aberta.

## Continuidade do plantio — lacuna de decisão e ação

O rei recebe a informação correta: o prompt do sistema afirma que uma roça tem lote finito e não regenera depois da colheita sem novo plantio; o relatório estratégico expõe sementes usadas, alvo, biomassa em pé, colheita histórica e `cycleState`. Porém, as opções atuais só constroem uma nova roça quando `nextCommunityStructure` ainda pede a primeira, e `fundFoodInfrastructure` encerra quando já existe uma roça completa. Não há escolha nem tarefa para comprar sementes e semear novamente a área existente. Logo, o rei entende o conceito, mas ainda não consegue agir para manter a produção.

Decisão: depois de fechar a auditoria de JUL-178, implementar a continuidade como parte da economia de mercado em JUL-201, que já trata de sementes, compra e conservação. A ação deve começar antes de a reserva entrar em emergência, manter o rendimento limitado ao lote comprado e aos tiles, e só iniciar após débito de sementes reais. Alternativas rejeitadas: regrowth ou lote gratuito automático, e construir uma roça nova a cada colheita. O comentário de design foi registrado em JUL-201; a issue continua Backlog/blockedBy JUL-178.

### Resultado do replay de continuidade — 730 dias

Fonte do motor: `20c81ef6e415c03712a2bf16777f1defa839c6a3`. Rodei 730 dias nas seeds 1/42/987/2026 e repeti a seed 42. O relatório reproduzível está em `docs/verification/JUL-178-field-builder-persistence-730-multiseed-20261027.json`. A repetição da 42 confirmou o mesmo estado (`a54bf4cdc8712bec52a055d9efd7f25af6c5a419e4007c176f6aa61a135ae937`) e crônica (`44b03f9348df7803a78afe7b90760db64dc156ed62ed9c0c2a8788ac170e0490`). Todos os lados de campanha tinham ledger, sem diferenças de fonte ou balanço.

O primeiro lote funcionou: em cada seed, as duas roças concluíram, colheram 10.000 cada e entregaram 19.727,74–19.915,82 no total. Mas, ao dia 730, as oito comunidades estavam sem estoque de comida, com 284–319 dias abaixo de 300 e sem cultivo em pé; as duas roças por mundo tinham `cropSeedStored=0`. As seeds registraram 2–12 mortes humanas por fome cada e 23.713–26.292 adulto-dias com reserva abaixo de 20. O motor não replantou o campo depois de consumir o lote.

Conclusão: a persistência da obra elimina o bloqueio de construção e a primeira colheita fecha contabilmente, mas **não há continuidade de plantio** no runtime atual. O rei entende que o lote é finito e não regenera; contudo, não dispõe de ordem nem de estoque de sementes para replantar. Isso reprova a continuidade de produção no horizonte de dois anos e não deve ser descrito como solução sustentável. A decisão de manter a compra de sementes e a ordem de replantio em JUL-201 continua coerente com a fronteira de issues, mas a auditoria alimentar permanece aberta até o fluxo posterior ser executado e medido.
