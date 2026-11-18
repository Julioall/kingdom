# PR #138: validação longitudinal e de escala dos NPCs híbridos

Este PR **não altera as decisões** dos NPCs. Acrescenta auditoria e comparação reprodutíveis antes de qualquer otimização de `chooseBuildSite` e `reachableAreaAround`.

## Execução

```bash
# Validação de escala, com tempo de simulação por dia, métricas econômicas e hashes
npm run bench:npc-scale -- --populations=100,500,1000 --seeds=1,42 --days=2 --repeats=2

# Testes prolongados, custos maiores; modelos de mundo completos
npm run bench:npc-scale -- --populations=100 --seeds=42 --days=30 --repeats=2
npm run bench:npc-scale -- --populations=100 --seeds=42 --days=90 --repeats=2
npm run bench:npc-scale -- --populations=100 --seeds=42 --days=180 --repeats=2

# Escala solicitada: 5000 atores com TODOS os sistemas híbridos habilitados
npm run bench:npc-scale -- --populations=5000 --seeds=42 --days=1 --repeats=2 --modes=hybrid

# Medições independentes da simulação visual e física:
npm run bench:render-worker -- --npc-behaviors=legacy,hybrid --repeats=2 --duration=3500
```

A saída padrão do primeiro comando fica em `out/npc-scale-longitudinal.json`. Todos os comandos aceitam `--output=...`.

## O que é medido

Cada `stepDay(world, {includeSnapshot:false})` é cronometrado sozinho. **Fora da seção cronometrada**, a auditoria mede:

| Categoria | Métrica e interpretação |
|---|---|
| Custos de CPU | Média, p50, p95, p99 e máximo do tempo de cada dia simulado |
| Memória/GC | Pico observado de heap/RSS e eventos de GC disparados durante o passo (observação aproximada de eventos do V8) |
| Sobrevivência | Vivos, energia, hidratação, saúde, reserva de alimento, atores em risco |
| Economia | Estoque alimentar comunitário, construções completas e pendentes, trocas e atribuições ativas, pausadas e vencidas |
| Conclusão de tarefas | Novas estruturas concluídas e tarefas registradas como `concluída` no histórico comunitário |
| HFSM | Distribuição de etapas e estados, interrupções e retomadas observadas, mudanças diárias de ação |
| Movimento | Atores com rota ativa ou congestionada, dias bloqueados, detours, cache hits, solicitações de passagem e dias parado **com rota ainda pendente** |
| Política militar | Soldados vivos/em campanha, ataques, ataques bem-sucedidos e conflitos; atividades podem ser zero em cenários sem guerra |

**Não inventar precisão:** o histórico de atribuições é uma fila limitada, portanto completions observadas podem ser inferiores às reais. Um agente parado com rota ativa **não necessariamente está travado**, pois energia, ordens e estado do mundo também afetam o movimento. As amostras de GC dependem dos eventos disponibilizados pelo V8.

## Determinismo

O benchmark alterna a ordem das execuções legado/híbrido a cada repetição. Em cada combinação `seed + população + modo` exige:

1. Hash autoritativo igual no fim de todas as execuções;
2. Hash de métricas comportamentais diárias idêntico;
3. Hash autoritativo igual em checkpoints (`--checkpoint-every=N`), sempre fora dos tempos de simulação.

**Divergir entre legado e híbrido é permitido**, já que a política foi alterada intencionalmente. A auditoria não exige que o híbrido tome as mesmas decisões, apenas que seja determinístico e que o relatório evidencie as consequências. Falhas numéricas ou desaparecimento total de personagens vivos interrompem a execução.

A semelhança de hash de snapshots é uma condição forte de replay, mas não demonstra que todas as decisões sejam socialmente satisfatórias ou que guerras tenham sido exercitadas.

## Worker separado do Canvas

`scripts/profile-render-worker-browser.mjs` agora aceita `--npc-behaviors=legacy,hybrid` e executa, para cada modo:

- `renderOnly`: simulação pausada com Canvas e RAF em execução;
- `workerAndRender`: mundo avançando no Worker junto da apresentação.

Registra RAF/FPS, intervalos p95, tempo de desenho, `workerTiming.simulationMs`, `captureMs`, ida-e-volta e fases internas da simulação. Os resultados por modo e cenário são emparelhados por repetição e seed fixa; **não subtraia FPS de modos diferentes como se isso isolasse o custo do Worker**.

O Chromium headless de CI usa SwiftShader. Seus FPS não são uma confirmação de 144 FPS em GPU real, nem medem a conclusão de renderização GPU. Use headful com aceleração real para aceite de desempenho.

## GitHub Actions

O workflow `.github/workflows/npc-hybrid-scale-validation.yml` executa quatro jobs:

- Escala: 100, 500 e 1.000 NPCs, seeds 1 e 42, dois dias, dois replays por modo;
- Longitudinal: 100 NPCs, seed 42, **30, 90 e 180 dias** em todas as PRs, dois replays de cada modo, com três relatórios; `workflow_dispatch` permite repetir apenas um horizonte;
- Estresse: 5.000 NPCs **híbridos**, seed 42, um dia e dois replays completos; sem recorrer ao modo legado do V3;
- Navegador: quatro cenários (legado/híbrido × simulação pausada/ativa), em dois pares de repetições, com artefatos separados.

Os relatórios em JSON ficam armazenados como artefatos GitHub Actions por 14 dias. Os jobs são independentes, de modo que um gargalo gráfico não mascara um problema de qualidade da HFSM.

## O que vem depois

Só após examinar esses relatórios faz sentido abrir o PR posterior voltado a `chooseBuildSite` e `reachableAreaAround`, exigindo A/B de mundos iguais antes/depois, testes de escolha de terreno, rotas e paridade e benefício sustentado na simulação completa.

**144 FPS permanece meta em aberto.** Este PR mede onde está o custo e se a autonomia se sustenta, não reivindica que já resolveu desempenho de GPU ou uma civilização de 5.000 agentes ao longo de 180 dias.
