# Decisão — acesso à comida e economia circulante

Revisão: 27/10/2026
Estado: direção amadurecida e registrada; não implementada
Issues: JUL-178, JUL-201, JUL-202 e JUL-203

## Relatos do jogador

Em 27/10/2026, o jogador voltou a relatar que comida da roça acumula enquanto falta comida no reino e que o mercado quase não é usado. Nos relatos anteriores, também percebeu roça e ovelhas disponíveis sem serem usadas pela população. Observou ainda diferença entre as leituras de comida do abrigo e do castelo (14,41 contra 14,31), cuja relação precisa ser reconciliada.

Como direção, propôs que peões vendam suas coletas de pedra, troncos e comida cultivada, recebam ouro e comprem comida e outros insumos. O tesouro do rei deveria depender de ouro de impostos, com aumento de taxa durante guerras. Soldados receberiam soldo e comprariam no mercado; um peão poderia escolher alistar-se quando houvesse vaga.

Esses relatos são evidência de observação do jogador, mas ainda não vieram com seed, dia, SHA ou captura vinculada. Devem ser reproduzidos antes de atribuir causa. “Comida acumulada na roça” pode significar biomassa pronta, colheita histórica ou alimento em estoque; essa distinção será registrada durante a reprodução. A diferença entre abrigo e castelo continua sendo uma hipótese de contabilidade, não uma duplicação confirmada.

## O que o código atual mostra — verificado em `46494ce`

- A métrica global de comida soma alimento e carne dos tesouros, mercados de cada reino, estoques comunitários e do mercado geral. Não soma biomassa na roça nem reservas pessoais. O mercado geral é incluído no total global, mas um reino negocia com o seu próprio mercado; assim, um total alto pode incluir estoque que aquele reino não consegue comprar.
- O resumo de um reino conta seu tesouro, mercado local e estoque comunitário. “Com pouca comida” conta moradores com reserva pessoal abaixo de 30 pontos; esses pontos de reserva não são unidades de estoque.
- Na roça, “Disponível para colher” mede biomassa ainda no campo. “Colheita acumulada” é um total histórico desde o plantio. Nenhum dos valores significa, por si só, comida armazenada ou acessível à pessoa faminta.
- O abrigo mostra o campo fruitStored como localização/subregistro de parte do alimento que também entra no saldo comunitário. Esse campo não deve ser somado como uma segunda cópia consumível.
- Cada reino começa com tesouro amplo: 9.000 ouro, 4.800 comida, 1.200 madeira, 700 pedra e 180 ração. Seu mercado local recebe um saldo inicial finito, incluindo 42 comida e 18 ouro. O mercado geral começa separado, com seus próprios bens e ouro.
- A troca do peão usa o saldo comunitário para comerciar em nome do grupo. O peão comum não recebe em carteira pessoal o valor de sua coleta; o soldado já possui carteira, recebe soldo do tesouro e pode comprar refeição no mercado.
- A oportunidade de troca é condicional: a estratégia do reino pede alimento quando a reserva comum cai e há estoque/contrapartida suficiente; `performTrade` troca os saldos comunitários por lotes discretos. Isso não constitui ainda um mercado pessoal contínuo de compra e venda para quem coletou.
- As taxas atuais são cobradas a cada 30 dias sobre excedentes comunitários de comida, madeira, pedra, ração e ouro. A taxa inicial é 7,5%, com teto de 25%; a taxa não aumenta automaticamente em guerra.

Em observação de interface no playtest local (seed 42, dia 214), o HUD global mostrava 150,7 de comida; Valedouro mostrava 19,25 unidades em seus estoques e 34 de 48 pessoas abaixo do limiar de reserva. A captura não foi salva. Isso ilustra a diferença entre total agregado e acesso por reino, mas não substitui reprodução em replay nem comprova que a roça estivesse acumulando nesse instante.

## Direção recomendada

Tratar produção, acesso, dinheiro e governo como uma cadeia de contas com dono e destino, sem criar recursos para esconder gargalos:

1. **Auditar primeiro (JUL-178).** Reproduzir o relato e seguir a comida da planta ao consumo: biomassa pronta, colheita efetiva, carga, estoque comunitário, mercado local, tesouro, reserva pessoal, distância, rota e morte por causa. Fechar também a diferença de leitura do abrigo.
2. **Trocar bens pessoais (JUL-201).** Depois da auditoria, permitir que um peão venda apenas carga realmente existente e receba ouro finito na própria carteira. Compras debitam essa carteira e transferem mercadoria existente do mercado para a pessoa. Vendas e compras respeitam reino, rota, proximidade, liquidez, estoque e preço; cada transação fecha no ledger.
3. **Proteger o ciclo de alimento.** A roça permanece propriedade produtiva do assentamento até a colheita. Custos de sementes, carga e uma reserva de subsistência devem ser mantidos antes de vender produção. O abrigo identifica onde está a parte do saldo comunitário, sem duplicar o total. Não se garante que todos sobrevivam: fome e morte continuam possíveis se houver escassez real, mas não devem ser mascaradas por contagem global ou falha de entrega.
4. **Financiar o governo com ouro (JUL-202).** Depois de estabilizar as trocas, tributar recebimentos econômicos reais em ouro, uma única vez e com pagador, base, taxa e beneficiário explícitos. Não retirar alimento, sementes, madeira, pedra ou ração como imposto em espécie. O rei compra bens públicos por transações financiadas com o saldo do tesouro.
5. **Alistamento como carreira voluntária (JUL-203).** Com vaga e edifício operacional, um residente elegível pode aceitar ou recusar uma oferta explícita. A oferta usa o contrato de soldo existente; não cria moeda, não remove soldados ativos e não altera automaticamente os pesos da rede.

### Ciclo econômico-alvo

| Ator ou lugar | Fluxo proposto | Regra de propriedade |
| --- | --- | --- |
| Roça e rebanho | Trabalho transforma biomassa/animal em alimento ou carne; a entrega abastece o mercado local ou o estoque comunitário. | Biomassa pronta, colheita histórica, carga, estoque e reserva pessoal são contas diferentes. Sementes e ração ficam protegidas conforme contrato; carne só aparece após abate rastreado. |
| Peão | Executa tarefa útil e entrega pedra, madeira ou colheita real; vende carga e recebe ouro em carteira; compra comida/bens existentes quando preço, rota e saldo permitem. | Não recebe dinheiro por uma tarefa sem entrega. A carteira e a carga pessoal não são o tesouro comunitário. Trabalho e compra são escolhas sujeitas às necessidades, oportunidades e restrições percebidas pelo agente. |
| Mercado local | Compra produtos com caixa finito, mantém o que recebeu em estoque e vende bens já disponíveis. Preço responde a estoque/demanda dentro de limites explícitos. | Cada venda move mercadoria para o mercado e ouro para o vendedor; cada compra faz o inverso. Mercado geral e mercados de reinos não são fungíveis sem uma transação de transporte. |
| Soldado | Recebe soldo do tesouro na periodicidade existente e compra alimento com sua carteira no mercado. | O soldo reduz o tesouro e aumenta a carteira uma vez; a compra reduz carteira e estoque do mercado e aumenta a reserva pessoal do soldado. Soldos em atraso e indisponibilidade de alimento devem continuar visíveis. |
| Tesouro e rei | Recebem imposto monetário de uma base explicitamente definida; pagam soldos e compram bens públicos usando apenas ouro disponível. | No estado-alvo, madeira, pedra, comida e ração não entram como renda tributária em espécie nem podem ser gastos como reserva real ilimitada do rei. Estoque físico inicial exige uma transição finita e auditável. |

A ordem é importante: a roça não deve vender “colheita acumulada” como se fosse estoque. A colheita primeiro vira carga/estoque por uma ação concluída; depois uma transação transfere a mercadoria. A população pode continuar passando fome se não trabalhar, se não tiver saldo, se a rota falhar ou se o mercado não tiver oferta. Isso preserva mortalidade por escassez real, mas torna visível quando a causa é oferta, logística, preço ou escolha.

O mercado precisa de uma reserva inicial de ouro e mercadorias finita para começar a operar. A abertura atual transfere apenas 18 moedas para cada mercado local enquanto mantém um tesouro de 9.000 moedas e grandes estoques em espécie. A migração para a economia monetária deve tratar esses saldos como capital de abertura declarado: alocar caixa para mercado e/ou moradores uma única vez; depois, medir a circulação e financiar a coroa com impostos. Não zerar o tesouro sem financiar contratos já ativos, nem repor caixa ou produtos quando esgotarem.

Para não tributar a mesma moeda duas vezes, a próxima decisão de implementação deve escolher uma base: recebimento por venda, renda/soldo ou outra receita observável. A cobrança registra pagador, valor bruto, taxa, imposto, valor líquido e beneficiário em uma única entrada do ledger. Impostos de guerra só valem durante guerra ativa e têm teto; o percentual, a base e o saldo de abertura ficam para replays pareados, não são calibrados por intuição nesta decisão.

O mercado “quase não usado” não deve ser corrigido aumentando artificialmente o contador de trocas. Medir oportunidades, tentativas, transações concluídas e cada motivo de bloqueio: preço, estoque, caixa, excedente protegido, rota, distância ou falta de demanda. A interface deve mostrar alimento no campo, colhido, carregado, comunitário, no mercado, no tesouro e em reservas pessoais; reportar também o que é realmente comprável para cada reino.

### Medidas de sucesso e limites

- Conservação: estoque e carteira por dono/local, entradas/saídas do ledger, colheita, entregas, abates, compras, vendas e impostos; nenhum saldo negativo ou criação implícita.
- Acesso alimentar: dias de pouca reserva, distância e rota até alimento, motivo de coleta/compra não concluída e mortes por causa. Não exigir que todos sobrevivam.
- Economia: negócios tentados/concluídos/bloqueados, liquidez de cada mercado, preços, ouro em carteiras/mercados/tesouros, salário pago/atrasado e compras públicas.
- Comportamento: ações econômicas por perfil e necessidade, oportunidade recusada, duração de trabalho/viagem e determinismo em seeds repetidas. A rede decide sob observações disponíveis; o motor ainda valida toda transação.

O primeiro aceite não é “a fome zerou” nem “o mercado ficou sempre ativo”. É provar que o fluxo fecha, que a comida disponível pode chegar a quem a compra/colhe, e que cada bloqueio e morte tem uma causa auditável. Só depois se ajustam preços, taxas, salários e produção.

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

- Código conferido no branch `test/kingdom-autonomous`, HEAD `46494ce318499a6a2173bbefac52ee8b58ca4675`. As afirmações acima descrevem o código desse SHA; os relatos novos do jogador ainda não têm replay/captura.
- Snapshot visual anterior de seed 42/dia 214: HUD global 150,7; reino Valedouro 19,25; 34/48 moradores com reserva abaixo de 30. A captura não está arquivada, então este é um apontamento exploratório, não um artefato de aceite.
- O relato de campo/mercado segue pendente de seed, dia, SHA e trace reproduzível; está registrado em JUL-178.
- Atualização do jogador de 27/10/2026: “a comida da roça estava acumulando enquanto no geral não havia comida, o mercado quase não é usado”. Registrada como relato pendente de reprodução em JUL-178 e como requisito de desenho em JUL-201; não foi afirmado que o código reproduz esse estado neste SHA.
- SciSpace encontrou Cockburn et al. (2013), [“Simulating Social and Economic Specialization in Small-Scale Agricultural Societies”](https://doi.org/10.18564/jasss.2308), JASSS 16(4). O estudo liga escolha de tarefas à situação econômica, necessidades familiares, troca e experiências. Ele demonstra uma possibilidade de modelagem em um caso histórico, não calibra preços ou taxas para Kingdom.
- SciSpace encontrou Ewert, Roehl e Uhrmacher (2007), [“Hunger and Market Dynamics in Pre-modern Communities”](https://doi.org/10.12759/HSR.32.2007.4.122-150), Historical Social Research 32(4), 122–150. O modelo discute políticas de intervenção durante falta de alimentos e ressalta que o efeito depende de desenho e objetivo. Não demonstra qual taxa de guerra ou estoque inicial é adequado aqui.
- As páginas dos artigos foram verificadas nas publicações primárias: [JASSS](https://jasss.soc.surrey.ac.uk/16/4/4.html) e [arquivo da HSR/GESIS](https://www.gesis.org/en/hsr/full-text-archive/issues-1978-2009/2007/324-new-political-economy).
- Nova consulta SciSpace em 27/10/2026 recuperou novamente Cockburn et al.; seu modelo decide alocação de tarefas com base em situação econômica, troca, demanda, competição, necessidades familiares e experiências. A inferência aplicada ao Kingdom é testar decisões econômicas condicionadas a necessidade e oportunidade; o artigo não valida a arquitetura neural atual nem fornece preços, salários ou taxas.
- Consensus está sem cota mensal de busca até 01/11/2026. O campo de contexto do Linear falha com “Tool get_agent_context not found”; usei issues, código, relatórios locais e SciSpace.

## Sequência e verificação futura

- JUL-178: reproduzir os relatos e fechar conservação, acesso e causas. Não ampliar ecologia.
- JUL-201: implementar primeiro o ciclo pessoal de venda/compra após a auditoria.
- JUL-202: só então alterar impostos e orçamento do tesouro; depende da liquidez e do ledger de JUL-201.
- JUL-200 e JUL-203: validar fontes/capacidade de recrutamento e permitir alistamento voluntário.

Para cada fatia de gameplay, comparar o antes e depois em seeds 1, 42, 987 e 2026 por 253, 365 e 730 dias, mais choques controlados. Medir estoques por dono e localização, colheita e transporte, adultos-dia com pouca comida, mortes por causa, transações por bloqueio, saldos/preços, imposto, folha/atrasos, satisfação e determinismo. O indicador principal não será “todos vivos”: será fluxo conservativo, acesso local identificável e decisões com consequências observáveis.

Esta revisão apenas registra a proposta e a sua ordem. Não altera código ou balanceamento de gameplay.
