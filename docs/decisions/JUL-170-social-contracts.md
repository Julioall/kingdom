# JUL-170 — contratos de eventos, memória e procedência social

Data: 26/10/2026
Issue: [JUL-170](https://linear.app/julio-alves/issue/JUL-170)
Baseline pré-contrato: `22253bfcda0f278c2bd16d87827a270c63e56ff1`
Implementação S0: contrato local em revisão nesta branch

## Pergunta e diagnóstico

Como separar o que aconteceu no mundo do que cada morador viu ou ouviu sem transformar a crônica em conhecimento compartilhado? O estado atual registra textos em `world.events` e `world.chronicle`; a confiança de `socialLinks` também cresce pela proximidade. Esses dados não distinguem fato, testemunha, relato e interpretação pessoal. S0 não altera comportamento: estabelece o contrato antes de ligar memórias às decisões.

## Fontes e limites

* SciSpace encontrou Chen, Plale e Evans, [Dependency Provenance in Agent Based Modeling](https://doi.org/10.1109/ESCIENCE.2013.39) (IEEE e-Science, 2013). O resumo descreve proveniência de indivíduos/interações e consultas de causa e efeito. Isso apoia registrar referências verificáveis; não determina a estrutura de estado nem coeficientes do Kingdom.
* SciSpace encontrou Davis, Featherston e Vo, [Data Provenance for Agent-Based Models in a Distributed Memory](https://doi.org/10.3390/informatics5020018) (Informatics, 2018). O resumo relata configuração de proveniência para explicar coordenação e limitar custo/armazenamento. Isso apoia limites de retenção mensuráveis, sem provar que os números escolhidos são ideais.
* SciSpace encontrou Gervás e Méndez, [An Embodied, Affect-Driven Multi-Agent Social Simulation as a Log Generator for Computational Narrative Tasks](https://doi.org/10.3390/app16168218) (Applied Sciences, 2026). O resumo registra quem estava presente para testemunhar eventos. A escolha do Kingdom exige validar testemunhas pela percepção do jogo, não apenas por co-localização.
* Game Studio recomenda preservar o Worker como dono da simulação e não misturar política, renderização e texto. Consensus foi tentado, mas a cota continua indisponível até 01/11/2026. A chamada Linear “get_agent_context” retornou `Tool get_agent_context not found`; segui com a descrição vigente da issue, inspeção local e evidência reproduzível.

## Alternativas e decisão

| Alternativa | Vantagem | Limite | Decisão |
| --- | --- | --- | --- |
| Reutilizar a crônica textual como memória compartilhada | Nenhum novo esquema | Vaza fatos a todos, não preserva testemunha/fonte e é uma projeção limitada | Rejeitada |
| Guardar fatos e opiniões no vínculo simétrico | Pouco estado novo | Confunde familiaridade, confiança, crença e experiência de cada pessoa | Rejeitada |
| Fatos estruturados do mundo e memórias explícitas por pessoa | Procedência verificável, transmissão local e deduplicação | Ainda não altera ações; S1 deverá acrescentar crenças/revisão | Escolhida para S0 |

Os contratos versionados estão em `src/simulation/society/social-evidence.js`: fato social, memória, crença, relação dirigida, compromisso e intenção. Os fatos ficam no registro do mundo; uma pessoa recebe memória somente ao ser listada como testemunha, ou quando uma fonte que já sabe o fato transmite o relato. Crenças e relações só citam evidências presentes na memória do observador. Relações mantêm direção e campos distintos para familiaridade, confiança, afinidade e receio. IDs incluem seed, `simulationEpoch` do Worker e sequência determinística (época 0 em fixtures fora do Worker). Uma chave de idempotência é obrigatória para fato e proposta de compromisso; repetição igual retorna o mesmo registro e reutilização conflitante falha. Os registros aceitam apenas referências conhecidas e dados JSON finitos; fatos e memórias retornados não podem ser alterados pelo chamador.

Retenção inicial, como limite operacional experimental de S0/S1: até 365 dias de fatos, até 32 memórias por pessoa e até 512 fatos no mundo. Os orçamentos de S1 limitam ainda a 16 relações detalhadas e 3 intenções ativas por pessoa. A poda ocorre ao registrar fato/memória: remover memórias fora da janela/limite, preservar fatos ainda referenciados e expirar memória de fatos mais antigos se o limite global exigir. A crônica visual permanece separada. A escrita de fatos não altera estoque, atributo, confiança ou ação. Esses limites são hipóteses para medir, não capacidades validadas.

O bônus atual de confiança por proximidade em `updateSocialLinks` permanece durante o baseline. Ele representa confiança, não será renomeado como familiaridade neste contrato. A migração futura exigirá comparação pareada de confiança, adesão/cohesão e mudanças econômicas; não está incluída em S0.

## Baseline anterior à mudança

Comando: `npm run audit:social -- --days 30 --seeds 1,42,987,2026 --repeat-seed 42 --output docs/verification/JUL-170-social-baseline-30d-20261026.json`. Configuração: `createWorld(seed)` + `stepDay({includeSnapshot:false})`, mundo de 128×128, 30 dias sem comandos ou choque. Runtime Node v24.19.0, Windows x64. A mesma seed 42 repetiu estado completo e crônica (`e0967aff…`, `e32936bd…`). Os snapshots finais e hashes estão no JSON.

| Seed | Vivos | Mortes | Necessidade social média | Vínculos / encontros | dias/s | p95 do passo (ms) | heap final (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 97 | 0 | 69,97 | 547 / 2.954 | 4,22 | 472,55 | 155,9 |
| 42 | 97 | 0 | 74,94 | 569 / 2.995 | 3,86 | 489,09 | 159,9 |
| 987 | 97 | 0 | 74,85 | 515 / 2.556 | 5,10 | 451,71 | 182,2 |
| 2026 | 97 | 0 | 73,10 | 577 / 2.919 | 5,25 | 374,31 | 319,6 |

Os tempos e heap são medições de processo e variam com GC e carga do host; usar comparação no mesmo ambiente antes/depois, não como garantia de escala. Esse baseline é descritivo: quatro seeds e 30 dias não satisfazem os 30 cenários de calibração/30 de holdout propostos para avaliação social prolongada.

## Validação desta fatia

`node --test tests/social-evidence.test.mjs`: 11/11. Cobertura: isolamento fato/memória, testemunha e fonte de relato, referências apenas a entidades/pessoas válidas, idempotency key obrigatória, IDs isolados por época, deduplicação, imutabilidade, retenção/limites automáticos, crenças baseadas em evidência local, relação dirigida sem mutar o outro lado, proposta de compromisso sem débito antecipado e intenção com passos/condição explícitos.

O baseline foi repetido após a implementação com o mesmo comando e salvo em `docs/verification/JUL-170-social-contracts-30d-20261026.json`. Estado e crônica foram idênticos nas quatro seeds; população, vínculos e encontros também coincidiram exatamente. A repetição da seed 42 continuou determinística. Throughput observado: 4,35/3,89/5,11/5,06 dias/s, contra 4,22/3,86/5,10/5,25; p95: 465,69/483,75/433,95/385,48 ms, contra 472,55/489,09/451,71/374,31. A variação de medição é ruído do host; não houve custo de simulação observável. Esse teste confirma o contrato isolado e a ausência de regressão, não o uso dos registros em decisões. S1 ainda deverá conectar os registros a eventos reais e demonstrar leitura/atualização de crenças sem vazamento global.
