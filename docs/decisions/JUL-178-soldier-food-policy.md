# JUL-178 — provisão militar separada da coleta civil

Data: 27/10/2026
Estado: política de ação implementada; replay multissemente no SHA atual pendente.
Issue: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-caca-civis)

## Relato e decisão

O jogador observou soldados procurando alimento e pediu que eles não façam coleta civil. O soldado deve consumir ração atribuída ao serviço, enquanto moradores civis procuram ou produzem alimento. Escassez real pode deixar um soldado com reserva zero e causar morte; remover a ação de coleta não deve inventar comida nem mascarar falha de suprimento.

No código atual, soldados em paz podem receber ração do tesouro/comunidade quando chegam à guarnição, mas a política de sobrevivência crítica ainda escolhia `forage` quando não havia ração e existia alimento visível. Essa precedência desviava militar de sua função e permitia colher campo/arbusto como se fosse um morador. A regra passa a excluir soldados das rotas de emergência `forage` e `hunt`. A reposição disponível continua sendo finita e contabilizada pela rotina de guarnição; sem suprimento, a pessoa não recebe alimento implícito.

Quando a ração da guarnição não cobre o buffer militar, o soldado pode usar sua carteira real para comprar a quantidade faltante do estoque finito do mercado do reino. A transação reutiliza `buyMilitaryMeal` e o ledger existente: ouro sai da carteira, comida sai do mercado e entra na reserva pessoal. Não coleta nem debita o estoque civil. Esta compra militar é uma provisão econômica do mercado abstrato do reino, não um novo comportamento de deslocamento até a construção física do mercado; JUL-201/JUL-202 ainda precisam fechar o comércio de excedentes dos moradores, acesso físico e demais métricas de compra/venda.

## Alternativas

* Reduzir a necessidade diária militar ou restaurar reserva automaticamente: rejeitado porque cria disponibilidade ou oculta escassez.
* Permitir que soldados trabalhem no campo durante fome crítica: rejeitado conforme o pedido do jogador; mistura serviço militar e coleta civil.
* Restaurar automaticamente a reserva do soldado ou emitir comida sem débito: rejeitado porque oculta escassez.
* Permitir coleta civil por soldados: rejeitado conforme o pedido do jogador; mistura serviço militar e trabalho civil.
* Comprar apenas o que o saldo real permite depois de usar a ração acessível da guarnição: escolhido; estoque de mercado ou carteira vazios ainda podem resultar em fome e morte.

## Pesquisa e limite

* SciSpace encontrou O'Connor, “Why Markets? The Provisioning of Classical Greek Military Forces on the Move through Friendly, Allied, and Neutral Territory” (2022, DOI [10.1515/klio-2021-0058](https://doi.org/10.1515/klio-2021-0058)), e Murgatroyd & Gaffney, “Calm before the storm? Modelling military supply and movement” (2014). Os trabalhos tratam aquisição/provisão como parte da logística e do movimento militar. São contexto qualitativo, não calibração para salário, ração ou sobrevivência deste jogo.
* A cota do Consensus continua esgotada até o reset informado em 01/11/2026. A limitação já está registrada na decisão arquitetural JUL-195.
* Game Studio orienta manter a regra no domínio da simulação atual; esta fatia não muda renderização nem stack e a prova apropriada é a decisão de ação mais o replay do Worker.

## Validação

* O teste anterior provava a regressão: soldado com reserva zero, sem estoque de guarnição/comunidade e alimento visível escolhia `forage`.
* `tests/food-survival.test.mjs` prova que sem guarnição, carteira ou mercado o soldado não coleta comida civil nem recebe alimento; o teste de retorno à guarnição abastecida continua cobrindo o ressuprimento válido.
* Novo teste prova compra de uma quantidade limitada por carteira e estoque, com débito do ouro e do mercado e crédito na reserva, sem coleta civil.
* A matriz longa foi executada no SHA `e94d1b768c1d739d009920939274b60f52a94809`: seeds 1/42/987/2026 por 730 dias, mais repetição da seed 42. A repetição verificou igualdade completa do estado e crônica (`determinismDiff: []`).

## Decisão sobre compra de refeição militar — 27/10/2026

**Achado no código vigente:** `buyMilitaryMeal` já debita a carteira militar e o mercado e credita a reserva do soldado, mas `updatePeopleCore` fixava `purchasedRation = 0` para todo soldado em paz. A ração era tentada da guarnição, porém um saldo zero deixava o soldado sem usar salário mesmo quando havia ouro e alimento comprável. No replay pós-política de não-coleta em `0d12418`, as mortes humanas por fome observadas na seed 42 eram todas de soldados; a mudança de comportamento civil, isoladamente, não fechou a provisão.

**Decisão:** primeiro debitar a ração finita disponível da guarnição. Depois, se o buffer militar continuar abaixo de 55 pontos de reserva, tentar a compra pelo mercado existente usando somente a carteira do próprio soldado e o estoque real. O contrato de `buyMilitaryMeal` já limita quantidade por dinheiro, mercado e capacidade pessoal e registra a troca; a coleta por forrageio/caça continua proibida para o soldado em paz. Nenhuma comida ou ouro é criado. Se ambos os canais estiverem vazios, reserva zero, fome e morte continuam resultados válidos.

**Resultado do replay:** relatório completo em [`docs/verification/JUL-178-soldier-market-ration-730-20261027.json`](../verification/JUL-178-soldier-market-ration-730-20261027.json), calculado a partir do commit acima. Comparado ao replay anterior sem compra de ração militar (`0d124181ef0e792d9a513dad21e393f06a794e8d`, [`docs/verification/JUL-178-food-soldier-no-forage-730-20261027.json`](../verification/JUL-178-food-soldier-no-forage-730-20261027.json)), mortes humanas por fome nas quatro seeds caíram de 47 para 32 (12→7, 14→6, 10→10 e 11→9). Adulto-dias com reserva abaixo de 20 caíram de 123.097 para 91.596. São comparações observacionais pareadas; a seed 987 não reduziu mortes por fome.

O ledger registrou 209 compras de refeição militar nas quatro seeds, movimentando aproximadamente 434 unidades de comida e 401,85 de ouro das carteiras para os mercados. A repetição da seed 42 repetiu exatamente suas 67 compras. Os testes de auditoria não encontraram saldo negativo e a cobertura do ledger ficou completa. Mesmo assim, restaram 32 mortes humanas por fome e os mercados terminaram sem comida nas quatro seeds; reservas baixas continuaram altas. Colheitas cultivadas registradas foram 17.562, 29.353, 16.746 e 15.921 unidades, mas uma das duas roças não estava concluída em três das quatro seeds. Portanto, esta correção melhora a provisão dos soldados e confirma uso real de salário, mas **não demonstra suficiência alimentar** nem o alvo de 50 pessoas.

**Pendências:** testar choques de estoque/carteira e continuar a auditoria de acesso, entrega, conservação e produção líquida em JUL-178. A compra usada aqui continua sendo serviço abstrato do mercado do reino: não prova proximidade/rota até a construção `mercado`; esta lacuna pertence ao comércio físico de JUL-201/JUL-202.
