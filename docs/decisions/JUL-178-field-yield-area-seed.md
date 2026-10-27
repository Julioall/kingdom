# JUL-178 — Rendimento finito da roça por sementes e área plantada

## Contexto

O pedido é que uma colheita não tenha uma quantidade fixa: o lote deve variar conforme as sementes investidas e o espaço realmente ocupado pelo plantio. O lote padrão de 10.000 unidades foi definido para uma roça comum e deve ser todo retirado; depois da colheita, os tiles ficam visualmente sem cultura até uma nova semeadura.

## Decisão

O potencial de um ciclo é limitado pelo menor entre a produção suportada pelas sementes e a capacidade da área cultivada:

```text
alvo = min(sementes × 1.250, tiles plantados × 420)
```

`tiles plantados` conta somente tiles vinculados à roça naquele ciclo. O alvo é um orçamento finito para todo o ciclo: o crescimento não pode ultrapassá-lo e, ao colher o lote completo, a biomassa cultivada chega a zero. O talhão não rebrota após `spent`; um novo ciclo exige que sementes sejam entregues e semeadas.

Exemplos verificáveis:

| Sementes | Tiles ocupados | Colheita potencial | Limite aplicado |
|---:|---:|---:|---|
| 8 | 24 | 10.000 | sementes |
| 8 | 10 | 4.200 | área |
| 4 | 24 | 5.000 | sementes |
| 12 | 24 | 10.080 | área |

Para 50 adultos, a demanda observada de referência é aproximadamente 54,17 unidades brutas por dia; 10.000 unidades equivalem a cerca de 184 dias antes de perdas, arredondamentos e mudança populacional. Essa é uma meta de reserva bruta, não uma garantia de disponibilidade nem evidência de suficiência alimentar anual. A reprodução do ciclo depende do mercado de sementes/entrega/plantio especificados por JUL-201; o mecanismo atual de construção ainda obtém as sementes de frutos locais e não satisfaz esse aceite.

## Alternativas

- Rendimento fixo por roça: rejeitado, pois ignora campo parcialmente ocupado e tamanho variável do lote de sementes.
- Crescimento ilimitado ou rebrota após a retirada total: rejeitado, porque torna a produção indefinida e diverge do pedido de uma colheita visível, totalmente removida.
- Aumentar toda a ecologia ou variar produção por estação: rejeitado. O ajuste permanece só no cultivo. A mudança visual sazonal continua pertencendo aos tiles e não há biomas ou produção ecológica sazonal novos.

## Evidência e limites

SciSpace foi consultado em 27/10/2026 sobre modelos de rendimento finito que consideram área plantada e quantidade de sementes. A busca retornou, entre outros, *The Kraalingen Approach to Crop Simulation* (Papajorgji & Pardalos, 2014, [DOI 10.1007/978-1-4899-7463-1_11](https://doi.org/10.1007/978-1-4899-7463-1_11)), que descreve variáveis de estado e um ciclo de simulação até a colheita. A literatura informa a estrutura do modelo, mas não os coeficientes de jogo `1.250` e `420`; estes são parâmetros de gameplay e precisam ser ajustados por replay. Consensus recusou a busca por limite mensal e informou reset em 01/11/2026. Game Studio recomenda manter simulação separada de renderização e conferir visualmente jogos em canvas; a mudança também altera o estado dos tiles, então será validada no navegador.

O teste automatizado cobre limites independentes de sementes/área, colheita integral pelos trabalhadores, entrega ao estoque, ausência de regeneração depois do lote e semeadura explícita de um ciclo menor. Ainda falta o replay longo pós-commit para medir disponibilidade líquida durante o ano e confirmar que sementes podem ser compradas e replantadas. Não declarar JUL-178 concluída com esta fatia isolada.

## Implementação desta fatia

- SHA: preencher após o commit e replays.
- Testes direcionados: `tests/cultivated-field-batch.test.mjs`, `tests/ai-calendar-observations.test.mjs`, `tests/food-survival.test.mjs`, `tests/food-audit-metrics.test.mjs`.
- Build: `npm run build`.
- Replay anual e hash determinístico: pendente após commit.
