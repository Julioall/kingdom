# JUL-178 — auditoria alimentar no branch atual

Data da inspeção: 26/10/2026  
Base limpa observada: `fb0af4e7f8bc07d3dbf5a1c0b9ea36bcb4102164` (`kingdom/main`)  
Patch da auditoria: branch de integração `codex/jul195-integration`, base `test/kingdom-autonomous`.

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
- Resultado direcionado: `node --test tests/economy-conservation.test.mjs` — 6/6; regressão nova da navegação de alimento — 1/1.
- Após a regressão de navegação, `npm test` — 63/63; `npm run build` (inclui `tsc --noEmit`) — passou (aviso de chunk JS acima de 500 kB).
- `npm run audit:food -- --days 30 --seeds 42 --repeat-seed 42` — dois replays idênticos no estado completo e crônica; nenhum estoque listado negativo; 0 dias-adulto com reserva <20; 0 morte por fome. Esta é somente a prova curta usada como gate de CI.

## Replays de aceitação

No SHA `0b4d633fe7930bd1011ca00a2acbd22f9f230414`, `npm run audit:food -- --days 730 --seeds 1,42,987,2026 --repeat-seed 42` passou para todas as seeds e encontrou estoques finitos não negativos. A seed 42 repetida produziu o mesmo hash completo de estado e crônica (`000750ac0e1922dc649393b0964653b8cab0b2009eec6ea2a3a6783bf22a9cd5`, crônica `54dbe2d31030612083642aea83b6fda785ff822511d1afe2ce752633dcc1bc3d`; `determinismDiff=[]`).

| Seed | Vivos ao dia 730 | Mortes por fome | Adultos-dia com reserva <20 | Biomassa alimentar humana final | Batalhas | Comida em campanha |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 87 | 26 | 30.552 | 142.158,89 | 39 | 0 |
| 42 | 87 | 26 | 34.704 | 145.608,84 | 58 | 0 |
| 987 | 94 | 3 | 30.990 | 148.520,54 | 77 | 0 |
| 2026 | 85 | 14 | 32.995 | 130.478,61 | 63 | 0 |

Comparando com o replay anterior sem correção de aproximação (SHA `3592d965f9bfb3f43744f94628608f408a473b83`), as mortes por fome caíram de `60/62/70/83` para `26/26/3/14`; a soma passou de 275 para 69. A primeira abordagem de aproximação (`cbb46e4`) registrou `64/33/27/21`, e o experimento de cooldown de sete dias (`20e5ec1`) `31/47/47/61`; ambos foram substituídos. A versão atual, `0b4d633`, usa alvo adjacente ao arbusto, rota direta para roça e troca de até quatro alvos na mesma ação quando não há caminho. Ainda há 30.552–34.704 adultos-dia com reserva <20 em três das quatro seeds, portanto a fome não está resolvida. O relatório completo e hashes estão em `JUL-178-food-replays-final-20261026.json`.

Replay curto de 430 dias em seed 42 no mesmo SHA: 97 vivos, 11 mortes por fome, 15.773 adultos-dia abaixo de reserva 20, 1,79 alimento comunitário e nenhum estoque negativo (`JUL-178-food-replan-smoke-430-20261026.json`, estado `bd9226623b2afb93bb523434d3a5f9123a4c67f821cfc631c6c540e983cb89b4`). O horizonte de 730 dias acima é a medida comparável ao baseline; cenários de choque e atribuição origem/destino ainda faltam.

O trace determinístico mostrou uma falha concreta: o agente selecionava um arbusto cujo tile era bloqueado pelo tronco e nunca entrava no alcance de colheita. A regressão `tests/food-navigation.test.mjs` reproduz o alvo e confirma a escolha de tile cardinal livre; também protege a rota direta de roças. Um cooldown de sete dias foi rejeitado pelo replay. A versão atual troca de destino no mesmo dia e o replay 730 reduziu a fome sem divergência de estado. Traces anteriores também mostraram dependentes sem transferência alimentar efetiva, problema distinto que precisa de reprodução direcionada.

Pendente: horizontes isolados de 253/365 dias no SHA final, cenários controlados (estoque zerado, baixa oferta, perda do cuidador, guerra/ração, fronteira fechada e mercado 0..12), reconciliação quantitativa por proprietário/transferência, alimentação de rebanho e métricas de distância/entrega. A issue permanece **In Progress**; o replay de 730 dias é reproduzível, mas não satisfaz os critérios de produto.

## Decisões, fontes e alternativas

- A prioridade da meta e o skill Game Studio orientam preservar o Worker/simulação atual e limitar o patch ao contrato de colheita, sem migrar engine nem mover regra de domínio para o renderer.
- A evidência SciSpace sobre planejamento em camadas e avaliação repetível foi registrada em `docs/decisions/JUL-195-architecture-and-evidence.md`. A cota Consensus segue esgotada até 01/11/2026; não usei a indisponibilidade para bloquear a correção.
- Alternativas rejeitadas: converter ovelhas automaticamente em carne/leite sem custo e reabrir uma cadeia ecológica ampla. A escolha preserva finitude e evita geração implícita enquanto as métricas mostram o valor real da decisão.
- Estações continuam sendo apenas troca visual de tiles; esta auditoria não cria biomas ou regras ecológicas sazonais.
