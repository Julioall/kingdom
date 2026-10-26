# JUL-178 — atribuição alimentar, seed 42 por 253 dias

Data: 26/10/2026
SHA: `63804698717d9910fe982a0ce524d81e8ad7f43a`

## Comando e reprodutibilidade

`npm run audit:food -- --days 253 --seeds 42 --repeat-seed 42 --output docs/verification/JUL-178-attribution-253-seed42-20261026.json`

As duas execuções coincidiram no estado completo (`907fda498f57cbaa2a9ea81c92896820e31ae20d9307e73b0664bdbe28864e9f`) e na crônica (`53fd0857bdec1eaf343ad96c0365c45e2b619c328971092363e5b99c0b31d`); `determinismDiff=[]`. Os estoques monitorados ficaram não negativos.

## Mortalidade tipada

| População | Total de mortes | Por causa |
| --- | ---: | --- |
| Pessoas | 1 | invasão: 1; fome: 0 |
| Animais | 1 | fome: 1 |
| Rebanho doméstico | 0 | — |
| Fauna selvagem | 1 | fome: 1 |

Houve 3.956 adultos-dia com reserva abaixo de 20, mas nenhuma morte humana por fome neste horizonte. Os estoques comuns, tesouros, mercados e estoque de campanha terminaram zerados, enquanto a reserva pessoal agregada ainda era 1.977,67 pontos; saldo agregado não demonstra acesso local nem disponibilidade no tempo.

## Interpretação e limite

O antigo contador agregado `deathsByCause.starvation` incluía também animais. O trace humano anterior capturou zero mortes por fome; a partição atual confirmou que a única morte foi de fauna selvagem, não de morador ou ovelha domesticada. Isso corrige a classificação, mas não prova sustentabilidade de longo prazo. O replay multissemente de 730 dias permanece pendente.

As primeiras evidências sem tipagem no SHA anterior `0fad44abf7c7548daec5ad29bbee7748c13410ac` foram preservadas em `JUL-178-current-253-seed42-20261026.json` e `JUL-178-current-starvation-trace-seed42-253-20261026.json`; elas demonstram por que a métrica precisava da partição por entidade.
