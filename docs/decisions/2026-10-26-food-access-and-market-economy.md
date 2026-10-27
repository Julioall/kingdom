# Decisão — acesso à comida e economia circulante

Data: 26/10/2026
Estado: direção proposta e registrada; não implementada
Issues: JUL-178, JUL-201, JUL-202 e JUL-203

## Relatos do jogador

O jogador observou que alimento da roça pode acumular enquanto falta comida disponível no reino, que ovelhas e roça deixam de ser usadas mesmo quando estão disponíveis e que o mercado quase não participa da economia. Também anotou valores diferentes na leitura da comida do abrigo e do castelo (14,41 contra 14,31), cuja relação ainda precisa ser reconciliada.

Como direção, propôs que peões vendam suas coletas de pedra, troncos e comida cultivada, recebam ouro e comprem comida e outros insumos. O tesouro do rei deveria depender de ouro de impostos, com aumento de taxa durante guerras. Soldados receberiam soldo e comprariam no mercado; um peão poderia escolher alistar-se quando houvesse vaga.

Os relatos de acumulação na roça e pouco uso do mercado ainda não vieram com seed, dia ou SHA. Devem ser reproduzidos antes de atribuir causa. A observação da diferença entre abrigo e castelo também segue como hipótese.

## O que o código atual mostra

- A métrica global de comida soma alimento e carne dos tesouros, mercados de cada reino, estoques comunitários e do mercado geral. Não soma biomassa na roça nem reservas pessoais. O mercado geral é incluído no total global, mas um reino negocia com o seu próprio mercado; assim, um total alto pode incluir estoque que aquele reino não consegue comprar.
- O resumo de um reino conta seu tesouro, mercado local e estoque comunitário. “Com pouca comida” conta moradores com reserva pessoal abaixo de 30 pontos; esses pontos de reserva não são unidades de estoque.
- Na roça, “Disponível para colher” mede biomassa ainda no campo. “Colheita acumulada” é um total histórico desde o plantio. Nenhum dos valores significa, por si só, comida armazenada ou acessível à pessoa faminta.
- O abrigo mostra o campo fruitStored como localização/subregistro de parte do alimento que também entra no saldo comunitário. Esse campo não deve ser somado como uma segunda cópia consumível.
- Cada reino começa com tesouro amplo: 9.000 ouro, 4.800 comida, 1.200 madeira, 700 pedra e 180 ração. Seu mercado local recebe um saldo inicial finito, incluindo 42 comida e 18 ouro. O mercado geral começa separado, com seus próprios bens e ouro.
- A troca do peão usa o saldo comunitário para comerciar em nome do grupo. O peão comum não recebe em carteira pessoal o valor de sua coleta; o soldado já possui carteira, recebe soldo do tesouro e pode comprar refeição no mercado.
- As taxas atuais são cobradas a cada 30 dias sobre excedentes comunitários de comida, madeira, pedra, ração e ouro. A taxa inicial é 7,5%, com teto de 25%; a taxa não aumenta automaticamente em guerra.

Em observação de interface no playtest local (seed 42, dia 214), o HUD global mostrava 150,7 de comida; Valedouro mostrava 19,25 unidades em seus estoques e 34 de 48 pessoas abaixo do limiar de reserva. A captura não foi salva. Isso ilustra a diferença entre total agregado e acesso por reino, mas não substitui reprodução em replay nem comprova que a roça estivesse acumulando nesse instante.

## Direção recomendada

Tratar produção, acesso, dinheiro e governo como uma cadeia de contas com dono e destino, sem criar recursos para esconder gargalos:

1. **Auditar primeiro (JUL-178).** Reproduzir o relato e seguir a comida da planta ao consumo: biomassa pronta, colheita efetiva, carga, estoque comunitário, mercado local, tesouro, reserva pessoal, distância, rota e morte por causa. Fechar também a diferença de leitura do abrigo.
2. **Trocar bens pessoais (JUL-201).** Depois da auditoria, permitir que um peão venda apenas carga realmente existente e receba ouro finito na própria carteira. Compras debitam essa carteira e transferem mercadoria existente do mercado para a pessoa. Vendas e compras respeitam reino, rota, proximidade, liquidez, estoque e preço; cada transação fecha no ledger.
3. **Proteger o ciclo de alimento.** A roça permanece propriedade produtiva do assentamento até a colheita. Custos de sementes, carga e uma reserva de subsistência devem ser mantidos antes de vender produção. O abrigo identifica onde está a parte do saldo comunitário, sem duplicar o total. Não se garante que todos sobrevivam: fome e morte continuam possíveis se houver escassez real, mas não devem ser mascaradas por contagem global ou falha de entrega.
4. **Financiar o governo com ouro (JUL-202).** Depois de estabilizar as trocas, tributar recebimentos econômicos reais em ouro, uma única vez e com pagador, base, taxa e beneficiário explícitos. Não retirar alimento, sementes, madeira, pedra ou ração como imposto em espécie. O rei compra bens públicos por transações financiadas com o saldo do tesouro.
5. **Alistamento como carreira voluntária (JUL-203).** Com vaga e edifício operacional, um residente elegível pode aceitar ou recusar uma oferta explícita. A oferta usa o contrato de soldo existente; não cria moeda, não remove soldados ativos e não altera automaticamente os pesos da rede.

O capital inicial precisa ser tratado à parte da receita recorrente: nenhuma economia começa com mercado solvente se todo o ouro for removido do tesouro sem destino. A migração deve distribuir ou declarar um saldo de abertura finito para mercados e carteiras e então medir sua circulação. Não assumir que esse saldo é imposto nem repor dinheiro ou estoque de forma automática.

O imposto de guerra deve existir somente durante guerra ativa, terminar com paz/armistício e respeitar um teto transparente. Não escolher agora a sobretaxa exata: o sistema atual já coleta tributos em espécie e mantém saldos iniciais muito altos; alterar tudo de uma vez pode interromper soldo, obras e segurança alimentar. A taxa e o saldo inicial serão calibrados por replays pareados.

## Alternativas consideradas

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Aumentar regrowth, biomassa ou carne para corrigir qualquer fome | Rejeitada | Produção potencial não prova colheita, transporte, posse nem acesso. A ecologia fica no mínimo necessário; estações seguem como troca visual de tiles. |
| Reabastecer mercados ou carteiras automaticamente quando zerarem | Rejeitada | Criaria comida/ouro sem origem e impediria medir liquidez, custo e escassez. |
| Liberar o mercado geral para qualquer reino e tratar o estoque como universalmente acessível | Rejeitada | Ocultaria distância, fronteira e propriedade local. O resumo deve distinguir total físico de estoque comprável por reino. |
| Zerar já o tesouro e todo o suprimento de abertura | Adiada | O estado inicial sustenta salário, construção e reservas. Primeiro deve haver uma transferência finita para o novo circuito e uma validação pareada. |
| Usar o comércio atual do estoque comunitário como se fosse renda do coletor | Rejeitada | A conta transacionada é do grupo; ela não remunera nem dá poder de compra ao peão que carregou o material. |
| Evitar todas as mortes por fome | Rejeitada | A mortalidade é um resultado legítimo de escassez. O objetivo é separar escassez real de falhas de política, logística, propriedade e medição. |

## Evidência e fontes

- Código consultado em HEAD c2a9e05; o worktree também contém alterações locais não relacionadas de JUL-173, que foram preservadas.
- Snapshot visual anterior de seed 42/dia 214: HUD global 150,7; reino Valedouro 19,25; 34/48 moradores com reserva abaixo de 30. A captura não está arquivada, então este é um apontamento exploratório, não um artefato de aceite.
- O relato de campo/mercado segue pendente de seed, dia, SHA e trace reproduzível; está registrado em JUL-178.
- SciSpace encontrou Cockburn et al. (2013), [“Simulating Social and Economic Specialization in Small-Scale Agricultural Societies”](https://doi.org/10.18564/jasss.2308), JASSS 16(4). O estudo liga escolha de tarefas à situação econômica, necessidades familiares, troca e experiências. Ele demonstra uma possibilidade de modelagem em um caso histórico, não calibra preços ou taxas para Kingdom.
- SciSpace encontrou Ewert, Roehl e Uhrmacher (2007), [“Hunger and Market Dynamics in Pre-modern Communities”](https://doi.org/10.12759/HSR.32.2007.4.122-150), Historical Social Research 32(4), 122–150. O modelo discute políticas de intervenção durante falta de alimentos e ressalta que o efeito depende de desenho e objetivo. Não demonstra qual taxa de guerra ou estoque inicial é adequado aqui.
- As páginas dos artigos foram verificadas nas publicações primárias: [JASSS](https://jasss.soc.surrey.ac.uk/16/4/4.html) e [arquivo da HSR/GESIS](https://www.gesis.org/en/hsr/full-text-archive/issues-1978-2009/2007/324-new-political-economy).
- Consensus está sem cota mensal de busca até 01/11/2026. O campo de contexto do Linear falha com “Tool get_agent_context not found”; usei issues, código, relatórios locais e SciSpace.

## Sequência e verificação futura

- JUL-178: reproduzir os relatos e fechar conservação, acesso e causas. Não ampliar ecologia.
- JUL-201: implementar primeiro o ciclo pessoal de venda/compra após a auditoria.
- JUL-202: só então alterar impostos e orçamento do tesouro; depende da liquidez e do ledger de JUL-201.
- JUL-200 e JUL-203: validar fontes/capacidade de recrutamento e permitir alistamento voluntário.

Para cada fatia de gameplay, comparar o antes e depois em seeds 1, 42, 987 e 2026 por 253, 365 e 730 dias, mais choques controlados. Medir estoques por dono e localização, colheita e transporte, adultos-dia com pouca comida, mortes por causa, transações por bloqueio, saldos/preços, imposto, folha/atrasos, satisfação e determinismo. O indicador principal não será “todos vivos”: será fluxo conservativo, acesso local identificável e decisões com consequências observáveis.

Esta revisão apenas registra a proposta e a sua ordem. Não altera código ou balanceamento de gameplay.
