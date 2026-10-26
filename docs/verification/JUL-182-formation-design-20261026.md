# JUL-182 — revisão e verificação do desenho tático

Data: 26/10/2026
Base examinada: `src/simulation/kingdoms/formations.js`, `src/simulation/kingdoms/campaigns.js`, `src/simulation/kingdoms/military-learning.js`, `src/simulation/physics/hitboxes.js`.

## Verificação

- `node --test tests/formation-benchmark.test.mjs`: 4/4 aprovados; verifica versão/pré-registro, disjunção dos 12 seeds de calibração e 12 de holdout, seis cenários de arenas, classes e geometrias requeridas, métricas independentes e preservação de `line`/`column`.
- `git diff --check`: limpo.
- Nenhum peso foi ajustado e nenhuma mecânica de formação ou ecologia foi alterada nesta etapa. Portanto, este artefato estabelece o protocolo antes do treino; não declara resultados de combate. A execução comparativa com formas implementadas cabe à integração de JUL-189.
- Nenhum playtest visual é aplicável a esta entrega de desenho/configuração, que não modifica renderização nem gameplay.

## Fontes consultadas

SciSpace foi consultado sobre seleção contextual de formações em RTS e desenho de benchmark reproduzível. A evidência que informa o plano e suas limitações está detalhada em `docs/decisions/JUL-182-formacoes-taticas-e-avaliacao.md`. As páginas primárias dos jogos e a publicação doutrinária foram abertas e comparadas com a biblioteca existente; Consensus segue sem quota até 01/11/2026.
