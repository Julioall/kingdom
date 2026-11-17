# Kingdom: máquina de estados hierárquica dos NPCs

**Direção do produto:** sociedade, política, produção econômica e guerra. A máquina organiza as escolhas individuais sem transformar os NPCs em marionetes e sem dar informação onisciente às suas decisões.

## Autoridade sobre o mundo

O único estado autoritativo continua nas entidades e estruturas já existentes: `person.brain`, `person.assignment`, necessidades físicas, `socialIntentions`, `campaignId`, ordens militares e dados do reino.

A função `npcControlState(person)` deriva o modo geral do personagem, sem persistir uma cópia dele:

```text
              pessoa viva?
               /        \
             não        sim
              |          |
             DEAD      menor?
                        /     \
                      sim     não
                       |       |
                   DEPENDENT  controle manual?
                                /      \
                              sim      não
                               |        |
                             PLAYER    campanha ativa?
                                       /      \
                                     sim      não
                                      |        |
                                   CAMPAIGN   soldado?
                                               /     \
                                             sim     não
                                              |       |
                                           GARRISON AUTONOMOUS
```

`DEAD` é um modo de observação, não uma nova passagem pelo processamento de pessoas mortas. A verificação de dependentes acontece depois do incremento da idade, mantendo o limiar anterior de 12 anos. O controle manual continua sujeito ao metabolismo e consequências do dia.

## Prioridades de ação

A função `selectNpcActivity(person, observações, selectRoutine)` é a função de transição hierárquica. Retorna `{action, mode}` por chamada, **sem mutar o mundo**. O modo indica qual domínio assumiu a ação:

| Ordem | Guarda | Modo de atividade |
| --- | --- | --- |
| 1 | Retirada ou guarda de torre sob comando, salvo hidratação imediatamente crítica | military |
| 2 | Ordem válida de retornar à guarnição | military |
| 3 | Fome, sede ou risco imediato | survival |
| 4 | Manutenção física de carga/recursos | supply |
| 5 | Recuperação curta junto ao destacamento | recovery |
| 6 | Descanso em casa/guarnição | recovery |
| 7 | Compromisso social ativo | social |
| 8 | Política de soldado em tempo de paz | military |
| 9 | Coleta de carga observada, válida e alcançável | work |
| 10 | Plano de campanha ou ação militar do dia | military |
| 11 | Transporte de sementes e comércio autorizado | work |
| 12 | Entrega de cargo, trabalho designado, criação, obras e patrulha | supply/work/military |
| 13 | Guarda ou recuperação de soldado sem ordem prioritária | military/recovery |
| 14 | Política neural normal | routine |

As guardas respeitam a **ordem causal original**, inclusive casos pouco intuitivos de retirada, coleta, treinamento e descanso. O parâmetro `selectRoutine` é uma função preguiçosa: **não** deve ser executada nos estados 1–13. Do contrário, haveria inferências extras, atualizações de aprendizado, alteração do RNG e mudanças de decisões mesmo que o personagem termine seguindo sua ordem.

`prepareNpcLearningTransition` continua cancelando amostras de aprendizado interrompidas exatamente como antes. Essa transição ocorre **depois** da escolha da atividade e **antes** de executar a ação, permitindo que uma ordem militar ou emergência não treine incorretamente o cérebro com o resultado de uma tarefa abandonada.

A execução física continua em `individuals/actions.js`, `kingdoms/campaigns.js`, `individuals/movement.js` e demais módulos de domínio. Essa separação cria uma fronteira clara para futuras extrações de executores de ação, sem remover custos reais, logística, percepção local ou consequências.

## Por que não persistir `person.fsmState`?

O Worker já guarda ordens, memórias e a última ação; um campo adicional para o estado derivável acrescentaria peso a cada snapshot, save, transporte Worker→UI e risco de divergência. Em vez de manter dois estados que podem discordar, a transição reavalia guardas a cada dia e devolve o modo escolhido ao chamador.

Isso é uma **máquina determinística de estados e prioridades do controlador**, não uma substituição das intenções sociais persistentes nem da máquina de formação militar. Os compromissos sociais continuam registrados em `socialIntentions` e os soldados permanecem subordinados ao comando.

### Invariantes de teste

- Mesma ação que a expressão anterior em conflitos entre guardas, inclusive quando `militaryAction` é `null`.
- Mesma quantidade de chamadas ao seletor neural; nenhuma chamada extra em situações forçadas.
- Mesmos efeitos sobre `brain.pending`, `militaryBrain.pending`, `lastAction` e `lastDecision`.
- Nenhum novo campo persistente em personagens, mudanças em snapshots ou alterações deliberadas de RNG.
- Paridade de estado autoritativo com a `main` anterior em seeds 1, 42 e 2026, em cenários econômicos e militares.
- Revisar impacto em CPU, especialmente para 500/5000 agentes, antes de expandir o caminho quente.

## Evolução posterior

1. Extrair executores por domínio (recuperação militar, obrigações sociais, logística, trabalho), sem duplicar validações de recursos.
2. Se houver dados suficientes, acrescentar telemetria **opt-in e agregada** por modo, sem anexar um novo objeto por NPC.
3. Criar políticas de decisões melhores **medidas por efeitos reais** sobre os reinos e usando observações permitidas, não apenas pelo número de ações.
4. Substituir dependências ecológicas detalhadas somente quando produção, comércio e suprimento econômicos estiverem implementados com conservação de estoque.
