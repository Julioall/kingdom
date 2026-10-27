# Decisão — atribuição de transações de mercado

Data: 27/10/2026
Estado: instrumentação implementada; replay desta revisão pendente
Issue: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-cultivo-caca-civis)

## Decisão

Os relatórios de alimento devem separar eventos de mercado de todas as outras trocas. O antigo campo `marketTransactions` era alimentado por `world.trades`, que conta tanto comércio com mercado como escambo entre comunidades. Passa a haver uma leitura explícita do contador de cada mercado e do seu ledger, com agrupamento por ação, mercado e variação líquida de cada mercadoria. O escambo fica contado separadamente.

Usar o `tradeLedger` existente, sem reter outra cópia ilimitada nem alterar decisões da simulação. O mesmo evento aparece no histórico de seus dois donos; a auditoria o deduplica pelo identificador global. Como cada histórico mantém no máximo 120 eventos, o relatório expõe flags para lacunas, contador divergente ou ledger truncado. Um total parcial nunca será descrito como total completo.

Cada transação de mercado também é atribuída à pessoa registrada como participante, com função e comunidade enriquecidas a partir do estado final. A instrumentação da IA mede verificações de oportunidade, oportunidades reconhecidas, passos de aproximação, tentativas, conclusões e bloqueios por motivo. Escambos têm contadores próprios. Esses valores são ocorrências de decisão/movimento e podem contar mais de uma avaliação por pessoa; não são estimativas de indivíduos únicos. Compras automáticas de refeição militar aparecem no ledger e na atribuição por pessoa, mas não nos contadores de tentativa da IA.

## Evidência de código

- `recordTrade` incrementa `world.trades` e salva o mesmo evento nos ledgers dos donos.
- `performTrade` registra `kind: 'market'` para compras/vendas e `kind: 'community-barter'` para trocas diretas.
- O evento `market` identifica `personId` do agente que iniciou a negociação; a refeição militar já registra a pessoa soldado e o reino pagador.
- `world.tradeDiagnostics` registra motivos de oportunidades ausentes/bloqueadas e resultados das tentativas de mercado e escambo, sem alterar política ou saldos.
- A refeição militar também é `kind: 'market'` e incrementa o contador do mercado, mas seu pagador é uma carteira individual.
- O script `audit-food-replays.mjs` antes exportava `world.trades` com o nome `marketTransactions`; portanto, os valores 68–78 dos replays de 730 dias incluem escambo e não medem o volume real de mercado.

## Alternativas

| Alternativa | Decisão | Justificativa |
| --- | --- | --- |
| Tratar `world.trades` como compras/vendas de mercado | Rejeitada | Mistura mercado, barter comunitário e outros registros. |
| Armazenar para sempre outro histórico no runtime | Rejeitada | Duplica dados e faz a memória crescer sem limite; os ledgers existentes já guardam evento, dono e deltas. |
| Deduplicar os ledgers e expor cobertura | Escolhida | Produz resumo por ação, pessoa, mercado e mercadoria, revela quando o limite do histórico impede uma conclusão completa e mostra barreiras de acesso/troca sem inferi-las pelo saldo final. |

## Validação

`node --test tests/food-audit-metrics.test.mjs tests/war-trade.test.mjs`: 13/13 passaram, cobrindo compra atribuída à pessoa, counters de oportunidade/tentativa/conclusão, bloqueio por ausência de oferta, barter, deduplicação e ledger truncado. `node --check` nos dois módulos alterados e `git diff --check` passaram. O replay seed 42/365 dias será executado no SHA do commit desta fatia; seus resultados completarão este registro. Nenhuma mudança visual ou de gameplay foi feita.
