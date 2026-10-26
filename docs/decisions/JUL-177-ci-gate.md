# JUL-177 — gate de CI reproduzível

Data: 26/10/2026

## Pergunta e decisão

Como garantir que um PR execute o mesmo contrato técnico local sem misturar métricas de gameplay ou depender de credenciais? Adicionar um workflow GitHub Actions único para `main` e `test/kingdom-autonomous`, tanto em push quanto em pull request, com permissão somente de leitura. Ele instala o lockfile e roda `npm run typecheck`, `npm test` e `npm run build` no Node.js 24 em Ubuntu. O teste publicado já inclui o smoke do Worker. O smoke visual segue no navegador e é registrado por SHA como evidência manual, porque o repositório não mantém Playwright/browser em dependências.

## Fontes e limites

- A skill Game Studio `game-playtest` recomenda avaliar o jogo pela experiência no navegador e capturar screenshots quando a UI ou a renderização forem relevantes; isso informa a separação entre gate automatizado e smoke visual.
- A documentação oficial de [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) define filtros de `push`/`pull_request` por branch e permissões do workflow.
- Releases oficiais de [actions/checkout](https://github.com/actions/checkout/releases) e [actions/setup-node](https://github.com/actions/setup-node/releases) foram consultados em 26/10/2026. O workflow usa os majors vigentes (`v7`) e Node 24, alinhado ao runtime local auditado. A disponibilidade dos checks ainda depende do GitHub executar o PR.
- Consensus está sem cota nesta sessão e SciSpace não foi usado: a decisão é operacional de CI e não depende de uma hipótese científica. A ferramenta de notas compartilhadas do Linear segue sem `get_agent_context`.

## Alternativas

| Alternativa | Vantagem | Limite / decisão |
| --- | --- | --- |
| Manter apenas validação local | Sem minutos de CI | Não atende o gate reproduzível por SHA; rejeitada |
| Instalar browser automation e adicionar job de screenshot já nesta fatia | Valida UI automaticamente | Acrescenta dependências e custo ao gate sem suíte/browser existente; adiada até JUL-194 definir holdouts e cenário de browser |
| Um workflow enxuto com install, typecheck, suite e build; smoke visual documentado separadamente | Usa os comandos canônicos existentes e produz um check obrigatório do PR | Escolhida; ainda precisa de resultado verde do GitHub no SHA publicado |

## Validação pendente

O workflow é verificado por leitura do YAML e pelos mesmos comandos executados localmente; a execução remota e a proteção de branch dependem da configuração/execução do GitHub. Não declarar G0 concluída até os checks ficarem verdes no SHA final e o smoke Worker/browser estar ligado a evidência atual.
