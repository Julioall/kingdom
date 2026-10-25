# Pré-requisitos para os efeitos de combate e trabalho

Avaliação de 25/10/2026, baseada no código, nos assets publicados, em cenários controlados, em 120 dias de simulação normal com semente 42 e em uma inspeção do jogo no navegador. O sistema de sons deve ser ligado depois de corrigir os pontos P0 abaixo.

A pesquisa posterior em [combate por contato](combat-collision-research.md) detalha corpo, escudo, arma, janelas e relógio. Para o modelo geométrico dinâmico recomendado ali, dano passa a ser resolvido no passo de contato do Worker; o replay de dano instantâneo descrito na primeira avaliação é uma alternativa simplificada, não a direção final proposta.

## O que existe e o que foi observado

| Área | Estado confirmado | Consequência |
|---|---|---|
| Mineração | A ação `gather` extrai pedra e ouro. Em 120 dias ocorreram 6 extrações de pedra e 4 de ouro; também houve 20 cortes de árvore. | A mecânica não precisa ser criada do zero. |
| Animação de mineração | `pawn_interact-pickaxe.png` está publicado nas cinco paletas: 6 quadros a 10 fps, duração de 600 ms. O seletor retorna `interact-pickaxe` quando o trabalhador está parado. | Reaproveitar a spritesheet; completar o ciclo de trabalho e seu posicionamento. |
| Mineração no navegador | Semente 42, dia 1: Kai E aparece como `extraindo pedra`, com 2,4 unidades de pedra na carga. | A ação está no fluxo jogável, e não apenas em uma função auxiliar. |
| Alcance de trabalho | Kai E extrai de `(63,21)` estando em `(62,24)`: distância de aproximadamente 3,16 células. Um cenário controlado também extraiu ouro a 3 células sem deslocamento. | A picareta e o recurso podem ficar separados na tela. |
| Ataques | Existem gasto de estamina, alcance por classe, esquiva, bloqueio com dano reduzido, dano, morte e cerco. | O áudio pode aproveitar essas decisões depois que elas forem expostas de forma inequívoca. |
| Identificação de acerto | Um acerto incrementou `lastAttackSequence` em 2: há um incremento em `fightTacticalRound` e outro em `changePersonHealth`. Uma tentativa esquivada também incrementa o contador antes da esquiva. | Esse contador não identifica um acerto único para áudio. |
| Defesa | O resultado `blocked` é local à função e não é persistido. A animação `defend` é atribuída mesmo quando o golpe não é bloqueado. | A pose de defesa não pode ser usada como prova de bloqueio. |
| Assets de defesa | A spritesheet `Warrior_Guard` mostra escudo; `Lancer_Right_Defence` mostra defesa com lança. | Podemos classificar a apresentação por classe sem inventar um sistema físico de colisões entre armas. |
| Duração dos ataques | Guerreiro: 400 ms; lanceiro: 300 ms; arqueiro: 800 ms. O renderer força a pose do arqueiro por 600 ms. | Há durações e relógios que precisam ser unificados. |
| Flechas | O dano é resolvido no tick. A flecha visual aparece depois do snapshot e percorre o trajeto em 350–850 ms. | O contato visual e os futuros sons precisam de uma mesma linha de tempo. |
| Verificações existentes | 41 testes selecionados: 39 passaram e 2 falharam em cenários de entrada na torre. | Resolver o contrato de entrada antes de considerar a apresentação da sentinela validada. |

Dados reproduzíveis: [relatório dos cenários](../reports/audio-prerequisites-audit.json). Evidências do navegador: [estado de extração](../reports/audio-prerequisites/mining-day1.png) e [área de trabalho](../reports/audio-prerequisites/mining-worksite.png).

## P0 — resultados claros de combate

Criar um resultado de ataque com identidade própria, emitido uma vez após as validações de alcance, estamina e resolução. Campos mínimos: `actionId`, atacante/alvo e suas posições, classe/arma, resultado `miss|blocked|hit`, dano efetivamente aplicado e indicador de morte. Bloqueio continua podendo causar dano: a fórmula atual usa 30% do dano, não dano zero.

O mesmo resultado deve alimentar pose, partículas, indicadores de dano e, posteriormente, som. Corrigir a dupla contagem de `lastAttackSequence` e definir se o campo representa tentativa ou dano recebido; não continuar usando os dois significados.

Adicionar perfis de apresentação para arma, defesa e superfície do alvo:

- Guerreiro: espada e escudo, de acordo com o asset existente.
- Lanceiro: lança e defesa com arma; o choque metálico pode ser reaproveitado como contato genérico de metal. O motor atual não calcula um aparo específico de espada contra espada.
- Arqueiro e monge: o modelo também permite redução por bloqueio, mas eles não têm a mesma pose de escudo. Definir uma reação compatível para esse resultado, sem reproduzir som de escudo por padrão.
- Armadura/material: hoje não são atributos gerais de combate. Classificar o efeito visual/sonoro pela aparência confirmada e usar contato neutro quando não houver informação. Essa classificação não deve alterar resistência ou dano incidentalmente.

Todos os caminhos de dano precisam ser considerados: combate tático, arqueiros em torre, cerco, disputa por recurso, invasão e saque. Treino simulado é um evento diferente: não deve gerar dano, grito de ferimento, morte ou projétil real.

Arquivos principais: `kingdoms/military.js`, `kingdoms/combat-resources.js`, `kingdoms/fortifications.js`, `individuals/lifecycle.js` e `kingdoms/military-learning.js` dentro de `src/simulation/`.

## P0 — ciclo visual completo dos ataques

Usar uma sequência de apresentação com preparação, quadro de contato/disparo e recuperação, identificada por `actionId`. Iniciar e concluir o clip por tempo de animação, independentemente de o calendário avançar para outro dia. Em 3×, um dia dura aproximadamente 333 ms; isso já é menor que os 400 ms do guerreiro e os 600 ms da picareta.

Definir marcadores no catálogo de animações: início, disparo/contato e fim. O som de movimento de arma fica no início; impacto, defesa e reação ficam no contato. O marcador precisa ser conferido nos quadros, não estimado pela duração do arquivo de áudio.

Remover a divergência entre os 600 ms forçados do arqueiro e seus 800 ms de spritesheet. Evitar que a interpolação de movimento faça o personagem deslizar enquanto ataca ou minera. A posição de apresentação pode ser mantida no ponto da ação até o contato, retomando depois a posição atual da simulação.

A prioridade visual precisa ser explícita: morte/ferimento relevante, ataque/defesa, trabalho e depois movimento/idle. Defesa deve aparecer para o resultado adequado; um acerto normal não deve parecer um bloqueio.

Um único campo `militaryAnimation` também pode ser sobrescrito quando a mesma unidade ataca e recebe um golpe no mesmo dia. Conservar as duas ações em registros próprios e resolver a prioridade na apresentação, em vez de perder a primeira ao atualizar a última pose.

## P0 — flechas com resultado e contato sincronizados

`recordArrow` é chamado antes da decisão de esquiva. Portanto, disparo não garante acerto. O evento deve carregar o ponto mirado, posições/alturas e o resultado decidido pelo combate.

A duração visual do trajeto pertence à apresentação. Reutilizar a mesma função de 350–850 ms para a flecha e para agendar o contato; não calcular um relógio independente no Worker ou no gerenciador de áudio. Em esquiva, a flecha termina sem impacto de corpo. Em bloqueio, toca a reação correspondente à defesa. Em acerto fatal, preservar uma representação transitória do alvo até o contato, pois o estado lógico morto já deixa de ser desenhado.

O modo simplificado pode resolver o ataque no tick e apresentar o resultado depois. Para a direção de combate por contato agora pesquisada, a flecha precisa nascer no marcador de disparo e o Worker deve resolver sua interceptação em passos menores. Isso altera a mecânica e precisa da arena de validação e da comparação de balanceamento indicadas no estudo.

## P0 — mineração e demais trabalhos próximos ao recurso

A animação de picareta já está disponível. O que precisa ser implementado/completado é o comportamento visual da ação:

1. Escolher e conservar uma jazida como alvo de trabalho.
2. Encontrar um ponto de interação alcançável ao lado da hitbox do mineral. A distância deve partir da superfície/alcance da ferramenta, em vez de permitir extração imediata a 3,5 células.
3. Aproximar o morador; durante a aproximação, usar corrida com ferramenta, sem produzir minério.
4. Parar, orientar para a jazida e executar um ciclo de picareta de 600 ms. Marcar o quadro de contato após conferir a spritesheet; não manter apenas um loop associado ao texto `extraindo...`.
5. No contato de apresentação, mostrar poeira/fragmentos e a mudança visual do recurso. Conservar no evento os dados anteriores/novos necessários para evitar que a jazida desapareça antes do golpe.
6. Mostrar a carga e liberar a pose de trabalho. Um novo golpe só corresponde a uma nova ação válida; redesenhar ou continuar parado não gera nova extração nem novo impacto.
7. Se a jazida esgotar, o caminho falhar, o trabalhador for ferido ou receber outra tarefa, invalidar a ação pendente e impedir impacto/produção duplicados.

O registro de extração precisa ser associado ao contato lógico da ferramenta. Se a primeira entrega usar replay simplificado, conservar os dados para apresentar o contato depois do tick; se usar o relógio de ações pesquisado, efetivar a extração no contato autoritativo. Em ambos, impedir produção dupla e preservar os parâmetros de rendimento/energia como referência de balanceamento.

O corte de árvores usa o mesmo raio de seleção e precisa da mesma revisão de aproximação/contato. O pacote fornece machado e impacto em madeira; ele não confirma um som específico de queda de árvore. A árvore atual vira toco/tronco sem uma animação de tombamento.

## P0 — eventos transitórios compartilhados por imagem e som

O plano original previa emitir todos os sons de um lote. Isso faria ataques de dias intermediários soarem quando a UI só conhece o último estado. A solução é um canal de eventos de apresentação com uma política explícita para lotes:

- IDs e sequências próprios, fora de `world.nextId` e do RNG da simulação.
- Coletor transitório externo ao objeto `world`; `createWorldSnapshot` espalha os campos do mundo em `base`, portanto uma fila colocada ali seria copiada e poderia ser repetida.
- Envelope com dias inicial/final, eventos e contagem de eventos descartados. Limite inicial proposto: 512 registros por solicitação, com reserva para eventos estratégicos/destruições. É um limite de partida a medir.
- Ações locais repetidas são condensadas por ator e tipo; apresentar o evento mais recente compatível com o estado final. Não reconstruir 12 dias de luta em um único quadro.
- Efeitos visuais e futuros sons usam o mesmo evento selecionado e o mesmo relógio. Retirar os caminhos antigos equivalentes por comparação de snapshot para não desenhar/tocar duas vezes. Poeira de movimento pode continuar independente.
- Inicialização, reset, resposta de outra época e revisão expirada não reproduzem histórico. Eventos com asset ausente permanecem silenciosos; a ação e os efeitos já disponíveis continuam funcionando.

Atualizar o contrato em `protocol.ts`, a versão do protocolo, `worker-runtime.js`, `GameSession` e a integração de `createActivityEffects`. Som e animação nunca executam `stepDay` nem alteram o resultado das ações.

## P1 — estruturas, campanhas e entrada nas torres

Destruição tem três caminhos que precisam convergir para um único evento sem mudar suas regras atuais:

| Caminho | Ponto atual | Cuidado |
|---|---|---|
| Vida chega a zero em cerco | `destroyStructureInWorld` | Já tem proteção por `destroyedDay`; emitir uma única vez. |
| Jogador manda destruir torre | `destroyKingdomTower` | Remove a torre com `splice`, sem passar pelo fluxo anterior. Capturar posição/ID antes da remoção. |
| Colapso por manutenção | `maintainKingdomFortifications` | Torres passam pelo destruidor; castelo/centro militar podem apenas perder integridade/completude. Evitar evento duplo para a torre e ausência de evento nos demais. |

Captura muda a bandeira e o dono da torre; não é destruição e não deve tocar desabamento. Precisa de evento/feedback próprio, ainda sem asset específico no pacote.

`war_call` deve corresponder à criação efetiva da campanha, uma vez por campanha, inclusive quando automática. `retreat_ordered` deve corresponder à ordem `withdraw` validada do general. `resolveWar` põe todas as campanhas resolvidas em `withdrawing`, inclusive vitórias e armistícios: não usar apenas esse estado para tocar ordem de retirada.

Os dois testes que falharam estão em `combat-resources.test.mjs`, nos casos de entrada da sentinela e entrada bloqueada por água. O código usa `structureInteractionPoint`, que aplica offsets do perfil de colisão: no fixture, a entrada declarada `(5,6)` vira o ponto efetivo `(5,5)` porque o perfil da torre tem `entryOffsetY: -1`. O primeiro teste espera o ponto declarado; o segundo marca/consulta água nesse ponto, não necessariamente na entrada efetiva. Isso indica expectativas desatualizadas nesses cenários e não comprova uma sentinela quebrada em produção. Reconciliar o contrato, exercitar água no ponto efetivo e depois verificar entrada, ocupação e saída para recuperação no jogo.

## Outros fluxos a preparar

| Ação atual | Preparação necessária | Necessita novo desenho de sprite antes de som? |
|---|---|---|
| Cura em área | Emitir uma conjuração com a lista de beneficiários. Mostrar partículas em cada aliado, mas evitar um áudio completo de cura por beneficiário. | Não; animações de cura já existem. |
| Construção/reparo | Distinguir trabalho efetivo, ajuda e conclusão; ancorar martelo e poeira no local alcançável, com marcador de contato. | Há martelo; revisar o ciclo. |
| Forrageio | Identificar uma colheita real e seu ponto. Hoje o efeito se apoia principalmente em estado/estoque, sem um ciclo visual específico de colher. | Um gesto/partícula simples é desejável; não é necessário inventar outra mecânica. |
| Caça de ovelha selvagem | Diferenciar tentativa, fuga e captura; mostrar o gesto existente de faca no alvo próximo. | Há interação com faca; revisar sincronização. |
| Recolher/entregar carga | Emitir uma transferência positiva, quantidade/material e destino. Som no recebimento/depósito real. | Não; o feedback pode acompanhar a transferência. |
| Troca, partilha e saque | Emitir sucesso e efeito efetivo, separando aproximação/recusa. | Não; gesto é melhoria visual opcional. |
| Ovelhas | Sinais de captura, início de condução e chegada ao rebanho. Não há ação de abrir portão para sincronizar um som de portão. | Reaproveitar ovelhas atuais; falta áudio específico. |
| Recrutamento | Distinguir pedido aceito de treinamento concluído. | Não. |
| Dano/morte | Preservar causa, posição e identidade. Som de queda fatal pode acompanhar uma morte real de combate mesmo antes de existir animação própria; a nova animação é melhoria visual, não bloqueio técnico. | Não obrigatório; queda não fatal continua sem ação correspondente. |
| Interface | Confirmar ação após resposta aceita/rejeitada; não gerar corneta para ordem inválida. | Não. |
| Deslocamento | Se houver passos no futuro, usar distância percorrida/quadro de contato dos pés. | Não usar um passo por dia ou por snapshot. |

Pesca e besta permanecem fora do escopo porque não são ações/unidades ativas.

## Ordem de execução antes dos sons

1. Definir resultados e perfis de combate; corrigir a contagem e a distinção entre ataque, acerto, esquiva e bloqueio.
2. Completar os ciclos visuais de combate, flecha, mineração e corte; resolver aproximação, posição e quadros de contato.
3. Introduzir o canal transitório compartilhado de apresentação; ligar os efeitos visuais existentes a ele e tratar lotes/reset/pausa.
4. Resolver os casos de entrada na torre e unificar a emissão de destruição, captura, convocação e retirada.
5. Validar tudo ainda sem áudio. Então implementar o núcleo de sons e ligar cada conjunto cujo ciclo já esteja pronto. Sons ainda ausentes no pacote ficam desativados no catálogo.

Critérios de saída: um resultado por ação; golpes sem produção à distância; clips completos em 1×/2×/3×; flecha errada sem impacto de corpo; um efeito de destruição por estrutura nos três caminhos; captura sem desabamento; um cast de cura por conjuração; reset/pausa/avanço manual sem repetição; mesmos IDs, RNG e estado econômico/militar com a coleta de eventos ligada ou desligada.

## Limites desta avaliação

Foi validada a estrutura do ZIP: 47 IDs, 47 OGG, 47 MP3, 28 grupos coincidentes nos dois JSON, 38 nomes de fonte distintos, caminhos presentes, durações declaradas coerentes e nenhum OGG idêntico por SHA-256. Os originais são referenciados pelo manifesto, não fornecidos como 38 gravações adicionais no ZIP. Não houve decodificação/audição individual dos efeitos.

O navegador foi usado para confirmar a mineração e a apresentação do cenário inicial. O combate foi conferido por código, assets, cenários controlados e testes existentes; um playtest visual completo de batalha ainda faz parte da etapa anterior à ligação do áudio.
