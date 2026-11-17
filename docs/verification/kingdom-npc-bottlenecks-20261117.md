# Kingdom — gargalos de simulação e perfis de NPC (17/11/2026)

## Evidência recebida da GitHub Actions

Os artefatos foram obtidos da execução do PR #118 (`03bb1f1565834efe8efc4fc3ad16aabbd147098f`).

**CPU, 5.000 NPCs e 1 dia, mesmo runner/seed 42:**

| Versão | Tempo de 1 dia | Hash autoritativo |
| --- | ---: | --- |
| `main` anterior | 144.195,6 ms | idêntico |
| PR #118 | 144.353,8 ms | idêntico |

Conclusão: a alteração de renderização do PR #118 **não acelerou a simulação autoritativa**, como previsto; diferenças de ~0,11% numa amostra isolada são ruído insuficiente para afirmar regressão.

No perfil de fases do PR #118 (3 seeds × 7 dias, sem alterar o estado de jogo):

| Fase | Média por dia | p95 |
| --- | ---: | ---: |
| `societyAndNpcActions` | 291,5 ms | 649,5 ms |
| `environment` | 27,0 ms | 63,6 ms |
| `npcPerception` (subfase) | 20,4 ms | 30,6 ms |

O total instrumentado foi 322,8 ms em média. `npcPerception` está contido em `societyAndNpcActions`; não somar as duas fases. Este resultado mostra que as atividades de pessoas dominam o custo nas seeds e populações medidas, **não** que o algoritmo de percepção seja o maior vilão.

**Browser (headless Chromium, renderização por software, 1 repetição):** índices de atores ativos apresentaram RAF medido de 12,7 FPS vs 22,8 FPS no controle. O desenho do mapa consumiu p95 de 1,8 ms vs 1,5 ms; p95 do intervalo de frame chegou a 166,7 ms vs 150,1 ms. É uma amostra curta sujeita a ruído e à ausência de GPU real. Não afirmar ganho ou regressão generalizável.

## Instrumentação adicionada

`src/simulation/individuals/actions.js` passa a registrar, **somente com profiler ativo**, subfases adicionais:
- `npcPreparation`: montagem de estruturas/contagens, prontidão do mundo para decidir.
- `npcPerception`: observação sensorial, já existente.
- `npcSocialIntentions`: manutenção das intenções sociais, já existente.
- `npcOtherActorWork`: atividades restantes de cada pessoa, sem percepção nem intenções.
- `npcSocietyMaintenance`: relações, comunidades, governança e reprodução.

A contagem total ainda inclui o custo do contexto de índices e overhead do instrumento. Nenhuma fase é desligada automaticamente: precisamos medir antes de mexer em economia, política ou decisões de IA.

## Próxima intervenção de desempenho

1. Obter novas amostras por subfase com 100, 500 e 5.000 personagens, 3+ seeds, warm-up e repetição.
2. Se predominar `npcOtherActorWork`, investigar consultas repetidas/ordens/ações/colisões de cada NPC e introduzir índices/atualizações dirigidas por eventos.
3. Se predominar `npcSocietyMaintenance`, limitar buscas `O(n²)` e atualizar apenas relações modificadas, sem apagar relações ou consequências.
4. Comparar mesma seed antes/depois com hashes iguais para otimizações puras; se mudar a política de IA, comparar desempenho **e** qualidade econômica/política/militar em seeds reservadas.
5. Só depois decidir se a renderização exige PixiJS. 144 FPS requer p95 compatível com ~6,94 ms em monitor e GPU-alvo.

Os números não são promessa de 144 FPS, e CPU de Node não substitui profiler gráfico.
