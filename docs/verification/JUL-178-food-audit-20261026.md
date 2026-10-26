# JUL-178 — auditoria alimentar no branch atual

Data da inspeção: 26/10/2026  
Base limpa observada: `fb0af4e7f8bc07d3dbf5a1c0b9ea36bcb4102164` (`kingdom/main`)  
Patch da auditoria: `test/kingdom-autonomous`; commit próprio ainda será registrado no Linear.

## Referência e método

A descrição da issue pede a auditoria em `6b3cbd5b517ea96f20ba12a81fcf91c459824f45`, mas a `main` remota buscada nesta execução aponta para `fb0af4e7f8bc07d3dbf5a1c0b9ea36bcb4102164`. Usei o tip remoto efetivamente integrado à branch e não afirmo que o SHA antigo foi testado. O replay executa `engine.createWorld` e `stepDay` de produção diretamente, sem snapshots intermediários ou comandos de jogador.

## Dez hipóteses históricas

| # | Estado no código atual | Evidência / limite |
| --- | --- | --- |
| 1 | **Corrigido antes desta fatia** | `updateDependent` usa `transferFoodReserve`; o valor transferido é limitado pelo saldo do cuidador e pela capacidade do dependente. As regressões novas cobrem cuidador sem alimento e transferência parcial. |
| 2 | **Corrigido antes desta fatia** | `exchangeResources` valida ambos os débitos antes de mutar as contas. A troca que não cabe no saldo não muda nenhuma conta; o caso exato liquida os dois lados sem saldo negativo. |
| 3 | **Colheita pessoal corrigida nesta fatia** | A coleta delegada já limita a retirada à carga restante. O caminho pessoal agora limita a retirada à necessidade da reserva mais o espaço de carga, exceto quando entrega o excedente diretamente ao armazém comunitário. Testes cobrem ambos os caminhos e a conservação de biomassa no talhão. |
| 4 | **Separação válida de domínio** | Reinos usam `kingdom.market`; assentamentos sem reino podem usar `world.market`. `findTradePartner` escolhe o mercado pelo proprietário e `recordTrade` registra tipo/ID do mercado e deltas. Não há justificativa para fundir estoques de proprietários diferentes. Falta um replay que reconcilie todos os proprietários por ciclo. |
| 5 | **Aberto como decisão de produto** | O rebanho consome ração e pasto, mas não converte ovelhas domesticadas em alimento. Caça de animais selvagens produz carne. Não adicionei leite/abate porque criaria uma cadeia nova sem contrato de custo, capacidade ou efeito social; o estoque animal não cria alimento implícito. A issue continua aberta para decidir e testar uma saída do rebanho ou registrar explicitamente que ela é zero. |
| 6 | **Implementado; cobertura parcial** | `roça` usa `cropSeedStored`, sem semear a partir de estoque infinito; `community-agriculture.test.mjs` comprova que o projeto inicia e avança. Os replays longos abaixo ainda devem demonstrar semeadura e colheita no horizonte da auditoria. |
| 7 | **Implementado; eficiência ainda em avaliação** | Coleta comunitária cria carga finita e a entrega move apenas o saldo carregado; tarefas são comparadas antes/depois para aceitar progresso real. Replays longos ainda precisam quantificar viagens sem entrega e monopolização. |
| 8 | **Implementado; política de reservas ainda em avaliação** | Soldados em serviço têm demanda diferente de civis; `drawCampaignRation` e ledger de suprimentos registram consumo, reserva pessoal e retorno. Falta completar cenários de choque, fronteira fechada e baixa ração em vários seeds. |
| 9 | **Parcial** | `snapshot` separa `humanFoodBiomass` da métrica ampla `edibleBiomass`, que também inclui grama. Ainda não apresenta oferta acessível por população nem custo de distância; não uso biomassa total como previsão de alimentação. |
| 10 | **Contornado sem bloqueio permanente** | A caça exige abrigo para guardar carne. Sem abrigo, `huntForFood` procura alimento vegetal ou migra e registra a razão em `lastLesson`; não insiste em uma caça que não pode armazenar. Continua faltando quantificar essa condição nos replays. |

## Mudança e teste curto

- Adicionado `personalFoodHarvestLimit` ao fluxo de colheita individual para aplicar necessidade e capacidade antes de `harvestHumanFood` retirar biomassa.
- Adicionado `tests/economy-conservation.test.mjs`: seis regressões para cuidado dependente, troca atômica, limite de carga individual e comunitária, conservação de biomassa e transferência limitada de reserva.
- Resultado direcionado: `node --test tests/economy-conservation.test.mjs` — 6/6.
- Resultado completo no código após a correção: `npm test` — 61/61; `npm run typecheck` — passou; `npm run build` — passou (aviso já existente de chunk JS acima de 500 kB).
- `npm run audit:food -- --days 30 --seeds 42 --repeat-seed 42` — dois replays idênticos no estado completo e crônica; nenhum estoque listado negativo; 0 dias-adulto com reserva <20; 0 morte por fome. Esta é somente a prova curta usada como gate de CI.

## Replays de aceitação

Pendente nesta versão do documento: seeds `1/42/987/2026` por 730 dias, repetição integral de uma seed para paridade de estado/crônica e choque controlado. O script `scripts/audit-food-replays.mjs` já implementa a varredura diária de estoques finitos, registra alimento, população, mortes, campo, campanhas e hash do estado completo; o smoke de 30 dias está no workflow. A issue permanece **In Progress** até esses resultados, métricas de acesso e a decisão da saída alimentar do rebanho serem resolvidos ou replanejados.

## Decisões, fontes e alternativas

- A prioridade da meta e o skill Game Studio orientam preservar o Worker/simulação atual e limitar o patch ao contrato de colheita, sem migrar engine nem mover regra de domínio para o renderer.
- A evidência SciSpace sobre planejamento em camadas e avaliação repetível foi registrada em `docs/decisions/JUL-195-architecture-and-evidence.md`. A cota Consensus segue esgotada até 01/11/2026; não usei a indisponibilidade para bloquear a correção.
- Alternativas rejeitadas: converter ovelhas automaticamente em carne/leite sem custo e reabrir uma cadeia ecológica ampla. A escolha preserva finitude e evita geração implícita enquanto as métricas mostram o valor real da decisão.
- Estações continuam sendo apenas troca visual de tiles; esta auditoria não cria biomas ou regras ecológicas sazonais.
