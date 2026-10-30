# Decisão: observações e prompt estratégico do rei — 27/10/2026

## Decisão

Dar ao rei um relatório agregado e limitado por papel sobre estoque, demanda, construções, roças, rebanho, ordens e resultados anteriores. O modelo só escolhe entre IDs válidos preparados pelo domínio; a simulação continua validando custo, trabalhador, local, alvo, estado e validade antes de executar. A alternativa de pedir uma ordem livre em texto foi rejeitada por permitir tarefas impossíveis e esconder os bloqueios.

O prompt separa comida imediata da capacidade futura. Ele explica que roça concluída usa sementes finitas, o campo produz alimento somente após crescer e ser colhido, e a carga só alimenta a reserva após entrega; biomassa em pé e histórico não são estoque. Curral tem limite por vaga e exige ração; ovelhas não viram carne antes de abate/entrega observados. Ordens ativas, bloqueios e o último resultado ajudam a evitar repetir trabalho sem progresso.

## Evidência alimentar corrigida

O replay em `docs/verification/JUL-178-food-post-JUL198-365-multiseed-20261027.json` usa source revision `33394f007fe5be82c4b8b16b80efe2a2932d0feb`. A seed 42/365, repetida de forma determinística, terminou com duas roças completas (dias de conclusão 112 e 123), 16 de massa semeada, 6.849,42 de biomassa cultivada ainda no campo e 5.464,68 historicamente colhidas. Mesmo assim, a reserva comunitária terminou em 1,11; tesouro, mercado e carne de rebanho terminaram em zero; houve 11.339 adultos-dia abaixo de 20 na reserva pessoal e nenhuma morte humana por fome. A causa exata da baixa retenção não está isolada por este replay.

Essa evidência descarta a antiga descrição de “roças incompletas e zero colheita”, corrigida na conversa da [JUL-224](https://linear.app/julio-alves/issue/JUL-224/m3-dimensionar-rocas-e-currais-pela-demanda-alimentar-da-populacao). A biomassa no campo e a colheita acumulada não contam como alimento entregue. O alvo de 50 moradores por roça+curral continua sem comprovação.

## Resultado do teste no navegador

Na seed browser `3620835298`, Qwen3 0.6B selecionou quatro vezes “buscar alimento para a reserva comum”. As quatro respostas registradas eram válidas e escolheram uma ação permitida; uma resposta exibiu 8,9 s. Isso confirma o contrato e o caminho de fallback, mas não prova que o rei escolhe cultivar, colher ou ampliar curral quando essas opções são viáveis. A consulta seguinte ficou pendente por mais de 40 s; o adapter agora tem prazo de 30 s e desliga a sessão de IA depois de aplicar fallback. Essa mitigação foi verificada por teste do adapter, não por um replay de timeout real.

## Consequências e próximos critérios

- Manter JUL-178 e JUL-224 abertas: rastrear por dia a colheita, o limite de carga, a entrega, o consumo e a reposição comunitária; demonstrar produção líquida para 50 moradores em seeds pareadas.
- Testar numa situação com roça pronta, sementes, trabalhador e local viável que o rei considera construção/cultivo; testar também tarefa bloqueada para provar que não duplica trabalhadores.
- Testar com campo maduro e estoque baixo que a coleta entrega lote útil acima da necessidade diária individual e mantém reserva de raiz.
- Medir decisão e timeout separadamente em cenários de rei e general antes de promover ou concluir qualquer issue.

## Fontes

- Relatório determinístico JUL-178 citado acima, inclusive SHA do estado da seed 42: `ed5f00f3202077ff377bb5638f1f76b58df43e929b30438120ff6d33bed62b14`.
- `src/ai/kingdom-strategy-prompt.js`, `src/simulation/kingdoms/strategy.js` e `tests/ai-calendar-observations.test.mjs`; testes focados 10/10, suíte total 227/227, typecheck e build aprovados.
- Referências metodológicas e a indisponibilidade temporária do Consensus registradas em JUL-195; nenhum estudo foi usado para inferir rendimento de roças ou velocidade do modelo.
