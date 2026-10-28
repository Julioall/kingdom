# JUL-226 — integrar o gate da main ao fluxo de dev

## Contexto

Em 2026-10-28, `main` (`c76f122`) e `dev` (`979c579`) divergiam no ancestral `b367276`. O commit exclusivo da `main` adicionou o gate de produção em `.github/workflows/ci.yml`. `dev` já possui o smoke replay alimentar, cujo script não pertence à `main` de produção.

## Decisão

Incorporar a história da `main` em uma branch temporária baseada em `dev`, preservando uma única workflow que executa checkout, instalação bloqueada, typecheck, testes e build para `main`, `dev` e branches `codex/**`. Executar o replay alimentar em pushes para `dev` e PRs com destino `dev`.

## Alternativas consideradas

1. Manter somente a workflow de `main`: perde o smoke replay que valida integrações econômicas em `dev`.
2. Manter duas workflows com gatilhos sobrepostos: duplica instalação, testes e build para a maioria dos pushes/PRs.
3. Unificar os gates e condicionar o replay ao destino: evita duplicação e não exige script de auditoria na árvore de produção.

## Justificativa e limites

A alternativa 3 preserva o gate de produção e mantém o replay de desenvolvimento. O replay não roda em push para `main`, push em branch `codex/**`, nem em PR destinado à `main`; PRs destinados a `dev` e pushes diretos em `dev` executam o replay. Isso é uma sincronização de CI, não uma aprovação para levar features de `dev` à produção.

## Validação

No candidato local `52d3350a509398fa61d7169a4a8af45802a4bb7d`: `npm ci` passou, `npm run typecheck` passou, `npm test` passou (306/306), replay de alimento de 30 dias com seed 42 repetida foi determinístico e `npm run build` passou (489 PNGs otimizados sem perda, assets 8.03 MiB → 5.27 MiB). O CI remoto deve confirmar o SHA final da PR. Não alterar nem atualizar `main` diretamente.
