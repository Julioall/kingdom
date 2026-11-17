# Kingdom: consulta de ocupação sem ordenação em cada movimento

## Gargalo e contrato

Ao validar uma célula, `movement.js` chamava `peopleNear(...).find(...)`. O índice espacial criava uma lista de candidatos em múltiplos buckets, **ordenava todos os candidatos por ordem original de população**, convertia para um novo array de pessoas e só então testava a colisão até encontrar a primeira correspondência.

Isso gera alocações e comparações de ordenação para cada consulta do A*, tentativas de passagem, desvios locais e deslocamentos. As colisões e a permissão territorial precisam continuar com a semântica atual. A ordem original é importante: quando dois NPCs ocupam a mesma região, quem recebe o pedido de passagem deve continuar sendo o mesmo personagem.

## Otimização

`createPersonSpatialIndex(...).findFirst(x, y, raio, predicate)` percorre os mesmos buckets, sem criar e ordenar um array, e seleciona a correspondência cujo `record.order` original é menor. O predicado deve ser **puro**: sua ordem de invocação não é garantida, embora a **ordem da resposta** seja igual à de `query(...).find(predicate)`.

`firstPersonNear(world, ...)` oferece a API de conveniência: se algum mundo antigo ou teste tiver um índice sem `findFirst`, a API recua para `peopleNear(...).find(...)`. O índice temporário do dia permanece fora do estado serializado.

`movement.js` usa a nova consulta **apenas** em `personOnTile`, onde o predicado verifica o hitbox e não tem efeitos. A função mantém `null` para ausência, os pedidos de passagem, colisões e a ordem atual. A consulta de ovelhas conduzidas agora reaproveita `world.animalsById` durante a atualização de indivíduos; há fallback para o comportamento original quando o índice falta, está incompleto ou tem IDs duplicados.

## Bibliotecas e alternativas

A implementação existente já usa um *spatial hash grid* dinâmico para NPCs e um A* com filas e buffers tipados; trocar tudo por uma árvore espacial ou biblioteca de pathfinding criaria custo de reconstrução, novas dependências e risco de empates diferentes. O índice de buckets resolve consultas locais de raio fixo, que é precisamente o padrão aqui. A escolha atual é **otimizar o algoritmo nativo primeiro** e considerar uma biblioteca externa só quando um A/B de cenários autoritativos mostrar ganho real.

## Validar

```bash
node --test tests/spatial-first-match.test.mjs
node scripts/benchmark-spatial-first-match.mjs --population=5000 --queries=25000 --repeats=5
npm test
npm run typecheck
npm run build
```

A CI `Kingdom NPC occupancy query benchmark` executa 5 rodadas e publica JSON. A comparação mantém o mesmo conjunto de consultas e exige que os resultados sejam **idênticos**.

Ainda precisam passar as suítes V2/V3 do PR: estado do mundo exato entre branches com 100/500/5.000 atores, rodadas de combate/pastores e navegador. O microbenchmark isola somente a lista de candidatos, **não é medição de 144 FPS nem do tempo total por dia**.

## Próximo hotspot

`structureCollisionIndex(world)` ainda reconstrói hitboxes de todos os edifícios a cada consulta antes de confirmar que a geometria está inalterada. É uma hipótese de custo importante, mas qualquer cache deve detectar alterações de obra, destruição, deslocamento, hitboxes personalizados e alvos de treino durante o mesmo dia. **Não** usar um cache por dia sem invalidação, pois tornaria estruturas atravessáveis ou bloqueios inexistentes.
