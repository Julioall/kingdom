# JUL-178 — atribuição de mortalidade na auditoria alimentar

Data: 26/10/2026

## Decisão

Preservar `world.deathsByCause` para compatibilidade, mas não tratá-lo como mortalidade humana: ele soma pessoas e animais. O relatório de alimento agora expõe contagens separadas para pessoas, animais, rebanho doméstico e fauna. Mortes por predação registram `deathDay` e `deathCause` na presa, como as demais causas animais, para não ocultá-las na partição. Essa instrumentação não muda alimentação, movimento, combate, RNG ou criação de recursos.

## Evidência e justificativa

No SHA `0fad44abf7c7548daec5ad29bbee7748c13410ac`, `npm run audit:food -- --days 253 --seeds 42 --repeat-seed 42` reproduziu estado completo e crônica (hashes `907fda498f57cbaa2a9ea81c92896820e31ae20d9307e73b0664bdbe28864e9f` e `53fd0857bdec1eaf343ad96c0365c45e2b619c328971092363e5b99c0b31d`), com `deathsByCause.starvation = 1`. O trace humano no mesmo SHA registrou `deathsCaptured = 0`. A inspeção do código confirmou que `resolveAnimalDeath` também incrementa a mesma chave agregada e que a morte por raposa não guardava causa no animal. Logo, o contador agregado não prova morte humana; métricas não tipadas tornavam a conclusão ambígua.

Replay tipado no commit `63804698717d9910fe982a0ce524d81e8ad7f43a`, seed 42/253 dias e repetição: estado `907fda498f57cbaa2a9ea81c92896820e31ae20d9307e73b0664bdbe28864e9f`, crônica `53fd0857bdec1eaf343ad96c0365c45e2b619c328971092363e5b99c0b31d`, divergência vazia. O único evento de fome foi **um animal selvagem**; pessoas: 1 baixa por invasão, 0 por fome; rebanho doméstico: 0 mortes. A leitura inicial do contador agregado como possível fome humana estava incorreta. O relatório tipado está em `docs/verification/JUL-178-attribution-253-seed42-20261026.json`.

Não ajusto números ecológicos nem adiciono bioma/estação: a correção é de atribuição, e o critério de sobrevivência humana permanece medido sobre `world.people`. A sobrevivência do rebanho será avaliada separadamente nos cenários de 730 dias.

## Alternativas

1. Interpretar todo incremento agregado como fome humana: rejeitado, porque mede também animais.
2. Ignorar mortalidade animal na auditoria: rejeitado, porque JUL-178 exige rastrear alimentação do rebanho e preservar conversões explícitas.
3. Manter o agregado e adicionar partições tipadas: escolhido; mantém compatibilidade e torna explícita a população avaliada.

## Verificação desta alteração

- `node --test tests/food-audit-metrics.test.mjs`: 3/3.
- `npm test`: 155/155, incluindo Worker determinístico até o dia 192.
- `npm run build`: `tsc --noEmit`, Vite e otimização lossless de 489 PNGs passaram.
- Replays alimentares tipados em 253/730 dias ainda serão registrados em `docs/verification/` antes de encerrar JUL-178.
