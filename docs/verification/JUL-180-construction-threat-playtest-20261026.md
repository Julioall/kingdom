# JUL-180 — verificação de construção sob ameaça

Data: 26/10/2026  
Branch: `codex/jul195-integration`

## Teste automatizado

- `node --test tests/construction-threat-audit.test.mjs`: 11/11 aprovados.
- Cobertura: ameaça próxima com rochas na rota; ameaça que surge durante a martelada; liberação imediata da escala ativa; substituição por terceiro trabalhador; posto ocupado sem sobrecarga; morte/captura/destruição/conclusão que liberam referências; histerese e retomada da mesma obra; espera preventiva; flecha ativa que prioriza copa.
- As asserções verificam progresso e custos conservados, nenhum progresso fantasma, slot livre durante a fuga, possibilidade de substituição, retorno da pessoa original, limpeza ao concluir, decisão individual e histórico/crônica de proteção e retomada.
- `npm test`: 138/138 aprovados. A execução completa levou 97,76 s e incluiu os 11 cenários focados de JUL-180, o Worker de produção e os demais testes de economia, combate, social, visual e áudio.
- `npm run build`: `tsc --noEmit`, Vite (107 módulos) e otimização dos 489 PNGs passaram após as alterações de produção. O resultado reduziu assets de 8,03 MiB para 5,27 MiB.

## Playtest no navegador

- Aplicação local em `http://127.0.0.1:5174/?seed=42&paused=1`, servida pelo worktree desta branch.
- Replay limpo do código final, seed 42, chegou ao dia 295; viewport 1280×720, zoom 50%, inverno. O mapa, os controles e a crônica continuaram acessíveis. A crônica mostra o posto de Valedouro no dia 67 e o de Corvânia no dia 77, ambos incorporando novas células, além das campanhas e da perda de Ema por invasão territorial no dia 259.
- A crônica do replay limpo final não mostrou retirada. Uma execução interativa anterior exibiu retirada da obra nos dias 64 e 68, mas precedeu a correção final de substituição do trabalhador e não é atribuída a este código final. A transição final permanece demonstrada nos 11 testes focados.
- A captura visual final foi inspecionada na sessão. Não foi anexada ao Linear: a navegação da issue Linear no IAB abriu “Create a workspace” em vez do workspace do usuário. Uma tentativa de usar URL `data:` para persistir a captura foi recusada pela política de URL do navegador; não usei outra rota de navegador para contornar essa restrição. A captura anterior com retiradas também não foi enviada nem é citada como evidência do SHA final.

## Fontes e limitações de pesquisa

- SciSpace: Zhou, Ying; Zhang, Zi-min; Cui, Jian (2017), *EvacAgent: A Building Emergency Evacuation Simulation Model Based on Agent*, DOI [10.1145/3080845.3080872](https://doi.org/10.1145/3080845.3080872). Referência de desenho local para evacuação com informação individual; não valida o comportamento de Kingdom.
- Consensus retornou quota atingida (30/30; próximo reset informado em 1/11/2026).
- A chamada ao contexto compartilhado da Linear falhou com `Tool get_agent_context not found`, inclusive após usar o campo `task` previsto no catálogo. Não havia notas de contexto retornadas por essa ferramenta.

## Critérios visuais e limites

O runtime final demonstra construções de fronteira concluídas e campanhas, mas não exibiu retirada nessa execução determinística. Os 11 testes focados cobrem fuga, segurança, substituição e recuperação no código final. A issue continua aberta até registrar o SHA do commit e os resultados desta verificação no Linear.
