# JUL-177 — margem de tempo do teste Worker em execução concorrente

## Decisão

Manter o teste de integração de Worker completo e aumentar seu timeout local de 120 para 180 segundos. No SHA `832703dcb214323bd6c9f7a148b8804fab52e889`, `node --test tests/combat-worker.test.mjs` passou em 88,2 s isolado; na suíte padrão, o mesmo teste disputou CPU com os demais arquivos e foi cancelado em 120 s. A suíte reportou 164 passes, sem falhas de asserção, mas o gate permaneceu vermelho por esse timeout.

A margem de 180 s é aproximadamente o dobro da duração observada isoladamente, conserva pausa, batching, reset, época, determinismo e contatos de campanha, e ainda deixa o teste terminar muito antes do timeout de 20 minutos do job de CI. Não reduzir concorrência do runner global, pois isso serializaria outros testes de simulação e aumentaria desnecessariamente a duração da suíte.

## Alternativas e limites

1. Remover ou particionar o teste: rejeitada, pois perderia cobertura do Worker de produção em um fluxo completo.
2. Executar todos os arquivos sequencialmente: rejeitada; não corrige o consumo intrínseco dos vários replays e penaliza a suite inteira.
3. Aumentar a margem somente para este teste: escolhida. O timeout ainda detecta regressão ou bloqueio persistente; a validação do comportamento não é enfraquecida.

O teste isolado passou no SHA `832703dcb214323bd6c9f7a148b8804fab52e889`; a suite completa e o build precisam ser repetidos no SHA final desta alteração.
