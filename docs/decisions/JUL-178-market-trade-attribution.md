# Decisão — atribuição de transações de mercado

Data: 27/10/2026
Estado: métrica implementada; replay de validação pendente
Issue: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-cultivo-caca-civis)

## Decisão

Os relatórios de alimento devem separar eventos de mercado de todas as outras trocas. O antigo campo `marketTransactions` era alimentado por `world.trades`, que conta tanto comércio com mercado como escambo entre comunidades. Passa a haver uma leitura explícita do contador de cada mercado e do seu ledger, com agrupamento por ação, mercado e variação líquida de cada mercadoria. O escambo fica contado separadamente.

Usar o `tradeLedger` existente, sem reter outra cópia ilimitada nem alterar decisões da simulação. O mesmo evento aparece no histórico de seus dois donos; a auditoria o deduplica pelo identificador global. Como cada histórico mantém no máximo 120 eventos, o relatório expõe flags para lacunas, contador divergente ou ledger truncado. Um total parcial nunca será descrito como total completo.

## Evidência de código

- `recordTrade` incrementa `world.trades` e salva o mesmo evento nos ledgers dos donos.
- `performTrade` registra `kind: 'market'` para compras/vendas e `kind: 'community-barter'` para trocas diretas.
- A refeição militar também é `kind: 'market'` e incrementa o contador do mercado, mas seu pagador é uma carteira individual.
- O script `audit-food-replays.mjs` antes exportava `world.trades` com o nome `marketTransactions`; portanto, os valores 68–78 dos replays de 730 dias incluem escambo e não medem o volume real de mercado.

## Alternativas

| Alternativa | Decisão | Justificativa |
| --- | --- | --- |
| Tratar `world.trades` como compras/vendas de mercado | Rejeitada | Mistura mercado, barter comunitário e outros registros. |
| Armazenar para sempre outro histórico no runtime | Rejeitada | Duplica dados e faz a memória crescer sem limite; os ledgers existentes já guardam evento, dono e deltas. |
| Deduplicar os ledgers e expor cobertura | Escolhida | Produz resumo por ação e mercadoria, e revela quando o limite do histórico impede uma conclusão completa. |

## Validação

`node --test tests/food-audit-metrics.test.mjs`: 8/8 passaram, cobrindo compra com deltas, barter, deduplicação e detecção de ledger truncado. O replay seed 42/365 dias será executado no SHA do commit desta fatia; seus resultados completarão este registro. Nenhuma mudança visual ou de gameplay foi feita.
