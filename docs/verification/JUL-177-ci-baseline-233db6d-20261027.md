# JUL-177 — gates atuais da branch e baseline verificável — 27/10/2026

## Identidade

- Repositório `Julioall/kingdom`; branch `test/kingdom-autonomous`.
- SHA auditado: `233db6d8a5a21de545e9a622b7e337797edc31a5`, PR #5. A última mudança de runtime continua no SHA `7c67efe794cb5aae1b7be5d132f737b77fe806a0`; os commits até este checkpoint acrescentaram documentação e evidência.
- Node local `v24.19.0`; `npm ci` instalou 21 pacotes e reportou 0 vulnerabilidades.

## Gates locais no checkout do SHA

| Gate | Resultado |
| --- | --- |
| `npm run typecheck` | Passou (`tsc --noEmit`). |
| `npm test` | Passou: 176/176, zero falhas, cancelamentos ou skips; 60,6 s. Incluiu o Worker de produção, campanha/combate, agricultura comunitária, ameaça a obras, conservação e contratos sociais. |
| `npm run build` | Passou; Vite transformou 107 módulos. O otimizador converteu 489 PNGs para WebP lossless; assets de 8,03 MiB para 5,27 MiB. |
| `git diff --check` | Passou. |

O teste integrado de Worker terminou no dia 192 da seed 42 com 28 ações de combate e uma campanha. Os fixtures de ameaça também verificaram evacuação, suspensão de progresso, liberação de posto e retomada da mesma obra. Nenhuma alteração de runtime foi necessária nesta validação.

## CI no mesmo SHA

O workflow `Kingdom CI`, run [#76](https://github.com/Julioall/kingdom/actions/runs/40437736960), concluiu com sucesso no SHA `233db6d8a5a21de545e9a622b7e337797edc31a5`. O job instalou dependências travadas, executou typecheck, suíte completa (176/176), replay alimentar determinístico e build.

Replay de smoke da CI: `npm run audit:food -- --days 30 --seeds 42 --repeat-seed 42`. Estado repetido: `f7c30270736788956843878c223f1c7126aa1002add858d24d4fb55d198e63a8`; crônica: `aa5aa6085e81d6de1ceab6c8f10d17e85743cacc9e6f1671a92ac63200e6982e`. As duas execuções coincidiram.

## Browser e matriz de gameplay

O smoke de browser atual para o runtime, no checkout `c143044` (código sem alteração desde `7c67efe`), passou: dois reinos/96 pessoas, dia 13→37, pausa, velocidade, zoom, inspeção de reino e crônica, sem erros/avisos no console. Evidência e limites: `JUL-177-browser-smoke-20261027.md`.

A matriz de gameplay de JUL-179 continua apontando limites reais, sem tratá-los como cobertura de CI: fuga/retomada sob ameaça, logística de campanha, combate visual, formação adaptativa, reação a flechas, coordenação de arqueiros e defesa autônoma do rei seguem nas fatias JUL-180–JUL-193. Os testes atuais comprovam contratos localizados; não fecham essas entregas. O inventário pós-merge e a seleção dos cenários permanecem em `JUL-179-audit-20261026.md`.

## Estado e limite do aceite

Os gates estão demonstrados para o **head da branch/PR**, não para `main`. A PR #5 continua draft e ainda contém fatias em andamento. JUL-177 permanece In Progress: este resultado é o baseline de CI da branch para o restante da meta; não fechar nem declarar pós-merge antes do merge autorizado e da verificação do SHA publicado. O workflow roda em push e pull request e não há merge automático habilitado.
