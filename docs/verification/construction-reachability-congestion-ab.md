# Otimização controlada: locais de obras, área alcançável e congestionamento

## Escopo

O perfil de NPCs mostrou peso alto de `chooseBuildSite` e `reachableAreaAround`. Esta intervenção busca **diminuir custo sem alterar decisões**; não modifica Utility AI, HFSM, Steering/Boids, A*, economia, deslocamento ou prioridades militares.

### `chooseBuildSite`

A pontuação de um terreno é independente da disponibilidade de postos de trabalho e do preenchimento de alcançabilidade. Antes, cada candidato que sobrevivia aos filtros de recurso executava `constructionWorkPositions`, e possivelmente checagens de alcance, **mesmo quando sua pontuação não superava a do melhor candidato**.

Agora o score é calculado antes dessa etapa custosa. O candidato é descartado se `!(score > bestScore)`. A comparação **estrita** e a ordem original de visita do mapa permanecem, preservando o desempate no primeiro terreno. Todos os filtros de terreno, biomassa, propriedade, recursos e estruturas permanecem em vigor para candidatos competitivos; nenhum novo local é permitido.

### `reachableAreaAround`

O BFS original construía um array de células candidatas, um `Set` de células permitidas e um `Set` de visitadas, com milhares de números e hashes no mapa completo.

O novo BFS marca permitido e visitado em `Uint8Array` do tamanho da grade. A escolha da célula inicial continua varrendo y antes de x, e as oito direções do BFS continuam na mesma ordem. O cache local de colisões/território (`passability`) ainda é recalculado por invocação, impedindo que mudanças de construção, plantas, elevação e permissões causem dados obsoletos.

**Não** foi introduzido cache interdiário ou entre builders. Tal cache exigiria invalidação simultânea por recursos, território, corrals, estruturas, entidades e mudanças no movimento.

## Diagnóstico de congestionamentos em 5.000 NPCs

O registro `person.navigationCongestion` não é a prova de um impasse permanente. O novo auditor `inspectNpcCongestion` observa, fora do custo de `stepDay`:

- Registros do **dia corrente** vs registros antigos;
- Duração registrada (1, 2, 3–5 ou 6+ dias), distância entre o ponto de origem registrado e a posição atual e data da próxima tentativa de rota;
- Se a **próxima célula da rota** está ocupada por outro NPC na grade arredondada (heurística, não colisor físico exato);
- Papel e última atividade dos agentes com congestionamento;
- Rotas que perderam próximo passo válido.

Executamos três dias com 5.000 NPCs híbridos **duas vezes** para distinguir bloqueio transitório de bloqueio recorrente e confirmar hashes diários exatos. Os dados são apenas observação. Este PR não modifica o protocolo de cedência de passagem, congestionamento persistente ou formações militares.

## Comparação A/B

O workflow `.github/workflows/npc-construction-reachability.yml` usa checkouts de **baseline e candidato** na mesma máquina:

1. 100, 500 e 1.000 NPCs, seeds 1/42, ambos os modos, dois dias e duas repetições. Compara cada checkpoint de snapshot e hash final, além do custo total `stepDay`.
2. 5.000 NPCs híbridos, seed 42, um dia, duas repetições **por revisão**. Compara baseline/candidato, não apenas repetições do candidato.
3. 5.000 NPCs híbridos por três dias, duas repetições, para diagnosticar persistência do congestionamento.

Como adicionamos novos campos *apenas ao relatório de observabilidade*, seus hashes de métricas entre revisões não precisam coincidir; os **hashes autoritativos do mundo** precisam coincidir integralmente.

```bash
node --test tests/buildsite-reachability-optimization.test.mjs \
  tests/buildsite-pruning.test.mjs tests/npc-congestion-diagnostics.test.mjs \
  tests/npc-revision-comparison.test.mjs

# Benchmark independente:
npm run bench:npc-scale -- --populations=5000 --seeds=42 \
  --days=3 --repeats=2 --modes=hybrid
```

Cada resultado A/B deve incluir população, seed, revisão, checksum, tempo por dia e variação de CPU; melhorias de poucas porcentagens num runner isolado ainda exigem reexecução. O p95 do RAF e o throughput do Worker permanecem métricas distintas, e nenhum resultado de Node/V8 é prova de 144 FPS com GPU.

## Critérios de aceite

- **Obrigatório:** paridade exata V2 e A/B entre revisões (100–5.000 NPCs), testes e build aprovados; locais de obra e ordem de BFS preservados.
- **Desejável:** economia consistente no tempo total por dia (não apenas `reachableAreaAround` isolada); sem regressões repetidas de CPU/GC.
- **Diagnóstico:** distinguir congestionamentos que persistem de registros passageiros e reunir evidências para uma futura intervenção específica em passagem e rotas.
- **Sem alegar:** 144 FPS atingidos, desempenho de GPU validado, congestionamentos resolvidos sem testes correspondentes.
