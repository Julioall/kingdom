# Kingdom: modo híbrido Utility AI + HFSM + Steering/Boids

## Ativação experimental

Abra o Kingdom com **`?npcBehavior=hybrid`** (exemplo: `?seed=42&npcBehavior=hybrid&profile=1`). O modo normal `legacy` continua sendo o padrão para não trocar a política de milhões de decisões nem invalidar saves silenciosamente.

O parâmetro é enviado na inicialização e em cada `reset` da sessão, tipado no protocolo Worker. O Worker valida **apenas** `legacy` e `hybrid`. O perfilador de renderização expõe o modo escolhido em seu contexto.

O modo híbrido ativa simultaneamente:
- `neuralOverrides.utilityContinuity = true`: continuidade de decisões voluntárias quando a diferença de pontuação é pequena e o objetivo anterior ainda é viável.
- `neuralOverrides.taskWorkflow = true`: HFSM de etapas de execução baseada em ordens e tarefas reais, com pausa e retomada limitada; prioridades físicas e militares nunca são rebaixadas.
- `neuralOverrides.steeringBoids = true`: movimento de ovelhas com separação/alinhamento/coesão locais e contingência de congestionamento de humanos, sempre usando `canStep` e A* existente.

Esses sistemas **não** criam novas instâncias de políticas neurais, não consomem RNG extra e não são executados a 144 Hz. A execução roda no Worker em passos de simulação, e o Canvas continua separado.

## Como comparar sem falso positivo

```bash
npm test
npm run typecheck
npm run build
npm run bench:npc-hybrid -- --populations=100,500 --seeds=1,42 --days=2 --repeats=2
```

`scripts/benchmark-npc-hybrid.mjs` executa legacy/hybrid alternando a ordem em um mesmo host, registrando tempo por dia, consumo médio de energia/água/comida, tarefas ativas, estruturas concluídas, estoque coletivo e estágios de tarefas.

**Atenção:** o híbrido altera intencionalmente algumas decisões. Portanto o hash entre `legacy` e `hybrid` pode ser diferente. **Obrigatoriamente cada modo deve ter hash idêntico ao repetir a mesma seed, população e número de dias**; divergência falha o benchmark.

A GitHub Action `Kingdom hybrid NPC behavior and determinism` testa ambos os modos com 100/500 atores, seeds 1/42, duas repetições e JSON arquivado. Acionamento manual suporta o teste mais caro de 5.000 atores (duas repetições, seed 42). O objetivo desse A/B é diagnosticar decisões e custo, não estabelecer um ranking por uma única amostra.

## Critérios de aceitação antes de tornar o padrão

1. Civil/mercado: fome, negociação, entregas, conclusão de obras e disponibilidade de alimento não podem ser comprometidos; nenhuma ação compulsória pode ser anulada por histerese.
2. Militar: retirada, recuperação, formação e guarnição precedem rotinas civis. Boids nunca quebra território, portões ou regras de combate.
3. Movimento: sem teleporte, colisão de personagens, ovelha atravessando cerca ou travamento permanente de corredores. Quando não há vizinhos, navegação antiga continua válida.
4. Escala: redução ou estabilidade sustentada no CPU do Worker com 500/5.000 agentes, com medições repetidas e perfis amostrais. Evitar O(N²).
5. Renderização: validar RAF e p95/p99 reais na GPU do usuário, separado de snapshot e CPU. `renderHz=144` é **teto configurável**, não prova de 144 FPS.

## Rollout / retorno seguro

O modo híbrido está isolado por opção no Worker; retirar `npcBehavior=hybrid` recarrega o mundo novo no legado, sem modificar o repositório nem instalar dependências externas. O bookmark HFSM de personagens do modo híbrido não deve passar a ser usado como autoridade sobre inventário, ordens, recursos ou decisões da simulação legada.

Os contratos individuais estão em `docs/architecture/npc-utility-continuity.md`, `docs/architecture/npc-task-workflow-hfsm.md` e `docs/architecture/npc-local-steering-boids.md`.
