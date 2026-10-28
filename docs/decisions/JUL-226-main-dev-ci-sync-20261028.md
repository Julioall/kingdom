# JUL-226 — integrar o gate da main ao fluxo de dev

## Contexto

Em 2026-10-28, `main` (`c76f122`) e `dev` (`979c579`) divergiam no ancestral `b367276`. O commit exclusivo da `main` adicionou o gate de produção em `.github/workflows/ci.yml`. `dev` já possui o smoke replay alimentar, cujo script não pertence à `main` de produção.

## Decisão

Incorporar a história da `main` em uma branch temporária baseada em `dev`, preservando uma única workflow que executa checkout, instalação bloqueada, typecheck, testes e build para `main`, `dev` e branches `codex/**`. Executar o replay alimentar apenas fora da branch principal e de PRs destinados à `main`.

## Alternativas consideradas

1. Manter somente a workflow de `main`: perde o smoke replay que valida integrações econômicas em `dev`.
2. Manter duas workflows com gatilhos sobrepostos: duplica instalação, testes e build para a maioria dos pushes/PRs.
3. Unificar os gates e condicionar o replay ao destino: evita duplicação e não exige script de auditoria na árvore de produção.

## Justificativa e limites

A alternativa 3 preserva o gate de produção e mantém o replay de desenvolvimento. O replay não roda em push para `main` nem em PR destinado à `main`; PRs destinados a `dev` e pushes em branches de desenvolvimento continuam executando-o. Isso é uma sincronização de CI, não uma aprovação para levar features de `dev` à produção.

## Validação

Pendente nesta branch: typecheck, suíte, smoke de desenvolvimento, build e CI remoto no SHA candidato. Não alterar nem atualizar `main` diretamente.
