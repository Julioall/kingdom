# JUL-226 — migração da branch de teste para dev

Data: 28/10/2026

## Decisão

Consolidar `test/kingdom-autonomous` em `dev` e manter apenas `main` como produção e `dev` como integração permanente. Atualizar `main` só por PR seletiva; não promover em lote o conteúdo de desenvolvimento.

## Estado verificado

- `main`: `d0929298562f326e2439f775e5b753ffb8cb4196`.
- `dev`: `c03c9c595217778a171f8ed58f6efff2bb70e18f`.
- A antiga `test/kingdom-autonomous` apontava ao mesmo SHA antes da remoção; todos seus commits são ancestrais de `dev`.
- `dev` e a branch de teste divergiam em dois commits cada a partir de `2b0b0ef`. O merge trouxe para o histórico consolidado os dois documentos de dev; o tree resultante foi idêntico ao tree de dev anterior ao merge.
- Removi a ref local/remota `test/kingdom-autonomous` após confirmar ancestralidade integral em `dev` e ausência de PR aberta apontando para a branch. Nenhum commit foi descartado e nenhum force-push foi usado.
- Atualizei a ref local `main` em fast-forward ao remoto. `main` remota não foi alterada durante a migração.

## Alternativas e justificativa

Manter `test/kingdom-autonomous` como segunda branch permanente duplicaria a referência de dev sem necessidade: as refs compartilhavam SHA/tree e não havia PR aberta usando o nome antigo. A remoção só ocorreu após a verificação de preservação de histórico. A branch de backup `backup/jul226-local-wip-full-20261028` mantém separadamente o snapshot do checkout misto, SHA `45a5fc50d20158d40a8594917598b61b812d25c6`.

O snapshot de backup contém 367 arquivos, 23 exclusões de assets e aproximadamente 140 MB de arquivos novos, incluindo código de várias frentes e relatórios exploratórios. Ele não foi integrado nem aberto em PR. A branch isolada `tests/kingdom-integration` também permanece fora de dev: não tem PR, está 223 commits atrás e os 214 testes registrados tiveram 60 falhas. Nenhuma dessas duas refs é promovida até triagem específica.

## Validação

O push em `dev` disparou Actions run [#40632069913](https://github.com/Julioall/kingdom/actions/runs/40632069913), concluído com sucesso no SHA exato `c03c9c595217778a171f8ed58f6efff2bb70e18f`: `npm ci`, typecheck, suíte publicada, replay alimentar determinístico de 30 dias e build. Como o tree não mudou durante a reconciliação, não repeti esses testes localmente.

PR #8/JUL-227 continua draft por pendências de audição dos cues e revisão da distribuição/licença. PR #5/JUL-195 permanece fechada sem merge para main. A comparação `main..dev` contém 321 arquivos; nenhum merge integral para produção está autorizado pelos gates atuais.

## Limitações restantes

JUL-226 continua aberta até classificar arquivo a arquivo o snapshot multitema, reconciliar as refs remotas de PR já merged e decidir o destino seguro das branches antigas restantes. Consensus estava sem cota na data da decisão; esta decisão de branch usa evidência verificável do GitHub/Git e não depende de conclusão científica.
