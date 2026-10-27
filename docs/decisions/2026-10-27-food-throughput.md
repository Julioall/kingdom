# Decisão — produção e coleta da roça

## Contexto e evidência

A linha de base foi medida no SHA `ad0f778d7f7c665b832050176976887df7c1acb9`, por 365 dias nas seeds 1 e 42, com `npm run audit:food -- --days 365 --seeds 1,42`. O relatório completo está em `docs/verification/JUL-178-pre-batch-365-20261027.json`.

| Seed | Roças completas | Raiz colhida | Regeneração cultivada | Raiz ainda em pé | Estoque comunitário final | Adulto-dias com reserva abaixo de 20 | Mortes humanas por fome |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 (33 células, concluída no dia 130) | 3.543,04 | 7.375,27 | 3.840,23 | 0 | 10.310 | 1 |
| 42 | 2 (24 e 32 células, concluídas nos dias 126 e 115) | 5.861,96 | 12.357,82 | 6.511,86 | 1,71 | 10.563 | 1 |

Os relatórios mostram biomassa colhida e regenerada, mas o estoque final e as reservas humanas continuam baixos. O total histórico colhido ou a biomassa em pé não prova que o alimento ficou acessível no momento da refeição. A conversão atual é `0,72` ponto de reserva por unidade de alimento; 50 adultos precisam de `39` pontos ou cerca de `54,17` unidades por dia.

Os replays pós-mudança ainda **não demonstram melhora suficiente**. No SHA `43db0047e19f595d1d8a677b9b1aeb5908c400b1`, seeds 1/42 colheram 3.011,95/3.030,19, com 5.460,02/9.540,17 em pé, estoque final zero nas duas, 10.540/12.187 adultos-dias abaixo de 20 e 3/1 mortes humanas por fome. No SHA `fd27fd9247bda8e1097f15a4cfef28b4548b92ab`, a seed 1 ao dia 250 tinha 1.374 unidades colhidas, 5.399 em pé, estoque comunitário zero e uma ordem de colheita e uma de entrega ativas; a governança reavalia o grupo a cada 8 dias. O lote maior isolado não superou o ritmo de novas ordens. Os relatórios completos são `docs/verification/JUL-178-post-batch-365-20261027.json` e `docs/verification/JUL-178-field-delivery-365-20261027.json`; os pontos diários estão em `docs/verification/JUL-178-field-assignment-trace-seed1-250-20261027.json`. A hipótese atual é manter cada delegação de roça ativa até a reserva comum atingir 2 unidades por morador; o lote maior e três trabalhadores calculados por demanda devem completar esse ciclo em menos dias sem criar outra ordem para um trabalhador já ativo. O crescimento 3× permanece experimental até novo replay.

## Escolha

1. Uma colheita delegada da roça pode retirar até a capacidade de carga comunitária, 24 unidades por ação. Coletas de frutos silvestres mantêm o limite por habilidade atual.
2. A capacidade urgente de trabalhadores usa o lote da roça. Para 49, 50 e 51 adultos, três lotes de 24 cobrem a necessidade diária de reserva no limite da carga (`51,84` pontos contra `38,22`, `39` e `39,78`). O campo ainda precisa produzir e estar alcançável para essa capacidade nominal valer.
3. Uma ordem de campo permanece ativa enquanto o estoque acessível não atingir 2 unidades por morador. O trabalhador entrega cargas sucessivas sob a mesma delegação; a capacidade de 24 e três trabalhadores para 49–51 moradores reduzem as rodadas necessárias. Trabalhadores já designados são excluídos da seleção para novas delegações.
4. O crescimento médio anual da raiz cultivada passa de `5,625` para `16,875` (3×), restrito à planta do talhão. O crescimento não varia por estação; não foram adicionados biomas nem mecânicas sazonais. O fator 3× é uma calibração experimental: na seed 1, o campo ativo regenerou cerca de 31,4 unidades por dia; na seed 42, os dois campos juntos regeneraram cerca de 51,5 unidades por dia. A suficiência líquida continua pendente de replay pós-mudança.

## Alternativas consideradas

- Aumentar somente o lote de coleta: rejeitado como resposta completa; os dados mostram que a produção e a coleta permanecem limitadas pelo crescimento e pela logística.
- Injetar alimento do mercado ou tesouro: rejeitado como substituto da produção; isso esconderia a falta de produção e depende de saldos finitos já tratados em JUL-201.
- Aumentar o crescimento de toda a vegetação ou adicionar estações ecológicas: rejeitado; o ajuste fica somente no cultivo e respeita o escopo ecológico mínimo.

## Pesquisa e limites

SciSpace encontrou o estudo de van Voorn, Hengeveld e Verhagen, *An agent based model representation to assess resilience and efficiency of food supply chains* (2020, PLOS ONE, [DOI 10.1371/journal.pone.0242323](https://doi.org/10.1371/journal.pone.0242323)). O estudo mede a fração da produção entregue e o atendimento da necessidade de consumidores; isso apoia usar alimento efetivamente entregue e reservas como métricas, em vez de contar apenas biomassa. Não fornece parâmetros para este jogo. SciSpace também retornou uma revisão de 2026 sobre modelos multiagente de sistemas mistos de lavoura e rebanho ([DOI 10.3389/fsufs.2026.1674409](https://doi.org/10.3389/fsufs.2026.1674409)); seu resumo destaca realismo comportamental e mecanismos de feedback, sem recomendar valores de rendimento. Consensus recusou novas buscas por limite mensal, com reset informado para 01/11/2026. O conector Linear também falhou ao solicitar as notas de contexto (`get_agent_context` não encontrado).

Game Studio recomenda manter simulação e renderização separadas; esta alteração é somente de simulação e não muda a apresentação, então não exige captura visual. O teste do jogo nesta fatia será o replay determinístico com contabilidade de alimento.

## Validação e pendências

- Testes unitários cobrem conservação do lote de 24, persistência e conclusão da ordem ao atingir a reserva alvo, ausência de delegação duplicada para peão ativo e capacidade para populações 49/50/51.
- No SHA `c3726204a9c38cd1d3b36848d11cec4c672aa2aa`, replays de 365 dias nas seeds 1/42 tiveram zero mortes humanas por fome e reduziram adultos-dias com reserva abaixo de 20 de 10.310/10.563 para 6.877/6.416. A colheita cultivada subiu de 3.543/5.862 para 6.449/10.876; o estoque final subiu de 0/1,71 para 84,29/16,08. Relatório: `docs/verification/JUL-178-refill-target-365-20261027.json`.
- Isso é uma melhora, mas não atende a capacidade de 50: os campos medidos produziram aproximadamente 22–27 unidades/dia por roça depois de concluídos, contra 54,17 unidades/dia para 50 adultos. A produção de carne doméstica foi zero nos dois replays. Reservas baixas continuam por milhares de adulto-dias, e apenas duas seeds/um horizonte foram medidos sem repetição pareada.
- JUL-178 e JUL-224 permanecem abertas. Faltam replays de 253/730 dias, 4 seeds e repetibilidade; o ciclo sustentável de carne depende de JUL-199 e sementes compradas dependem de JUL-201. A produção acessível líquida deverá ser medida de novo após essas dependências.
- Esta decisão não conclui JUL-178 nem JUL-224 e não declara que uma roça e um curral já sustentam 50 pessoas.

## Revalidação de ofertas do mercado — JUL-178

Na revisão do código vigente durante este checkpoint (`d6bbd15` como base, antes da nova correção), confirmei uma discrepância entre `marketHasTradeOpportunity` e `performTrade`: o indicador anunciava compra de alimento com 8 unidades no mercado embora a transação exija 12; madeira com 8 em vez de 10; pedra com 6 em vez de 8; e ração com 8 em vez de 10. As vendas também anunciavam excedente acima da reserva protegida, antes de haver a quantidade do lote. `exchangeResources` já recusava débitos insuficientes atomicamente, portanto não reproduzi estoque negativo; o problema demonstrado é uma oportunidade falsa que pode levar peões a uma tentativa sem troca.

**Decisão:** a previsão do mercado e a execução agora compartilham os mesmos lotes, custos, reservas e tetos. A previsão não trata conta negativa ou não finita como saldo disponível. Mantemos lotes e reservas existentes: aceitar lotes parciais mudaria preço e política de estoque, sem evidência de que isso seja o comportamento desejado.

Os testes em `tests/war-trade.test.mjs` cobrem o limite imediatamente abaixo e o lote exato para compra de alimento, madeira e pedra; o limite de venda para alimento, madeira, pedra e ração; e a decisão do peão de não viajar para uma oferta de alimento abaixo de 12, seguida de compra real quando o mercado atinge 12. Os testes direcionados de `tests/war-trade.test.mjs` e `tests/economy-conservation.test.mjs` passaram (19/19); a suíte completa passou (236/236), e `npm run build` concluiu typecheck e build de produção.

No commit de implementação `40d689b7887e1c45d4f98942b445734202b8d25f`, o replay de 253 dias da seed 42 e sua repetição tiveram hashes idênticos de estado (`d435994b59de4dc0114b88bacc84bb726c67cd8b751143f1421755d7199f5de5`) e crônica (`ed4fa895923b40a32fa3e3d7bc3d6ee1e8226d47d02034faebd991630787204f`); nenhum estoque foi negativo em qualquer dia dos dois passes. A simulação terminou com 97 pessoas, 2.343 adulto-dias abaixo de reserva 20 e uma morte humana por fome. Registrou 121 trocas com cobertura completa do ledger: 1 compra comunitária de comida, 1 de pedra, 1 de ração, 113 refeições militares e 5 vendas de alimento. As duas roças estavam completas, com 3.350,51 de raiz colhida e 8.999,77 ainda em pé. Relatório integral: `docs/verification/JUL-178-market-opportunity-253-seed42-repeat-20261027.json`.

Este replay demonstra repetibilidade e consistência de estoque para uma seed/horizonte, mas não isola o efeito causal da correção nem fecha o aceite multissemente/horizonte. A morte por fome, adulto-dias com reserva baixa e grande biomassa ainda em pé mostram que a disponibilidade física não prova acesso alimentar. Não demonstra suficiência para 50 pessoas.

## Replay multissemente de JUL-178 — revisão `b79069f`

Repeti 253 dias nas seeds 1, 42, 987 e 2026, além de uma segunda execução da seed 42, na fonte `b79069ffbcfa2de6491d5f92382797f185494e6a`. O relatório integral `docs/verification/JUL-178-market-opportunity-253-multiseed-20261027.json` inclui hashes, transações, cobertura do ledger e saldos finais. O invariante do auditor não encontrou nenhum estoque negativo durante os dias simulados; os ledgers de todas as trocas têm cobertura completa.

| Seed | Pessoas vivas | Mortes por fome (pessoas/animais) | Adulto-dias com reserva <20 | Roças completas/total | Raiz colhida/em pé | Transações |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 96 | 7 / 7 | 2.102 | 1/2 | 2.631,2 / 5.053,3 | 78 |
| 42 | 97 | 1 / 0 | 2.343 | 2/2 | 3.350,5 / 8.999,8 | 121 |
| 987 | 101 | 0 / 0 | 2.960 | 1/2 | 1.830,3 / 5.086,5 | 100 |
| 2026 | 95 | 0 / 0 | 2.518 | 1/2 | 2.014,3 / 4.611,1 | 121 |

A repetição de seed 42 teve os mesmos hashes de estado (`d435994b59de4dc0114b88bacc84bb726c67cd8b751143f1421755d7199f5de5`) e crônica (`ed4fa895923b40a32fa3e3d7bc3d6ee1e8226d47d02034faebd991630787204f`). O número de transações esconde fluxos distintos: seed 1 só registrou 78 refeições militares; seed 42, 113 refeições militares, 1 compra de comida, 1 de pedra, 1 de ração e 5 vendas de comida; seed 987, 97 refeições militares, 1 compra de madeira e 2 vendas de comida; seed 2026, 115 refeições militares, compras de madeira/pedra e 4 vendas de comida. O estoque comunitário final de comida foi 0/37,11/8,44/22,88; o mercado geral e o tesouro de comida terminaram zerados nas quatro seeds.

O dado confirma repetibilidade, cobertura contábil e que as ofertas do mercado não geram saldo negativo. Também mostra fome em duas seeds e reservas baixas por milhares de adulto-dias com biomassa colhível em pé. Este teste de 253 dias não isola causalidade da correção de oferta e ainda não cumpre todos os horizontes/repetições de JUL-178 nem a meta de suprir 50 moradores.
