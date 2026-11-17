# Kingdom: trabalho individual sem varredura global para tarefas irrelevantes

O cálculo de `taskStateBefore` e `taskStateAfter` em `src/simulation/individuals/actions.js` era executado para todo adulto, mesmo quando a ação escolhida era caminhar, beber, vigiar, descansar, negociar, fugir ou interagir socialmente.

Para duas métricas, o código varria **todas** as estruturas do mundo em cada snapshot:
- `buildProgress`: somava progresso de obras na comunidade.
- `repairProgress`: somava integridade e vida das estruturas completas do reino.

Essas métricas só aparecem em `completeCommunityTask` quando **`task.action === 'build' && action === 'build'`**. A máquina de estados já seleciona a ação antes da captura; o consumidor não lê essas métricas para outras atividades.

## Solução

`constructionTaskProgress(world, community, action)` retorna `null` para ações distintas de `build`, sem sequer acessar `world.structures`. Em `build`, devolve os cálculos idênticos aos anteriores. O controlador mantém as demais métricas econômicas `food`, `wood`, `gold`, `tradeCount` e cargo com exatamente as mesmas fontes e sem interrupção.

Calculamos as métricas antes e depois de toda ação `build` **mesmo se o NPC não tinha tarefa antes**, pois uma atribuição pode surgir durante a execução. Não introduzimos novos flags persistentes nem caches inválidos para recursos financeiros.

## Efeito esperado

Essa mudança reduz de quatro para zero as varreduras globais de estruturas por adulto não construtor (duas capturas, cada uma com progresso de obra e reparo). Ela não altera quantos projetos existem, condições de construção ou fluxo de recursos. NPCs construtores continuam pagando o mesmo custo lógico de contabilização.

## Gates

- `node --test tests/construction-task-progress.test.mjs`
- `npm test` e build, typecheck
- Comparação V2 com digests de estado autoritativo entre seeds
- V3 com 5.000 NPCs (a pasta `individuals/**` já dispara o workflow)
- Se houver diferença de decisões, encargos econômicos ou resultado de campanha, não integrar

O profiler vai indicar quanto dessa redução se reflete na execução total. Não extrapolar um ganho na duração do dia para 144 FPS; a thread de renderização e os snapshots ainda têm orçamento próprio.
