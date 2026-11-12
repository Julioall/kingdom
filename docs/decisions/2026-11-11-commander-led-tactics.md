# Kingdom — comando hierárquico de guerra (11/11/2026)

## Objetivo

General define missão e orienta as unidades; comandante de tropa é a âncora
**física** de sua formação (não um objeto invisível). Cada soldado busca um
slot local relativo ao comandante. Mantemos colisões, navegação e combate do
motor existente. As unidades já existentes comportam até dez soldados e cada
general já coordena até cinco unidades; a proposta reutiliza esses vínculos.

## Implementação experimental

- `src/simulation/kingdoms/squad-tactics.js`: planejador determinístico uma
  vez por atualização de campanha; atribui papéis por unidade, seleciona
  `column`, `line`, `wedge` ou `square` com pontuação contextual e
  histerese, orienta os slots ao destino/ameaça observada.
- Um soldado que não é comandante procura uma posição próxima à posição
  **atual** do comandante. Não traça a mesma rota longa de campanha.
- O comandante usa o sistema `moveOne` já existente; não adicionamos rede
  neural, modelo externo, nem pathfinder duplicado.
- A influência inicial mede perigo local usando no máximo 12 inimigos
  previamente observados pelo comando. Não lê tropas ocultas nem concede
  bônus de dano/armadura.
- A moral da unidade considera moral do lado, perdas observadas e vigor
  médio; moral crítica inicia retirada local em direção à guarnição.
  Sobrevivência individual continua sujeita ao combate existente.
- Na adaptação ao terreno, calculamos slots mundiais apenas para generais e
  comandantes no modo novo, evitando varrer centenas de posições por soldado.
- Sem general elegível, as unidades continuam com formação operacional de
  seus comandantes, mas sem nova decisão estratégica central.

## Alternância para comparação

Na criação do mundo:

```js
Sim.createWorld(42, { tacticalCombat: 'legacy' });       // referência existente
Sim.createWorld(42, { tacticalCombat: 'commanders' });   // âncoras reais; linha/coluna
Sim.createWorld(42, { tacticalCombat: 'hierarchical' }); // utilidade/moral/influência
```

O padrão experimental desta branch é `hierarchical`, escolhido após os testes
multissemente de 90 dias (seeds 1, 42 e 2026) como o menor p95 de CPU. Não foi
observada vitória militar conclusiva; `legacy` continua disponível para regressão.
Em mundos antigos sem
`tacticalCombat`, o sistema volta para `legacy` (compatibilidade).

`node --test tests/squad-tactics.test.mjs`

`node scripts/benchmark-squad-hierarchy.mjs --days=45 --seeds=1,42,2026 --output=out/squad-benchmark.json`

Para escolha final, verificar separadamente: formação e coesão, tempo até
objetivo, baixas, vitória, desvio de gargalos, recrutamento/suprimentos,
CPU p50/p95, memória e estabilidade determinística por seed. Não declarar
vencedor de qualidade visual ou FPS apenas com medições de Node.

## Ainda não implementado nesta branch

- Flow Field global compartilhado por multidões, A* dedicado e RVO/ORCA:
  a navegação atual usa rotas do próprio motor, com cache de caminho e
  tratamento de passagem. Introduzir só após medir gargalos com muitas
  unidades; implementar ORCA a cada soldado elevaria o custo.
- Boids completo: o alinhamento por slot e a prevenção de colisões existente
  são a primeira camada. Separação/cohesão local por vizinhos pode ser
  acrescentada atrás de feature flag e comparada em corredores.
- Grid completo de influência, busca de cobertura por linha de visão,
  flanqueamento com rota tática própria e submissão de múltiplos generais:
  atualmente há apenas deslocamento lateral de grupos e risco local.
- Fuga em massa que iniba todos os ataques de um grupo: a retirada altera
  deslocamento, sem reescrever o combate independente nesta fase.

## Segurança e transparência

O benchmark e a suíte de testes devem ser executados no repositório completo
e em navegador antes de merge para `main`. A presença deste código ou de
um relatório de benchmark ainda sem números não representa validação de FPS,
campanhas longas, paridade de saves ou superioridade tática.
