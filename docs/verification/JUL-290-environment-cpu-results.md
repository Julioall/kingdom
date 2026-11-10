# JUL-290 — Perfilamento de CPU ambiental no Kingdom

**Coleta:** 09–10/11/2026 (runner Linux, Node 24).  
**Evidência:** [GitHub Actions #42742091788](https://github.com/Julioall/kingdom/actions/runs/42742091788), artefato `jul290-environment-cpu` com amostras por dia e agregação JSON.  
**Método:** `scripts/benchmark-jul290-environment-cpu.mjs`, seeds 1, 42 e 2026, 35 dias por seed (105 avanços). Para cada seed também foi executado o replay não instrumentado. **Paridade exata do WorldSnapshot completo em todos os 3 pares**, incluindo RNG, vegetação, NPCs, tiles, recursos e histórico.

## Ranking de custos ambientais

`performance.now()` cronometrado no caminho real de `stepDay` para cada etapa síncrona.

| Etapa | Média por dia (ms) | p95 (ms) | Fração do tempo total de `stepDay` |
|---|---:|---:|---:|
| Animais | 11,01 | 19,53 | 3,86% |
| Hidrologia | 5,57 | 10,15 | 1,95% |
| Vegetação (inclui limpeza diária e regeneração semanal) | 4,62 | 30,41 | 1,62% |
| Territórios após NPCs | 3,99 | 5,71 | 1,40% |
| Territórios antes dos NPCs | 3,92 | 5,12 | 1,38% |
| Estradas e pressão de uso | 3,65 | 5,04 | 1,28% |
| Decomposição e nutrientes | 2,54 | 3,76 | 0,89% |
| Clima | 2,21 | 3,33 | 0,78% |
| Manutenção de mercados e fortificações | 0,02 | 0,003 | 0,01% |
| Madeira solta | 0,004 | 0,008 | ~0% |

**Total ambiental medido:** 13,17% da duração acumulada do passo. **Outros 86,83%** vêm de sociedade/NPCs, militares, fronteiras, economia e demais operações não instrumentadas aqui. Esse ranking não prova que 86,83% sejam exclusivamente dos NPCs; é necessária medição separada.

### Eventos periódicos importam

A regeneração da vegetação **já ocorre a cada 7 dias** e apresenta média de **31,73 ms nos dias semanais**, contra **0,10 ms nos demais dias comuns** (incluindo apenas limpeza dos currais). O p95 de 30,41 ms advém desses picos. Médias diárias sem separar os tipos de dia esconderiam o custo real da regeneração.

Clima (**2,21 ms/dia**) e decomposição (**2,54 ms/dia**) são mais baratos que a fauna e a hidrologia. Não há justificativa neste perfil para transformar chuva, balanço hídrico ou decomposição em eventos de 30 dias: isso alteraria dinâmica, saldo de água, RNG, colheitas e causalidade.

Os territórios são recalculados **duas vezes** por dia; seu custo combinado foi **7,91 ms/dia**. A eliminação do segundo recálculo exige primeiro provar a ausência de mudança de construções/controle/reivindicações durante o próprio dia — ainda **não** comprovada.

## Cache mensal dos currais — teste isolado

Geometria histórica comparada contra o cache de `WeakMap` atual durante 120 chamadas em mapas sintéticos de 112×112. Todos os conjuntos de células coincidiram; 116 hits e 4 reconstruções para cada densidade.

| Currais | Média anterior (ms/chamada) | Média cache (ms/chamada) | Variação do tempo agregado |
|---|---:|---:|---:|
| 0 | 0,0012 | 0,0014 | **+12%** (sobrecusto desprezível) |
| 1 | 0,0150 | 0,0040 | **−74%** |
| 8 | 0,0790 | 0,0170 | **−79%** |
| 24 | 0,2165 | 0,1188 | **−45%** |

A melhoria percentual da geometria **não** pode ser tratada como ganho de FPS ou mesmo de CPU do mundo completo: economiza geralmente centésimos de milissegundo por chamada e o processo ambiental inteiro corresponde a ~13% do passo. Com nenhum curral, a assinatura do cache adiciona custo mínimo.

## Prioridades técnicas baseadas na medição

1. **Fauna (11,0 ms/dia):** medir custos internos de percepção, procura de alimentos, deslocamento e rede neural antes de alterar frequência de atualização; metabolismo e movimento permanecem diários.
2. **Territórios (7,9 ms/dia):** investigar possibilidade de invalidar/recalcular por eventos que de fato mudam a posse, sem pular o recálculo após construção/comando militar.
3. **Vegetação (31,7 ms nos dias de regeneração):** decompor crescimento/dispersão/cheques de estruturas e avaliar índices por região. O intervalo de 7 dias deve ser mantido até ter paridade.
4. **Hidrologia (5,6 ms/dia):** buscar redução algorítmica de buscas de vizinhos e agregações regionais, sem resumir a chuva ou o ciclo de água mensalmente.
5. **Tempo não ambiental (86,8%):** ampliar profiler para subsistemas sociais/combate e Worker antes de atribuir gargalo à ecologia.

## Limites da evidência

São tempos de **parede de rotinas síncronas em Node/Linux**, indicadores de custo de CPU, e não amostras do profiler nativo de CPU, medições de GPU ou FPS do navegador. O runner é sujeito a ruído de escalonamento/GC. Os replays instrumentados e não instrumentados são determinísticos, mas o tempo de um par de execuções **não constitui A/B de desempenho**. Os próximos resultados devem incluir Chrome com aceleração gráfica na máquina de homologação, p95 de frame, heap e long tasks.

**Decisão:** nenhuma outra cadência ambiental foi reduzida nesta rodada; o cache de geometria dos currais continua válido e seu ganho fica restrito à operação isolada. A `main` permanece intocada.
