# Arquitetura atual do Reinos Vivos

## Visão geral

O jogo é um monólito modular executado no navegador. Vite serve a aplicação por HTTP e empacota o worker da IA; TypeScript valida a interface pública da simulação. A renderização usa Canvas 2D.

```text
index.html
└─ src/app/bootstrap.ts
   └─ src/ui/game.js                  tela, controles, desenho e inspeção
      ├─ src/app/session.ts           mundo, pausa, velocidade e reinício
      ├─ src/app/simulation-loop.ts   relógio de apresentação
      ├─ src/simulation/index.ts      comandos e interface pública
      │  ├─ src/simulation/engine.js  fachada dos módulos atuais
      │  └─ src/simulation/systems.js ordem diária da simulação
      └─ src/ai/                     decisão local opcional em worker
```

## Fonte de verdade

`createWorld(config, seed)`, `stepDay(world)` e `dispatchCommand(world, command)` estão expostos em `src/simulation/index.ts`. O estado do mundo guarda pessoas, animais, comunidades, reinos, estruturas, regiões, estoques, eventos e o estado do gerador aleatório. Os IDs são incrementais dentro de cada mundo.

O cenário inicial atual usa um mapa de 96 × 96 células e dois reinos. Cada reino começa com 25 moradores, um governante, castelo, vila, mercado, centro militar, curral, casas, quatro torres e dois soldados. As torres e castelos definem a propriedade territorial; terras sem dono continuam comuns. Destruir uma torre remove sua influência e recalcula o domínio imediatamente.

## Ordem de atualização diária

`src/simulation/systems.js` coordena a passagem do tempo; cada regra permanece no módulo responsável.

1. **Ambiente:** clima, desgaste das estradas, solo e água, plantas e animais.
2. **Território:** atualiza a propriedade antes de os moradores tomarem decisões.
3. **Sociedade:** moradores atendem necessidades, agem, mantêm vínculos e atualizam comunidades.
4. **Recursos e mercado:** troncos soltos e matéria orgânica são atualizados; preços do mercado são recalculados a cada 30 dias.
5. **Fechamento do dia:** avança o calendário, recalcula o território após as ações, resolve incursões e registra o resumo mensal.

`tick(world, days)` apenas repete `stepDay`; o relógio visual da interface fica em `src/app/simulation-loop.ts` e não altera regras do mundo.

## Limites entre módulos

- `simulation/world/` cria o mapa, consulta células e controla trilhas, território e pressão local de atividade humana.
- `simulation/ecology/` atualiza clima, água, plantas, decomposição e animais. Árvores e arbustos crescem menos e perdem biomassa gradualmente perto de povoados, estruturas habitadas, trilhas e estradas.
- `simulation/individuals/` cuida de percepção, movimento, necessidades, ações, reprodução e memória.
- `simulation/society/` mantém comunidades, vínculos, liderança e tarefas delegadas.
- `simulation/settlements/` organiza construção comunitária; `simulation/kingdoms/` mantém reinos, território, estruturas, recrutamento e patrulhas.
- `simulation/economy/inventories.js` concentra débito e transferência dos estoques no formato `{ stock }`.
- `simulation/engine.js` reúne as interfaces históricas ainda usadas pela interface. A UI deve chamar a API pública ou consultas, sem alterar regras diretamente.
- `ai/local-engine.js` e `ai/llm.worker.ts` oferecem decisões WebLLM opcionais; as redes individuais continuam como controlador local.
- `legacy/`, `kingdom-sim.js` e `kingdoms.js` não são o ponto de entrada ativo.

## Renderização e assets

- Os PNGs originais Tiny Swords ativos não são recomprimidos nem substituídos. O Canvas preserva o backing 2048 × 2048 para desenhar a grade lógica 1024 × 1024 com nitidez de pixel art.
- O terreno e as plantas ficam em uma camada de fundo em cache, atualizada quando o dia ou a camada de visualização muda.
- O mapa copia e redesenha somente a parte visível da câmera. A coleta e ordenação dos objetos considera a área visível com margem para copas e construções que passam das células de origem.
- Árvores, arbustos, minérios, troncos, cercas e estruturas são preparados uma vez por dia e invalidados após comandos de construção. Pessoas e animais continuam sendo atualizados a cada quadro.
- As paletas das duas cores de reino iniciais carregam na entrada; cores adicionais do Tiny Swords são carregadas quando aparecem.

## Limites atuais

O mercado atualiza preços, mas ainda não executa uma economia completa de produção, compra, venda, impostos ou comércio entre reinos. Soldados podem ser recrutados e patrulham rotas seguras do próprio reino; combate entre exércitos e destruição automática de estruturas em guerra ainda não existem. A IA local não aconselha reis. Salvamento versionado em IndexedDB e migrações de estado também não estão implementados.

## Ampliar para quatro reinos

`INITIAL_KINGDOM_COUNT` em `src/simulation/kingdoms/initialization.js` permanece em `2`. Só aumentá-lo depois de revisar posicionamento, torres, casas, água, estoques e legibilidade visual no mapa inteiro.
