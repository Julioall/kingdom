# Arquitetura do Kingdom

## Visão geral

O jogo é um monólito modular executado no navegador. Vite serve a aplicação por HTTP e empacota o Worker de simulação e o Worker opcional da IA; TypeScript valida os contratos públicos. A renderização usa Canvas 2D. O Worker de simulação é dono do mundo e executa os dias e comandos; a thread principal mantém uma projeção serializável para desenho e inspeção. As medições do cenário padrão estão em [baseline.md](./baseline.md) e o contrato está em [worker-protocol.md](./worker-protocol.md).

```text
index.html
└─ src/app/bootstrap.ts
   └─ src/ui/game.js                  tela, controles, desenho e inspeção
      ├─ src/app/session.ts           cliente do Worker, época, revisão e relógio
      ├─ src/app/simulation-loop.ts   relógio de apresentação
      ├─ src/simulation/simulation.worker.ts dono do estado mutável
      │  ├─ src/simulation/worker-runtime.js protocolo e dispatch serial
      │  ├─ src/simulation/render-snapshot.js projeção e colunas transferíveis
      │  ├─ src/simulation/engine.js + systems.js motor e ordem diária
      │  └─ src/simulation/kingdoms/strategy.js relatório e plano determinístico por reino
      └─ src/ai/                     coordenador e adaptador do serviço Ollama
```

## Fonte de verdade

`src/simulation/worker-runtime.js` cria e mantém o estado mutável do mundo. `createWorld(config, seed)`, `stepDay(world)` e `dispatchCommand(world, command)` ficam na camada de simulação e só são usados pelo Worker. `GameSession` envia pedidos versionados; a interface lê um snapshot que não pode voltar como input do motor. O estado do mundo guarda pessoas, animais, comunidades, reinos, estruturas, regiões, estoques, eventos e o estado do gerador aleatório. Os IDs são incrementais dentro de cada mundo.

O cenário inicial atual usa um mapa de 128 × 128 células e dois reinos. Cada reino começa com 25 moradores, um governante, castelo, vila, mercado, centro militar, curral, casas, quatro torres e dois soldados. As torres e castelos definem a propriedade territorial; terras sem dono continuam comuns. Destruir uma torre remove sua influência e recalcula o domínio imediatamente.

`simulation/world/island-terrain.js` gera uma massa terrestre determinística inspirada na Groenlândia: eixo norte–sul, costa irregular, paletas por latitude, oceano ao redor e dois lagos interiores. Uma elipse compacta gera um único platô e usa a composição de topo, parede sul e rampa 1 × 2 do AutoTile. O roteador bloqueia travessias entre os níveis sem uma rampa válida e evita retornar imediatamente ao tile anterior quando um desvio contorna uma barreira.

## Ordem de atualização diária

`src/simulation/systems.js` coordena a passagem do tempo; cada regra permanece no módulo responsável.

1. **Ambiente e território:** clima, desgaste das estradas, solo e água, plantas, animais e propriedade territorial para as decisões do dia.
2. **Preparação militar:** converte guerras com evidência e um local conhecido em campanhas; mobiliza e abastece as forças.
3. **Sociedade:** moradores atendem necessidades, agem, mantêm vínculos e atualizam comunidades; soldados seguem ordens e consomem rações de campanha.
4. **Resolução militar:** avalia abastecimento, marcha, bloqueios, confrontos, perdas, ocupação e retirada.
5. **Recursos e mercado:** troncos soltos e matéria orgânica são atualizados; preços e manutenção de fortificações são calculados a cada 30 dias.
6. **Fechamento do dia:** avança o calendário, recalcula o território após as ações, resolve incursões e registra o resumo mensal.

`tick(world, days)` apenas repete `stepDay`; o relógio visual da interface fica em `src/app/simulation-loop.ts` e não altera regras do mundo.

## Limites entre módulos

- `simulation/world/` cria o mapa, consulta células e controla trilhas, território e pressão local de atividade humana.
- `simulation/ecology/` atualiza clima, água, plantas, decomposição e animais. Árvores e arbustos crescem menos e perdem biomassa gradualmente perto de povoados, estruturas habitadas, trilhas e estradas.
- `simulation/individuals/` cuida de percepção, movimento, necessidades, ações, reprodução e memória.
- `simulation/society/` mantém comunidades, vínculos, liderança e tarefas delegadas.
- `simulation/settlements/` organiza construção comunitária; `simulation/kingdoms/` mantém reinos, território, estruturas, recrutamento, estratégia agregada, patrulhas e campanhas.
- `simulation/economy/inventories.js` concentra adição, débito, transferência e troca atômica validados para contas `{ stock }` e estoques comunitários. Estoques de abertura são explícitos; tributos, entregas do tesouro, comércio e custos de construção passam por esses caminhos.
- `simulation/worker-runtime.js` valida o protocolo, mantém a época atual e serializa comandos, avanços, consultas e decisões de IA.
- `simulation/render-snapshot.js` transfere as colunas espaciais em buffers tipados, incluindo altitude, variante visual, tipo de água e marcadores de rampa, e hidrata uma projeção reutilizável sem enviar tiles como objetos individuais.
- `ai/local-engine.js` agenda o Qwen do rei e o SmolLM2 do general pelo adaptador `ai/ollama-client.js`; `ai/ollama-service.mjs` expõe somente saúde, modelos e decisões allowlistadas e se vincula a `127.0.0.1`. Uma inferência é executada por vez, com fila limitada, cancelamento, prioridade e deduplicação. Os pedidos de rei e general carregam identidade, época, agente, campanha, versão da ordem, validade, fatos observados e ações permitidas. O general propõe avançar, manter posição ou retirar uma campanha existente; não pode criar guerras, alvos ou recursos. O Worker valida tudo de novo antes de aplicar e registra pedido, proposta, rejeição ou efeito em histórico limitado; em falhas, as regras determinísticas assumem. Rei e general continuam experimentais. Cada lado de campanha também recebe uma formação determinística em linha ou coluna com postos individuais; coesão altera força e exposição a baixas e aparece no inspetor e no histórico de batalha. Essa referência ainda não passou pela matriz de validação T2; comandante autônomo e redes militares comparativas não estão conectados. As redes individuais continuam controlando os moradores.
- O ponto de entrada ativo é único: não há um segundo simulador mantido fora de `src/simulation/`.

## Renderização e assets

- Os sprites Tiny Swords otimizados usados pelo jogo ficam em `public/assets/tiny-swords/`; os atlas de terreno e a textura estática de água do AutoTile ficam em `public/assets/kingdom-autotile/`. A renderização usa água repetida sob o terreno, base gramada, paredes de penhasco, rampas e topos elevados. A espuma animada e os overlays climáticos por região não são desenhados. A interface do editor e seu formato JSON não entram no runtime; a nota de origem e distribuição está junto aos assets.
- Os oito sprites oficiais de nuvens ficam em `public/assets/kingdom-clouds/`. `src/ui/cloud-system.js` mantém uma distribuição determinística com vento contínuo, desenha máscaras de sombra alinhadas à câmera e reduz gradualmente a opacidade atmosférica conforme zoom e proximidade. As sombras e nuvens são camadas visuais independentes da simulação; o fundo de água repetida também preenche a área do canvas fora do mapa quadrado.
- O Canvas preserva o backing 2048 × 2048 para desenhar a grade lógica 1024 × 1024 com nitidez de pixel art.
- O terreno e as plantas ficam em um fundo em cache, invalidado quando muda o dia, o conjunto visual ou a câmera.
- A influência territorial de uma torre concluída aparece somente enquanto o cursor está sobre ela.
- O mapa copia e redesenha somente a parte visível da câmera. A coleta e ordenação dos objetos considera a área visível com margem para copas e construções que passam das células de origem.
- Árvores, arbustos, minérios, troncos, cercas e estruturas são preparados uma vez por dia e invalidados após comandos de construção. Pessoas e animais continuam sendo atualizados a cada quadro.
- As paletas das duas cores de reino iniciais carregam na entrada; cores adicionais do Tiny Swords são carregadas quando aparecem.

## Limites atuais

O mapa atual tem 128 × 128 células; as medições anteriores de throughput em 96 × 96 são históricas e não representam a escala nova. Consulte [baseline.md](./baseline.md) para os resultados atualizados. O cenário 288 × 288 ainda não foi medido. A estratégia usa reservas e ativos agregados para delegar tarefas civis, escolher patrulha e responder a relatórios militares conhecidos. Qwen para o rei e SmolLM2 para o general compartilham o serviço Ollama local, com uma inferência global por vez; decisões e falhas passam por validação no Worker e ambos os papéis seguem experimentais. Campanhas usam ordens versionadas e formações determinísticas por lado: soldados ocupam postos individuais em linha ou coluna, e coesão participa da força e da exposição a baixas. A implementação de formação também é experimental e ainda não passou pela matriz T2 nem por replays finais de 730 dias. Campanhas M4 exigem causa e local conhecido, retiram recursos do tesouro, mantêm rações de campo, podem gerar confrontos, baixas, recuos, ocupações e tratados. Fortificações perdem influência quando a manutenção de madeira e pedra não é paga. Essa cobertura ainda está em andamento: falta validar campanhas emergentes ao longo de um ano, logística em rotas extensas, cercos e dano a estruturas. O mercado calcula oferta, demanda e preços agregados, permite compras e vendas limitadas por estoque e ouro, barter restrito por materiais e recolhe impostos apenas sobre excedentes protegidos. Comerciantes caminham até o posto antes de transacionar. No checkpoint anterior de sobrevivência, os replays de 500 dias nas sementes 1, 42, 987 e 2026 terminaram com zero mortes em todas as causas e, respectivamente, 52/32, 51/31, 51/28 e 50/30 pessoas/animais vivos. No replay agrícola atual de 730 dias, seed 42 terminou com nove mortes globais por fome e seed 2026 com três; os dois tiveram projetos de roça incompletos. No seed 42, as reservas comunitárias e os tesouros do checkpoint anterior terminaram sem alimento e cada mercado com 6 após 12 transações. Esses resultados não validam por si só a sustentação econômica em longo prazo. Forrageamento delegado entrega coletas ao armazém. A batalha resolve efeitos sobre pessoas, mas ainda não danifica estruturas. Salvamento versionado em IndexedDB e migrações de estado também não estão implementados.

## Ampliar para quatro reinos

`INITIAL_KINGDOM_COUNT` em `src/simulation/kingdoms/initialization.js` permanece em `2`. Só aumentá-lo depois de revisar posicionamento, torres, casas, água, estoques e legibilidade visual no mapa inteiro.
