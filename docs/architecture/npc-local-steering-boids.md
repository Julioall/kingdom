# Steering / Boids local no Kingdom

O Kingdom opera em grades discretas e utiliza A* com rotas memorizadas, preferências por estrada, terreno, penhascos, recursos, cercas de curral, fronteiras e colisões de NPCs. Um motor contínuo de física não substitui essa camada.

A implementação experimental **`world.neuralOverrides.steeringBoids = true`** adiciona dois usos de movimento local, sem mexer no simulador gráfico:

1. **Ovelhas**: quando há vizinhos próximos, aplica separação, alinhamento e coesão ponderados para selecionar **um tile já aprovado por `canStep`**. Evita escolher a célula ocupada por outra ovelha. O rebanho não atravessa rochas, cercas, entradas proibidas ou terreno inclinado. O acompanhamento de ovelha conduzida pelo pastor continua usando os offsets e os limites já existentes.
2. **Humanos**: apenas após a passagem negociada e o desvio BFS local terem falhado, Steering pode propor uma célula adjacente legal para contornar congestionamentos. O passo ainda passa por `canStepFree`, incluindo bloqueio de NPC. Se não houver opção, o motor mantém a busca persistente existente.

Soldados só se alinham localmente a companheiros da **mesma campanha e reino**; coesão tem peso baixo. O destino/ordem do comandante e a rota A* continuam determinando o deslocamento, e a formação militar nunca é substituída por Boids. Civis usam apenas separação local. A função de Steering opera sobre decisões de movimento da simulação, **não** sobre cada quadro RAF.

## Escalabilidade

- Consulta pelo índice espacial existente com raio local **2,8 tiles**; processa no máximo **12 vizinhos vivos** e **8 candidatos legais**. Sem par-a-par de todos os agentes ou aleatoriedade.
- Para ovelhas, o dia animal cria um índice espacial dinâmico temporário e atualiza seu bucket após o movimento. Um `finally` restaura/remova o índice depois de `updateAnimals`. Nenhum índice é persistido ou transferido na visualização.
- Animais conduzidos e espécies não-ovelha mantêm a navegação existente.
- Se o recurso está desligado, o código de navegação permanece idêntico ao legado, sem novos indices no mundo.
- Mesmo com Steering ativo, ocupar uma célula não permitida pela navegação/colisão continua impossível.

## Testes

```bash
node --test tests/npc-steering-boids.test.mjs tests/movement-passage.test.mjs
npm test && npm run typecheck && npm run build
```

São verificadas escolhas locais com vizinhos e sem vizinhos, separação por grupo, RNG idêntico, ausência de salto, diagonal legal e rebanhos com milhares de animais distantes. A CI V2/V3 valida que o legado continua determinístico. O novo modo exige comparação entre duas simulações híbridas idênticas e indicadores de passagem/atolamento, alinhamento de soldado, movimento de rebanho e latência do Worker.

## Alternativas

Uma biblioteca de física contínua, RVO/ORCA ou sistema GPU de agentes pode ajudar no futuro, mas só depois de demonstrar vantagens sobre a grade + A* + índice hash existente, respeitando o contrato de trajetos e as políticas militares. Esta integração não adiciona dependências, nem promete 144 FPS.
