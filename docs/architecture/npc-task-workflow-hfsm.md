# HFSM de execução de tarefas dos NPCs

A máquina de prioridades anterior escolhe o *tipo de atividade*. Esta implementação acrescenta a camada de **execução de objetivos delegados**, chamada no ponto real de escolha de ação e atualizada depois do executor físico.

**Hierarquia**:

1. Controle físico/institucional: necessidades urgentes, ordens militares, limitações do jogador, pausas.
2. Modo de atividade: sobrevivência, recuperação, abastecimento, social, trabalho, rotina e militar.
3. Etapa de execução: planejar local → buscar materiais → deslocar → trabalhar; recolher → transportar → descarregar; patrulhar, escoltar ovelha, manter posto.

A HFSM em `task-workflow-hfsm.js` avalia o estado autoritativo existente: `person.assignment`, `community.stores`, `world.structures`, posição e carga. Armazena apenas um marcador de fluxo `person.activityWorkflow` (ação, modo, etapa, dia e uma chave/ação opcional de retomada), **sem duplicar inventário, ordens, rotas ou resultados**.

## Prioridade e interrupções

A execução chama `beginNpcWorkflow` depois de `selectNpcActivity`, antes do cancelamento de aprendizado. Necessidades de sobrevivência e recuperação podem interromper um trabalho delegado, que fica reservado por até 7 dias se a mesma atribuição ainda existe. O algoritmo revalida a **chave e o tipo atual da atribuição**, porque uma tarefa de coleta pode ter se tornado entrega. Se a decisão seguinte for apenas de rotina e a atribuição ainda estiver ativa, a HFSM pode retomá-la, limpando o aprendizado pendente da escolha neural que não foi executada.

**Nunca** sobrepõe comandos de campanha, soldados de guarnição, planos sociais de prioridade superior ou emergências. A atribuição cancelada, expirada ou pausada não é retomada. `completeNpcWorkflow` atualiza a etapa depois da execução e registra `released` quando a atribuição desaparece; não inventa se a saída foi sucesso ou cancelamento.

O executor físico existente continua realizando obras, comércio, movimentação, militares e armazenamento. Isso preserva o comportamento legado quando a opção está desligada.

## Ativação gradual e desempenho

A opção `world.neuralOverrides.taskWorkflow = true` é **opt-in** durante a validação do conjunto híbrido. No modo normal, nenhuma nova propriedade é armazenada em cada personagem e a paridade V2/V3 deve ser exata.

Na opção híbrida, o custo máximo por personagem é comparações pequenas; uma busca de estrutura por ID só ocorre quando há uma tarefa de construção em análise. Não aciona A* nem decisão neural adicional. O bookmark de HFSM só é necessário para retomar trabalhos interrompidos e expira automaticamente.

## Regressões

```bash
node --test tests/npc-task-workflow-hfsm.test.mjs tests/npc-action-state-machine.test.mjs
npm test && npm run typecheck && npm run build
```

A CI V2/V3 verifica o mundo legado. A execução híbrida requer verificação determinística independente, métricas de trabalho realmente concluído e comparação de alimentação/recuperação/campanha antes de ativar por padrão.
