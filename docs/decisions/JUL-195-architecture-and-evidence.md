# JUL-195 — decisões de arquitetura e evidências

Data: 26/10/2026<br>
Branch: `test/kingdom-autonomous`<br>
SHA-base remoto: `fb0af4e7f8bc07d3dbf5a1c0b9ea36bcb4102164`

## Contexto e preservação

A branch de teste foi criada a partir de `kingdom/main` após `git fetch kingdom`. A branch remota de teste não existia. O diretório tinha alterações locais antes da criação da branch: mudanças em `README.md`, `package.json`/lock, renderer/animações, profiler, teste, sprites e relatórios de exploração. Elas foram guardadas temporariamente com `git stash --include-untracked`, reaplicadas sem conflito e permanecem no diretório de trabalho. Não foram incluídas em commits nem alteradas nesta etapa; a relação delas com as issues vigentes será identificada antes de separá-las em commits.

## Ferramentas consultadas

- **Game Studio / Game Playtest / Web Game Foundations:** o jogo já é um projeto 2D de navegador com Vite, Canvas, interface DOM e simulação em Worker. A orientação aplicável é preservar essa arquitetura, manter o estado simulado fora do renderer e verificar fluxos de jogador e mudanças visuais com screenshots. Migrar de engine não atende à meta.
- **Consensus:** a chamada de pesquisa foi tentada, mas a ferramenta informou que as 30 buscas do mês foram usadas e que a cota reinicia em 01/11/2026. A própria JUL-195 já registra três referências consultadas: [Tribes: A New Turn-Based Strategy Game for AI Research](https://doi.org/10.1609/aiide.v16i1.7438), [Hierarchical Macro Strategy Model for MOBA Game AI](https://doi.org/10.1609/AAAI.V33I01.33011206) e [Resource-Aware Strategic Planning for Partially Observable Star-Sector Tactical Games](https://doi.org/10.3390/info17100963). Não foi possível pedir uma nova síntese nesta execução.
- **SciSpace:** consulta semântica retornou estudos alinhados à arquitetura incremental. [LGOAP: Adaptive Layered Planning for Real-Time Videogames](https://doi.org/10.1109/CIG.2013.6633624) descreve planejamento em camadas para consequências de curto e longo prazo, com custo adequado a centenas de agentes; é evidência direta para separar intenção estratégica e controle executável, mas não prova eficácia no Kingdom. [Adaptive decision making in agent-based simulation](https://doi.org/10.1177/0037549714536930) discute deliberação coerente, adoção/rejeição de objetivos e monitoramento sob incerteza. [Human-Autonomy Teaming and Explainable AI Capabilities in RTS Games](https://doi.org/10.1007/978-3-030-49183-3_13) motiva tornar recomendações de RTS compreensíveis para quem observa ou coopera com a IA. São referências de desenho; métricas e replays do jogo continuam sendo o critério de aceitação.
- **Notas de engenharia do Linear:** a chamada declarada `linear_get_agent_context` respondeu `Tool get_agent_context not found`. O acesso a essas notas compartilhadas ficou indisponível; a inspeção do código e das issues será a fonte operacional.

## Decisões de implementação

1. **Preservar a arquitetura atual.** A simulação continua determinística e de propriedade do Worker; Canvas anima snapshots serializados e a interface DOM apresenta comandos e explicações. Não migrar para Phaser, não transferir regras de domínio para callbacks de desenho.
2. **Manter deliberação em camadas, com ações verificáveis.** Reis e comandantes escolhem objetivos usando inteligência que receberam; controladores individuais executam ações válidas no domínio. Cada decisão relevante deve deixar observação, custo, intenção, resultado e consequência examináveis. Rejeição de ordem inválida e fallback determinístico são preferidos a ação direta por LLM ou estado omnisciente.
3. **Aprender por resultado demonstrável.** Acertos, defesa eficaz, apoio útil, campanhas e treino devem alterar política ou domínio somente após consequência observável. Ataque no vazio, repetição gratuita e incremento de preparo sem round real não contam como melhoria.
4. **Fazer economia e sociedade usarem fluxos finitos.** Comércio, imposto, construção, recrutamento, soldo, abastecimento e políticas devem mover recursos por operações auditáveis e produzir consequências na crônica. Memórias e relatos devem guardar origem, testemunha, alcance e validade; não propagar conhecimento global sem evento.
5. **Manter ecologia mínima.** Preservar somente os estados necessários a fontes finitas, coleta, cultivo, água e sobrevivência que tenham consumidores verificáveis. Estações são troca visual de tiles. Biomas, clima sazonal e mecânicas ecológicas sazonais ficam fora de escopo.
6. **Avaliar comportamento em cenários reproduzíveis.** Fixar seed, estado, comandos, horizonte e métricas antes de comparar políticas. Repetir a mesma seed para detectar não determinismo, comparar sementes distintas para expor dependência de cenário e reservar holdouts para alegações de aprendizado. Testes de unidade não substituem replays, integração Worker nem playtest visual.

## Alternativas consideradas

- **Migrar a engine:** rejeitada porque aumentaria risco e não resolve as lacunas funcionais identificadas pelas issues.
- **Delegar todas as decisões a LLM ou RL irrestrito:** rejeitada nesta meta porque latência, variação e estado difícil de auditar entram em conflito com Worker determinístico e evidência causal. Uma camada de interpretação ocasional só deve avançar se a issue correspondente demonstrar ganho observável.
- **Simular biomas/estações e ciclos ecológicos completos:** rejeitada explicitamente pela meta e pelas issues vigentes; aumenta custo sem consumidor de gameplay demonstrado.
- **Adicionar capacidade antes de corrigir baseline/contato/logística:** rejeitada; seguir as dependências e fechar primeiro falhas que invalidariam as avaliações posteriores.

## Plano de validação

- Base: `npm ci`, `npm run typecheck`, `npm test`, `npm run build` e smoke browser/Worker no SHA auditado.
- Mudanças de simulação: testes direcionados, replay determinístico com entradas fixas e verificação de ledger, eventos e consequências.
- Mudanças de combate/construção/UI: além dos testes, iniciar no navegador, executar o fluxo afetado e guardar screenshots legíveis.
- Cada issue recebe o commit SHA, comandos/resultados e caminho de evidência; só passa a Done quando os critérios próprios forem demonstrados.

## Estado

Decisões iniciais, sujeitas a ajuste quando o código e os replays contradisserem as hipóteses. A revalidação operacional de 27/10/2026 está registrada abaixo; resultados de cada implementação seguem nas decisões e issues correspondentes.

## Revalidação da branch e do PR — 27/10/2026

Após `git fetch kingdom`, `kingdom/main` estava em `b36727648370ac52a02707b86fbcfcb5a9315d10`. Esse commit já é ancestral de `test/kingdom-autonomous`; a branch remota `kingdom/test/kingdom-autonomous` também é ancestral da ponta local. A branch já contém a atualização da `main`, portanto não foi necessário integrar novamente nem reescrever histórico. `git rev-list --left-right --count kingdom/main...HEAD` retornou `0 110`, e a branch de teste remota está dois commits atrás da ponta local. O worktree tinha mudanças locais de JUL-173 e relatórios não rastreados; todos foram preservados e serão separados por issue.

A PR [#5](https://github.com/Julioall/kingdom/pull/5) está aberta como draft, base `main`, head remoto `588e0670e838ce2b866a11d29256fc14dc14e895`, com 108 commits e 158 arquivos. O endpoint de diff da GitHub recusou a resposta por ultrapassar 20.000 linhas; isso não é uma revisão do conteúdo. A PR permanece não finalizada até a inspeção dos arquivos por fatia e os gates no SHA final. Nenhum merge ou force-push foi executado.

A tentativa de carregar as notas do agente Linear nesta execução voltou a responder `Tool get_agent_context not found`; a consulta de issues, os documentos locais, os testes e o código seguem como fontes disponíveis.
