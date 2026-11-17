# Kingdom: cache de geometria de estruturas e alvos de treino

## Problema

`worldCollisionIndex(world)` chama `structureCollisionIndex(world)` durante colisões, movimento, planos de construção e rotas. Mesmo quando um edifício não mudou, a implementação anterior executava em cada chamada:

1. `structureHitbox` para todos os edifícios, inclusive resolução de perfis e polígonos;
2. `trainingDummiesForWorld`, recriando três alvos de treinamento por conjunto militar;
3. alocação de arrays de hitboxes e comparação profunda com o cache anterior.

O índice espacial em si já era reutilizado. O custo redundante acontecia **antes** da decisão de reaproveitá-lo.

## Alteração

`src/simulation/physics/structure-source-snapshot.js` captura uma representação **de runtime** das fontes de colisão e permite comparar os campos relevantes sem alocar novos hitboxes.

Cada chamada ainda verifica as fontes, em tempo proporcional ao número de estruturas, mas evita conversão, alocação, geometria e cálculo de alvos quando os dados estão estáveis. Não é uma cache cega por dia.

Dados monitorados:
- Identidade e ordem de cada estrutura, `id`, `type`, `x`, `y`, `kingdomId`, `spriteKey`.
- `complete`, `destroyedDay`, condição de `progress > 0`.
- Dimensões, offsets, habilitação e **conteúdo dos pontos** de hitboxes personalizados, inclusive mudanças in-place.
- Identidade/ordem dos reinos, seu `id` e `palette`, que determinam a localização dos alvos de treinamento.

Dados que **não** exigem reconstrução: saúde de uma estrutura que não modifica a geometria, progresso de obra depois que o hitbox já passou a existir, ou dano/vida dos alvos de treino sem deslocamento físico.

`structureCollisionIndex(world)` utiliza esse verificador antes de reconstruir o índice e mantém a comparação anterior de hitboxes como segunda barreira. O cache é mantido em `WeakMap`, **fora** da simulação autoritativa, do snapshot e dos saves.

## Segurança e equivalência

Testes cobrem: reuso com estruturas estáveis, progressão de obra no mesmo dia, finalização, deslocamento, destruição, hitboxes personalizados com pontos alterados no próprio array, mudança de paleta que desloca alvos e reordenação de edifícios. O workflow V3 é acionado também em modificações de `src/simulation/physics/**` e de alvos de treinamento.

Alterações futuras em `structureHitbox` ou em `trainingDummiesForWorld` **devem ampliar o snapshot de fontes** quando novos campos influenciarem a geometria. Este contrato precisa ser revisado junto com essas funções.

## Escolha de tecnologia

Não foi adicionada uma biblioteca de colisão. O motor já usa índices por célula e hitboxes circulares/retangulares/poligonais em mundo 2D. Um novo framework de física alteraria tolerâncias, empates e comportamento militar, sem atacar o problema principal: a repetição do cálculo de dados invariantes. O caminho escolhido é uma verificação incremental simples, com testes de compatibilidade.

## Medição

```sh
node --test tests/structure-collision-source-cache.test.mjs
npm test
npm run typecheck
npm run build
```

A comparação autoritativa V2 e o estresse V3 com 5.000 pessoas precisam produzir **hashes idênticos** aos da `main` anterior. Benchmarks de CPU e navegador avaliam o custo líquido, não apenas a redução de alocações. A meta de 144 FPS exige ainda reduzir e desacoplar o ritmo do Worker, o tráfego de snapshots e o raster de personagens.
