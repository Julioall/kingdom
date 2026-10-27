# Decisão — atribuição de transações de mercado

Data: 27/10/2026
Estado: instrumentação e replay determinístico seed 42/365 dias concluídos; auditoria multissemente de JUL-178 pendente
Issue: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-cultivo-caca-civis)

## Decisão

Os relatórios de alimento devem separar eventos de mercado de todas as outras trocas. O antigo campo `marketTransactions` era alimentado por `world.trades`, que conta tanto comércio com mercado como escambo entre comunidades. Passa a haver uma leitura explícita do contador de cada mercado e do seu ledger, com agrupamento por ação, mercado e variação líquida de cada mercadoria. O escambo fica contado separadamente.

Usar o `tradeLedger` existente, sem reter outra cópia ilimitada nem alterar decisões da simulação. O mesmo evento aparece no histórico de seus dois donos; a auditoria o deduplica pelo identificador global. Como cada histórico mantém no máximo 120 eventos, o relatório expõe flags para lacunas, contador divergente ou ledger truncado. Um total parcial nunca será descrito como total completo.

Cada transação de mercado também é atribuída à pessoa registrada como participante, com função e comunidade enriquecidas a partir do estado final. A instrumentação opt-in da auditoria mede verificações de oportunidade, oportunidades reconhecidas, passos de aproximação, tentativas, conclusões e bloqueios por motivo. Escambos têm contadores próprios. Esses valores são ocorrências de decisão/movimento e podem contar mais de uma avaliação por pessoa; não são estimativas de indivíduos únicos. Compras automáticas de refeição militar aparecem no ledger e na atribuição por pessoa, mas não nos contadores de tentativa da IA. A simulação normal não cria nem atualiza esses contadores.

## Evidência de código

- `recordTrade` incrementa `world.trades` e salva o mesmo evento nos ledgers dos donos.
- `performTrade` registra `kind: 'market'` para compras/vendas e `kind: 'community-barter'` para trocas diretas.
- O evento `market` identifica `personId` do agente que iniciou a negociação; a refeição militar já registra a pessoa soldado e o reino pagador.
- `world.tradeDiagnostics`, ativado somente pelo replay de auditoria, registra motivos de oportunidades ausentes/bloqueadas e resultados das tentativas de mercado e escambo, sem alterar política ou saldos.
- A refeição militar também é `kind: 'market'` e incrementa o contador do mercado, mas seu pagador é uma carteira individual.
- O script `audit-food-replays.mjs` antes exportava `world.trades` com o nome `marketTransactions`; portanto, os valores 68–78 dos replays de 730 dias incluem escambo e não medem o volume real de mercado.

## Alternativas

| Alternativa | Decisão | Justificativa |
| --- | --- | --- |
| Tratar `world.trades` como compras/vendas de mercado | Rejeitada | Mistura mercado, barter comunitário e outros registros. |
| Armazenar para sempre outro histórico no runtime | Rejeitada | Duplica dados e faz a memória crescer sem limite; os ledgers existentes já guardam evento, dono e deltas. |
| Deduplicar os ledgers e expor cobertura | Escolhida | Produz resumo por ação, pessoa, mercado e mercadoria, revela quando o limite do histórico impede uma conclusão completa e mostra barreiras de acesso/troca sem inferi-las pelo saldo final. |

## Validação

`node --test tests/food-audit-metrics.test.mjs tests/war-trade.test.mjs`: 13/13 passaram, cobrindo compra atribuída à pessoa, contadores de oportunidade/tentativa/conclusão, bloqueio por ausência de oferta, barter, deduplicação e ledger truncado. `node --check` nos módulos de comércio/auditoria e `git diff --check` passaram. Após remover a normalização repetida do objeto de métricas a cada avaliação, o primeiro replay instrumentado caiu de 145,45 s para 88,18 s no mesmo seed/horizonte; o contador só é alocado no auditor. O valor anterior de 77,87 s foi medido em outra execução e ambiente, então não é comparação controlada.

Replay final da instrumentação: `docs/verification/JUL-178-market-diagnostics-optin-seed42-365-repeat-20261027.json`, source revision `1a4f264d12963c4b48d62b2bbd8ee92120eb6942`, SHA-256 do relatório `14827570A59727ADAFCACEDC3B1DB4934373FDC44C0B420026A79CCEAFF6F1DD`. As duas execuções coincidiram em estado `a1c076a1744132e617daaa4be87626850974296958a03c0d213487f1564707b4` e crônica `972d8b364b3ae14f60bd87479d2f54534550bf10273f67d00a87e43fd387d9e5`. Houve 68 transações reais de mercado, ledger completo após deduplicação, 67 compras automáticas de refeição militar e uma troca civil iniciada pela moradora 133 (`trocou madeira por alimento`). Nenhuma venda civil de colheita ocorreu.

Nos contadores de decisão da IA (ocorrências, não indivíduos únicos): 27.476 verificações, 8.142 reconhecimentos de oportunidade, 17.252 verificações com posto fora de alcance, 2.082 sem oferta de troca, 28 passos de aproximação e uma tentativa/conclusão. A diferença entre oportunidades verificadas e ação concluída indica que proximidade e seleção de ação precisam ser avaliadas na fatia de JUL-201; não prova sozinha uma causa única. As duas roças ainda estavam incompletas (32/34 e 19/34), com 8 sementes registradas cada, sem plantio nem colheita. Nenhuma mudança visual ou de gameplay foi feita nesta instrumentação; JUL-178 continua In Progress por seus demais critérios.
