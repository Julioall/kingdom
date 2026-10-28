# JUL-226 — inventário remoto de branches, PRs e destino seguro (28/10/2026)

## Escopo e método

Auditoria das referências remotas visíveis no GitHub, da situação da PR #12 e das comparações de árvores. Este documento **não** substitui o inventário dos worktrees locais: o conector GitHub não inspeciona arquivos sem commit, commits órfãos locais, serviços em execução nem playtest de navegador. Referência canônica: [JUL-226](https://linear.app/julio-alves/issue/JUL-226).

**SHAs verificados:**
- `main`: `d0929298562f326e2439f775e5b753ffb8cb4196`; [CI de produção #40631502772](https://github.com/Julioall/kingdom/actions/runs/40631502772) passou.
- `dev`: `12ff828a1e95c06f05d462b380306985ced7f06e`; [CI de verificação #40635811010](https://github.com/Julioall/kingdom/actions/runs/40635811010) passou.
- Comparação GitHub `main...dev`: `dev` 220 commits à frente, zero atrás. **Não mesclar `dev` integralmente em `main`**: dezenas de funcionalidades/experimentos e relatórios carecem de triagem seletiva.

## Destino das referências existentes

| Referência | SHA inicial observado | Decisão |
| --- | --- | --- |
| `main` | `d092929` | Manter permanente; produção, PRs seletivas e CI |
| `dev` | `12ff828` | Manter permanente; integração e validação |
| `codex/jul178-one-day-food-units` | `9f9147e` | **Reter**: PR #12 aberta com trabalho exclusivo; revisar separação de fontes, evidências e relatório antes de merge em `dev` |
| `codex/jul227-audio` | `eb9e1e4` | Reter até verificar a ancestralidade/merge da antiga PR #8 e a pendência jurídica de origem dos MP3 de JUL-227 |
| `codex/jul226-integration` | `1a70b52` | Candidata a arquivamento após confirmar commits úteis preservados; comparação com `dev`: 4 commits à frente/5 atrás, mas **nenhum arquivo diferente** |
| `codex/kingdom-simulation-atmosphere-audio` | `8ddf6ff` | Candidata a arquivamento após conferir equivalência do patch de caminhos já presente em `main` como `8a993a8` (patch-id documentado em comentário da JUL-226) |
| `backup/jul226-local-wip-full-20261028` | `45a5fc5` | **Preservar isolada**, sem merge em `dev` ou `main`; comparação com `dev`: 1 commit à frente/56 atrás, com exclusões de assets, áudio bruto e relatórios exploratórios |
| `tests/kingdom-integration` | `3b6e1fd` | **Preservar isolada**: 1 commit à frente/229 atrás de `dev`, 44 arquivos diferentes, vários testes novos; execução anterior registrou 154/214 aprovados, 60 falhas |

As refs temporárias ainda não foram excluídas por esta auditoria. Excluir somente depois de verificar toda a ancestralidade, origem e utilidade e de preservar trabalho necessário. A comparação da API para o backup contém o máximo exibido de 300 arquivos e **não é inventário exaustivo**.

## PR #12 — decisão de integração

- Aberta para `dev`; HEAD `9f9147e3e90b1e379ade452b39230bc0c05ed05f`; não é draft, é mergeável; sem reviews nem threads visíveis no GitHub.
- Checks no próprio HEAD: `Typecheck, tests, food replay and build` e `Typecheck, tests and production build`, ambos success (Actions [#40636294778](https://github.com/Julioall/kingdom/actions/runs/40636294778) e [#40636294859](https://github.com/Julioall/kingdom/actions/runs/40636294859)).
- A comparação `dev...codex/jul178-one-day-food-units` mostra 15 commits exclusivos e zero commits faltando da `dev`, mas inclui mudanças transversais em IA, economia, interface e scripts, **além de dezenas de matrizes JSON históricas** em `docs/verification/`. O status Done da JUL-178 prova o aceite do comportamento alimentar essencial; **não aprova automaticamente todo conteúdo da PR**.
- Decisão: **não mesclar a PR #12 integralmente sem revisar o delta e separar arquivos de evidência históricos/gerados do código e dos testes duráveis**. Priorizar uma fatia revisável com rastreabilidade de SHAs e preservar as matrizes históricas por link/artefato, não transportar logs por arrasto. Não reiniciar matrizes longas de 253/365/730 dias apenas para contornar a triagem documental.

## Outros achados e continuidade

- A correção JUL-197 de transporte indevido de pedra está integrada em `main` no SHA `d092929`, via PR #11. A regressão contém cenários de saque e promoção, com red/green já documentado no Linear; a reprodução visual original segue sem imagem/seed e **a issue não deve ser marcada Done apenas pelo commit**.
- JUL-223 possui correções e testes direcionados em `dev`, mas o relato visual original do arqueiro não foi reproduzido; não declarar a issue concluída por smoke genérico.
- JUL-227 exige validar proveniência/licenças e distribuição do áudio, inclusive conteúdo bruto exposto em `public/assets/`, antes de qualquer promoção à `main`.
- O comentário prévio da JUL-226 registra worktrees locais com MP3, relatórios JSON/GZ, `__pycache__` e 43 testes staged não aprovados. Esses arquivos **não podem ser verificados por esta conexão GitHub**: inspeção local é gate restante e não deve ser relatada como concluída.

## Próxima ação operacional

1. Fazer revisão por arquivo dos 15 commits exclusivos da PR #12, separar código/testes de evidência gerada e reduzir o lote antes do merge para `dev`.
2. Inspecionar presencialmente os worktrees locais e os resíduos sem commit. Reter originais até fechar a proveniência.
3. Conferir ancestralidade dos dois branches antigos candidatos a limpeza; não apagar ref com trabalho exclusivo ainda necessário.
4. Publicar `main` apenas por PR pequena, com diff revisado, CI do SHA e teste/smoke relevante. Atualizar JUL-226 após o gate real, não por contagem de arquivos ou status declaratório.

**Limite:** este documento é um inventário remoto incremental, não a certificação final de `main` nem o encerramento da JUL-226.
