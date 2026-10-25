# Pesquisa: combate por contato, animação e preparação para áudio

Pesquisa realizada em 25/10/2026. As referências abaixo fundamentam técnicas de colisão e sincronização; a combinação proposta para Kingdom é uma decisão de arquitetura, ainda sujeita a protótipo e medição. Não houve implementação de combate ou áudio nesta etapa.

## Recomendação

Separar a colisão de movimentação da colisão de combate e adotar ações com preparação, janela ativa e recuperação. Corpo, escudo e arma têm funções distintas. O Worker decide o contato e suas consequências; animação, partículas e áudio consomem essa mesma decisão.

Para permitir que posição, defesa e movimento durante o golpe realmente alterem o resultado, a direção recomendada é um relógio de combate com passos fixos, restrito às unidades em confronto. O motor atual decide dano em um passo diário: acrescentar polígonos ao desenho do Canvas não transforma essa decisão em combate por contato.

Começar por uma arena de calibração com os sprites atuais, sem sons, antes de integrar toda a simulação. O primeiro experimento pode usar 30 passos por segundo de tempo simulado de combate; esse valor precisa ser medido. Não significa atualizar ecologia e todos os moradores 30 vezes por segundo, nem adotar um motor de corpos rígidos para todo o mundo.

## O que as fontes sustentam

**Marcadores e janelas de animação.** Godot oferece chamadas em instantes definidos da animação; Unreal documenta eventos pontuais e intervalos com início/fim. Esses mecanismos mostram como organizar contato, partículas e efeitos no mesmo trecho do golpe. Em Kingdom, os marcadores devem ser dados compartilhados com a simulação, e o Canvas não terá autoridade para causar dano. [Godot: Animation Track types](https://docs.godotengine.org/en/stable/tutorials/animation/animation_track_types.html), [Epic: Animation Notifies](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-notifies-in-unreal-engine).

**Formas simples e varredura.** Box2D documenta círculos, cápsulas, polígonos convexos e consultas de distância/tempo de impacto. Godot descreve a varredura de uma forma ao longo de um trajeto, inclusive com vários candidatos. Isso fundamenta consultar o caminho percorrido por lâmina, ponta ou flecha, em vez de conferir somente a posição final. Uma varredura translacional única não resolve automaticamente a rotação de uma espada: é necessário subdividir o arco ou testar o volume varrido. [Box2D: Collision](https://box2d.org/documentation/md_collision.html), [Godot: ShapeCast2D](https://docs.godotengine.org/en/stable/classes/class_shapecast2d.html).

**Atualização de colisões.** As listas de sobreposição de `Area2D` são atualizadas no passo de física, e não imediatamente depois de mover uma forma. Isso reforça a necessidade de definir a ordem da atualização e usar consultas apropriadas para contatos rápidos. [Godot: Area2D](https://docs.godotengine.org/en/stable/classes/class_area2d.html).

**Tempo fixo.** A documentação de simulação do Box2D recomenda passos fixos e descreve subdivisão e colisão contínua; o artigo original de Glenn Fiedler explica problemas de passos variáveis, custo e acumulação de atraso. São referências para o relógio local de combate, não uma garantia de que 30 Hz terá custo ou precisão adequados neste projeto. [Box2D: Simulation](https://box2d.org/documentation/md_simulation.html), [Glenn Fiedler: Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/).

## Por que o modelo atual precisa mudar

- `fightTacticalRound` escolhe por distância e sorteia esquiva/bloqueio; não consulta escudo, lâmina ou corpo.
- `blocked` permanece local à função. A pose `defend` também é atribuída em golpes sem bloqueio.
- Um acerto pode incrementar `lastAttackSequence` duas vezes. Esse campo não pode virar um detector de contatos.
- Flechas são registradas antes da esquiva e seu dano é imediato; o trajeto visual só começa depois do snapshot.
- Ataques e defesas podem sobrescrever a mesma propriedade `militaryAnimation` no mesmo dia.
- O alcance usa posição de navegação. O arqueiro montado permanece logicamente na entrada da torre e aparece visualmente no alto: alcance e altura precisam ser tratados juntos.
- Os perfis em `physics/hitboxes.js` são principalmente pegadas no chão para navegação. Não representam automaticamente área vulnerável do tronco nem equipamento.

## As formas necessárias

| Forma | Função | Proposta inicial |
|---|---|---|
| Base de movimento | Evitar atravessar chão bloqueado, recursos, estruturas e outros agentes | Preservar a pequena forma próxima aos pés usada pela navegação. |
| Área vulnerável do corpo (`hurtbox`) | Receber golpe | Uma forma simples por personagem, como círculo/cápsula calibrada ao corpo, com faixa de altura/camada. Sem separar cabeça e membros na primeira versão. |
| Volume de ataque da espada | Produzir contato durante o corte | Cápsula fina ao longo da parte útil da lâmina, com trajetória por poses ativas. Não usar o retângulo inteiro da spritesheet nem o rastro branco do efeito. |
| Volume de ataque da lança | Produzir contato na estocada | Cápsula pequena na ponta e seu deslocamento frontal. A haste inteira não deve causar dano atrás do lanceiro. |
| Defesa do escudo | Interceptar um golpe frontal | Cápsula curta ou retângulo orientado, à frente do corpo, ativo em estado de guarda. Guardar normal, cobertura e altura. |
| Defesa com arma | Aparar quando o personagem realmente está defendendo | Forma da arma em uma janela de guarda/aparo. Uma arma que apenas cruza outra durante um ataque não implica bloqueio automático. |
| Flecha | Encontrar primeiro contato no trajeto | Segmento ou cápsula fina varrida da posição anterior para a nova, com altura/camada e resultado único. |
| Ferramenta de trabalho | Marcar contato com mineral, tronco ou obra | Forma/alcance própria no quadro de trabalho, filtrada para o recurso atribuído. Não agride personagens por acidente. |

Essas formas são regiões de consulta. Elas não precisam empurrar os personagens ou provocar reação física de corpos rígidos. O tamanho do sprite, pluma do elmo, sombra e transparência não devem determinar a área vulnerável.

Os pontos precisam ser armazenados em coordenadas locais do perfil, convertidos pela âncora e escala real do sprite e espelhados junto da pose. Zoom, pan e coordenadas de tela ficam fora do cálculo no Worker. A conversão visual precisa respeitar o plano do chão e a altura; não interpretar toda a altura desenhada do personagem como profundidade de navegação.

Os alcances atuais de 1,8 células para guerreiro e 3,2 para lanceiro não foram calibrados às trajetórias da arte. Separar alcance de busca/aproximação da IA do alcance efetivo da lâmina/ponta. O teste geométrico deve determinar o contato; esticar uma hitbox invisível para manter um número antigo preservaria o golpe à distância que queremos corrigir.

## Escudo, corpo e arma: como decidir o contato

1. Selecionar candidatos próximos com o índice espacial e com os filtros de proprietário, facção, estado e altura.
2. Durante a janela ativa, testar o caminho da arma contra as regiões elegíveis de defesa e corpo.
3. Ordenar contatos pelo primeiro instante real de interceptação; a defesa só vence quando está no caminho antes do corpo. Não dar prioridade global ao escudo se o ataque já chegou pelas costas.
4. Conferir guarda ativa, orientação frontal e capacidade de defender. Um teste de direção pode rejeitar ataques de trás antes da consulta geométrica detalhada.
5. Registrar `shield_block`, `weapon_block`, `body_hit` ou `miss`, com ponto/normal, atacante, defensor, arma, superfície e ID da ação.
6. Aplicar a consequência uma vez e marcar o defensor como processado naquele golpe. Não aplicar dano em todos os quadros enquanto as formas continuam sobrepostas.

Desempatar contatos simultâneos por uma regra estável, como IDs ordenados. Filtros devem excluir a própria unidade, aliados quando o fogo amigo estiver desligado e personagens mortos/abrigados, além de respeitar altura. Não usar a ordem variável de desenho como critério.

O bloqueio atual deixa passar 30% do dano. Pode-se conservar esse multiplicador no primeiro experimento como dano residual explícito (`chipDamage`), mantendo separado o contato no escudo do dano ao corpo. Se futuramente o bloqueio absorver tudo ou consumir estamina, isso será uma regra de balanceamento definida e medida — não uma consequência acidental da biblioteca de colisões.

Minha recomendação para a defesa é que treinamento/atributos influenciem a decisão e o tempo de entrar em guarda ou esquivar. Depois que a guarda estiver ativa e a geometria interceptar o golpe, o contato decide o resultado. Evitar um segundo sorteio que mostre a espada atravessando um escudo ativo ou um corpo escapando depois de já ser atingido. Essa mudança altera as probabilidades efetivas e exige comparar o balanceamento com a versão atual.

Na primeira versão, manter golpes normais com um alvo de dano por ação e fogo amigo desativado. As duas animações de espada atuais não significam automaticamente dois tipos de dano ou um ataque em área. Se golpes múltiplos ou aparos mútuos forem desejados, entram como regras próprias depois.

## Preparação, janela ativa e recuperação

Fluxo proposto:

`aproximar → preparar → ativar arma → resolver contato → recuperar → permitir próxima ação`

- Preparação: posicionar e orientar; ainda não causa dano.
- Janela ativa: arma pode atingir/interceptar; consultas cobrem todo o trecho percorrido entre passos.
- Contato: aplicar dano/bloqueio, emitir um resultado e registrar ponto de impacto.
- Recuperação: desligar o volume ofensivo e concluir a pose; impedir um novo ataque antes do intervalo permitido.
- Cancelamento: morte durante preparação cancela o ataque; flecha já disparada continua independente do arqueiro. Ferimento não cancela tudo automaticamente sem uma regra definida.

Os marcadores devem ser detectados quando o tempo atravessa um limite (`anterior < marcador <= atual`), nunca exigindo que o navegador desenhe exatamente aquele quadro. Se um avanço atravessar toda a janela ativa, o resolvedor ainda precisa testar a varredura correspondente. A imagem pode pular quadros em aceleração; a regra de contato não pode ser pulada.

O intervalo atual entre ataques é de dois dias. No protótipo, conservar esse ritmo como referência de cooldown; não acelerar a cadência apenas porque o clip dura 300 ou 400 ms.

## Conferência dos assets atuais

Inspeção das spritesheets publicadas e do catálogo, sem alterar arquivos:

| Clip | Dados atuais | O que precisa ser calibrado |
|---|---|---|
| Espada `Attack1` e `Attack2` | 4 quadros a 10 fps: 400 ms cada | O corte forte aparece no terceiro quadro. Ele é candidato à janela ativa, mas o rastro de efeito não deve virar a forma da lâmina. Medir base/ponta e posição de contato. |
| Lança `Right_Attack` | 3 quadros a 10 fps: 300 ms | A ponta já aparece avançada nos primeiros quadros. Não presumir que o primeiro quadro é preparação; pode ser preciso usar a pose de guarda antes de iniciar o clip. |
| Arqueiro `Shoot` | 8 quadros a 10 fps: 800 ms | Os quadros centrais mostram arco armado e depois soltura. O sexto quadro (índice 5) é candidato ao marcador de disparo, a confirmar em reprodução lenta. Hoje a flecha visual nasce no início. |
| Picareta `interact-pickaxe` | 6 quadros a 10 fps: 600 ms, nas cinco paletas | Marcar o contato perto da passagem da ferramenta pelo recurso e posicionar o trabalhador para esse ponto. Não gerar minério distante. |

Esses marcadores são candidatos visuais, não valores finais de implementação.

**Limitação de direção:** o lanceiro tem poses Up, UpRight, Right, DownRight e Down, com espelhamento. Guerreiro e arqueiro usam essencialmente poses laterais com flip horizontal. Um escudo lógico que protege para cima enquanto o sprite olha para o lado causa contradição. A arena deve testar todas as direções; onde o asset não representar a direção desejada, escolher conscientemente entre novas poses, adaptação visual ou uma limitação temporária. Girar o corpo inteiro como se fosse uma textura plana não resolve automaticamente um sprite com perspectiva.

Para mineração, é possível reaproveitar as poses laterais escolhendo pontos de trabalho à esquerda/direita da jazida. Isso deve respeitar caminho livre, hitbox e acesso ao recurso; não é uma licença para extrair à distância quando os dois lados estão bloqueados.

## Tempo: alternativas para Kingdom

| Abordagem | O que entrega | Limite/custo |
|---|---|---|
| Contato geométrico discreto por ação diária | Testa arma/defesa/corpo sobre posições daquele momento e reproduz o resultado na animação | Mantém a arquitetura atual mais próxima, mas um alvo não pode escapar realmente no meio da preparação sem outra atualização lógica. |
| Combate em passos fixos locais | Posição, guarda e projétil podem mudar durante o golpe; dano ocorre no contato | Requer relógio, estados de ação, movimento de combatentes e integração dos snapshots. É a direção recomendada para o contato que estamos discutindo. |
| Física detalhada de corpos rígidos para o mundo inteiro | Impulsos, rotações e dinâmica ampla | Não foi demonstrada necessidade para os personagens cinemáticos deste jogo; aumenta escopo e custo. |

A recomendação não depende de migrar o jogo para Godot, Unreal ou Box2D. As referências orientam o desenho; as consultas simples podem ser implementadas no sistema atual e avaliadas antes de escolher uma dependência.

### Integração do relógio recomendada para experimentar

- Manter necessidades, economia e ecologia no passo diário.
- Usar 1 segundo de tempo de combate por dia como convenção inicial, coerente com o relógio atual em 1×. O alvo inicial de 30 subpassos por esse intervalo fornece três consultas por quadro dos clips de 10 fps; não dispensa varredura de armas rápidas.
- Transformar o deslocamento dos combatentes em intenção/caminho cinemático durante esse intervalo. Continuar teleportando uma célula antes do resolvedor impediria testar esquivas ao longo do golpe.
- Centralizar a execução dos ataques. Campanha, sentinela, cerco e escaramuça solicitam ações ao mesmo controlador; não mantêm resolvedores independentes com gasto/dano/eventos repetidos.
- Fazer o Worker avançar esses passos e enviar um registro compacto de poses, transições e contatos dos envolvidos. Não enviar todas as colunas de tiles 30 vezes por segundo.
- A UI apresenta o intervalo com um buffer/interpolação definido, podendo estar atrasada em relação ao Worker. Esse atraso precisa ser medido e aceito; só o último `militaryAnimation` do snapshot não reproduz as fases intermediárias.
- Em 2×/3×, a fase de animação acompanha o tempo simulado; não prometer simultaneamente combate físico acelerado e todos os clips em duração fixa de parede. Arquivos de som podem preservar pitch/duração, com controle de vozes e descarte de repetições.
- Um avanço em lote deve manter a simulação completa, mas pode condensar a apresentação atrasada. Descartar uma partícula ou som não descarta o contato/dano já calculado.

Essa integração é maior que adicionar eventos de áudio; precisa ser medida isoladamente antes de converter todas as lutas.

## Flechas, altura e obstáculos

Disparar no marcador do arco. A flecha passa a ter posição anterior/atual, direção, proprietário, faixa de altura e ID da ação, e deixa de ser apenas um efeito visual com dano antecipado.

Usar varredura entre posições contra corpo, escudo elegível e obstáculos. O primeiro contato encerra o projétil comum. A posição mirada é registrada no disparo; a flecha não deve seguir automaticamente o alvo que mudou de direção, salvo se isso virar uma habilidade declarada.

Para o modelo 2D com torres, uma camada/faixa de altura é suficiente para começar: golpe de espada no chão não alcança automaticamente o arqueiro desenhado no topo da torre. Armas de alcance podem conectar camadas conforme o trajeto. É preciso também definir quais paredes/troncos bloqueiam flechas e em que altura, sem tratar copa de árvore e sombra como uma parede sólida.

Não introduzir ricochete, perfuração, gravidade detalhada ou dano por membro junto desta primeira integração. São regras adicionais que não são necessárias para os efeitos existentes.

## Preparação para os efeitos sonoros

Cada contato produz um registro como:

```text
actionId / eventId / simulationTime
attackerId / defenderId
weaponKind / defenseKind / surfaceKind
contactKind: shield_block | weapon_block | body_hit | structure_hit | miss
point / normal / damageApplied / chipDamage / fatal
```

O áudio escolhe sua família a partir do contato confirmado: escudo, metal contra arma, corpo, estrutura ou nenhum impacto. O movimento da espada pode soar mesmo em erro; impacto de corpo não. Cura, mineração e construção usam seus próprios marcadores e resultados. Som, faísca e reação do personagem partem do mesmo instante lógico, com correção de buffer de apresentação.

Manter uma conversão única de tempo simulado para o tempo apresentado e o relógio de áudio. Na audição dos arquivos, marcar também o deslocamento do transiente de impacto: o início do arquivo pode conter preparação antes da pancada. A duração do efeito não determina a duração lógica do golpe. Cancelamentos e reset invalidam as agendas futuras da ação; efeitos atrasados demais seguem a política de descarte em vez de formar uma fila de impactos antigos.

`hitTargets` por ação impede múltiplos danos em sobreposição contínua. IDs de eventos de apresentação e sorteio de variações sonoras permanecem separados de `world.nextId` e do RNG de decisões da simulação. O reset cancela a apresentação anterior; o combate continua funcionando sem áudio, sem Canvas e fora da câmera.

## Ferramenta de calibração necessária

Antes da integração completa, criar uma arena/editor de diagnóstico com:

- sprites reais de duas unidades, quadro a quadro;
- base de movimento, corpo, escudo e arma desenhados separadamente;
- preparação, início/fim da janela ativa e recuperação na linha de tempo;
- contato identificado com ponto, normal, resultado e contagem de dano;
- testes frontal, lateral e pelas costas; lâmina rápida; ponta da lança; defesa com arma; alvo em torre;
- exportação de perfis por clip/direção, compartilhados entre Worker e UI.

O editor de colisão atual trata principalmente formas de navegação; não basta renomear seus polígonos para configurar janelas e trajetórias de armas. A arte usada no jogo deve determinar o perfil de contato, e os perfis devem ter versão para que a simulação e a visualização usem os mesmos dados.

## Ordem proposta para fechar os pré-requisitos

1. Fixar regras de alvo, direção/guarda, altura e dano residual; registrar os cenários atuais de balanceamento.
2. Construir a arena de calibração e marcar corpo, escudo e arma nos clips existentes. Resolver a limitação de direções dos sprites.
3. Prototipar estados e consultas geométricas sem áudio: espada, lança e defesa; medir custo em grupos pequenos e maiores.
4. Integrar o relógio de combate ao Worker e às intenções de movimento. Comparar o custo por dia com o motor atual; não multiplicar o processamento diário de toda a população.
5. Integrar flecha real, sentinela, cerco e morte por contato; reconciliar os casos de entrada em torre já apontados na validação.
6. Aplicar o ciclo de aproximação/contato/resultado à picareta e ao machado, conservando IDs de ação e produção única.
7. Validar apresentação em 1×/2×/3× e avanços em lote, com mesma semente e entradas gerando o mesmo resultado independentemente do FPS de desenho.
8. Ligar partículas e indicadores ao contato; depois implementar os sons por família, com os arquivos ainda ausentes desativados no catálogo.

Critérios mínimos: ataque pelas costas não bloqueado pelo escudo frontal; arma inativa sem dano; um dano por ação/alvo; espada rápida sem atravessar corpo entre amostras; estocada sem dano pela haste traseira; esquiva por deslocamento; projétil sem dano antes do disparo/contato; corpo em torre fora do alcance de espada no chão; morte cancela preparação, mas não uma flecha já disparada; mineração sem produção fora do ponto de trabalho; nenhuma decisão de contato depende do quadro renderizado ou da visibilidade na câmera.

## Limites e decisões de balanceamento

As formas exatas, alcance útil, custo de defesa e quais direções exigem nova arte ainda precisam da calibração nos sprites. A pesquisa não comprova custo de 30 Hz no Kingdom. Geometria e tempo de reação vão alterar os resultados em relação aos sorteios atuais; conservar números de dano não garante conservar o balanceamento. Comparar duelos entre classes, grupos, proteção de trabalhadores e cerco, medindo tentativas, contatos, bloqueios, danos, baixas, tempo de confronto e abastecimento.

Este documento substitui a recomendação preliminar de apenas resolver dano no dia e reproduzir uma animação independente como direção de longo prazo. Esse modo simplificado permanece uma alternativa menor, mas não entrega uma esquiva ou interceptação dinâmica no meio do golpe.
