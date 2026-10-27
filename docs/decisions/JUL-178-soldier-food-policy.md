# JUL-178 — provisão militar separada da coleta civil

Data: 27/10/2026
Estado: política de ação implementada; replay multissemente no SHA atual pendente.
Issue: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-caca-civis)

## Relato e decisão

O jogador observou soldados procurando alimento e pediu que eles não façam coleta civil. O soldado deve consumir ração atribuída ao serviço, enquanto moradores civis procuram ou produzem alimento. Escassez real pode deixar um soldado com reserva zero e causar morte; remover a ação de coleta não deve inventar comida nem mascarar falha de suprimento.

No código atual, soldados em paz podem receber ração do tesouro/comunidade quando chegam à guarnição, mas a política de sobrevivência crítica ainda escolhia `forage` quando não havia ração e existia alimento visível. Essa precedência desviava militar de sua função e permitia colher campo/arbusto como se fosse um morador. A regra passa a excluir soldados das rotas de emergência `forage` e `hunt`. A reposição disponível continua sendo finita e contabilizada pela rotina de guarnição; sem suprimento, a pessoa não recebe alimento implícito.

As compras com salário e o financiamento do reino continuam nas dependências JUL-201/JUL-202. Esta alteração não declara a folha militar satisfeita: os testes de provisão observam a reserva existente e a política de campo, não a futura economia de soldos.

## Alternativas

* Reduzir a necessidade diária militar ou restaurar reserva automaticamente: rejeitado porque cria disponibilidade ou oculta escassez.
* Permitir que soldados trabalhem no campo durante fome crítica: rejeitado conforme o pedido do jogador; mistura serviço militar e coleta civil.
* Usar somente a ração finita já presente na guarnição e deixar a falta de suprimento observável: escolhido para esta fatia; mortes por fome continuam possíveis e serão avaliadas nos replays.

## Pesquisa e limite

* SciSpace encontrou O'Connor, “Why Markets? The Provisioning of Classical Greek Military Forces on the Move through Friendly, Allied, and Neutral Territory” (2022, DOI [10.1515/klio-2021-0058](https://doi.org/10.1515/klio-2021-0058)), e Murgatroyd & Gaffney, “Calm before the storm? Modelling military supply and movement” (2014). Os trabalhos tratam aquisição/provisão como parte da logística e do movimento militar. São contexto qualitativo, não calibração para salário, ração ou sobrevivência deste jogo.
* A cota do Consensus continua esgotada até o reset informado em 01/11/2026. A limitação já está registrada na decisão arquitetural JUL-195.
* Game Studio orienta manter a regra no domínio da simulação atual; esta fatia não muda renderização nem stack e a prova apropriada é a decisão de ação mais o replay do Worker.

## Validação

* O teste anterior provava a regressão: soldado com reserva zero, sem estoque de guarnição/comunidade e alimento visível escolhia `forage`.
* Após a mudança, `tests/food-survival.test.mjs` deve provar que ele não colhe a fonte civil e mantém reserva zero; o teste de retorno à guarnição abastecida permanece para proteger o caso válido.
* Registrar aqui e em JUL-178 os resultados de testes e replays no SHA do commit. A matriz longa deve separar mortes humanas por fome, mortes militares e adulto-dias sob reserva baixa.
