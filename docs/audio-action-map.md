# Mapa de sons por ações existentes no Kingdom

## Critério e estado atual

Considerei ações ativas dos moradores e soldados e comandos que aparecem na interface. Não incluí mecânicas apenas sugeridas ou funções internas sem caminho de uso no jogo.

O manifesto do pacote v2.1 referencia 38 fontes distintas e fornece 47 efeitos processados em 28 grupos de evento; cada efeito tem versão OGG e MP3. O pacote ainda não foi extraído para o projeto, e não encontrei código de reprodução. “Presente” significa que existe no pacote, não que o som já toca. O [plano do sistema de áudio](audio-system-plan.md) detalha a integração e as regras de reprodução.

A [validação dos pré-requisitos](audio-prerequisites.md) confirmou mineração real e a animação de picareta já disponível, mas encontrou problemas de aproximação, identificação de resultados de combate e sincronização. A cobertura de arquivos abaixo não significa que o respectivo fluxo já esteja pronto para receber som.

A distinção geométrica entre corpo, escudo e arma está proposta na [pesquisa de combate](combat-collision-research.md). Hoje o bloqueio ainda é um resultado probabilístico genérico; as associações de escudo/arma abaixo representam perfis a construir a partir dos assets.

## Combate e ordens militares

| Ação existente | Som indicado | Cobertura do manifesto | Prioridade |
|---|---|---|---|
| Guerreiro desfere golpe corpo a corpo | Corte de espada | `sword_slash` (4 variações) | P0 |
| Ataque corpo a corpo acerta alvo | Contato metálico ou abafado | `sword_armor_impact`; `light_thud` e `character_hurt` (2 variações) | P0. Material depende de perfil visual; não há atributo geral de armadura. |
| Lanceiro bloqueia com arma | Choque de metal genérico | `sword_clash` (2 variações) | P0. O motor tem bloqueio; não calcula aparo específico entre espadas. |
| Guerreiro bloqueia com escudo | Pancada no escudo | `shield_impact` (5 variações) | P0. Escudo confirmado no asset; registrar o resultado real, sem inferir apenas da pose `defend`. |
| Lanceiro ataca | Estocada de lança | `spear_thrust` (6 variações) | P0 |
| Arqueiro dispara, inclusive da torre | Soltura da corda | `bow_release`; `arrow_release` (2) e `bow_string_twang` como alternativas | P0. Um release; `bow_draw` depende de marcador de preparação na animação. |
| Flecha viaja e atinge unidade | Voo e impacto conforme o alvo | `arrow_flight`, `arrow_impact`; componentes ou sequência composta, nunca ambos juntos | P0 |
| Monge cura aliados | Conjuração e efeito de cura | `magic_cast` e `magic_heal` | P0 |
| Tropas são mobilizadas para campanha | Toque de convocação | `war_call` | P0. Um toque por campanha. |
| General ordena recuo | Toque de retirada | `retreat_ordered` | P1. Só na ordem aceita; recuos automáticos precisam de decisão própria. |
| Tropas atacam torre ou instalação | Impacto em madeira/pedra | `wood_impact`, `arrow_impact`, `arrow_wood_impact` | P0. O jogo ainda não classifica material de todos os prédios. |
| Estrutura é destruída | Desabamento/entulho | `building_destroyed` (4 variações) | P0. Sortear uma vez por destruição, não a cada dano. |
| Torre é capturada | Confirmação de mudança de dono | Falta som específico | P1. Captura não deve tocar desabamento. |
| Pessoa morre em combate | Impacto de morte na última posição conhecida | `body_fall_fatal` ou `body_thud` | P1. Escolher um; animação de queda é melhoria opcional. |
| Recrutamento termina | Confirmação de unidade pronta | Falta | P1 |
| Soldados treinam em combate simulado | Golpes de treino mais leves | `sword_slash` e `wood_impact` podem ser reutilizados | P2 |

## Moradores, trabalho e recursos

| Ação existente | Som indicado | Cobertura do manifesto | Prioridade |
|---|---|---|---|
| Derrubar árvore (`gather`) | Movimento e batida de machado | `axe_slash`, `wood_impact` | P0. Corrigir aproximação/contato; não há confirmação de som de tombamento nem animação de queda da árvore. |
| Extrair pedra ou ouro (`gather`) | Picareta e fragmentos | Falta no pacote | P0. Extração e sprites de picareta existem; completar alcance e ciclo visual. |
| Forragear alimento (`forage`) | Colheita de folhas/frutos | Falta | P1 |
| Caçar ovelha selvagem (`hunt`) | Movimento de caça; captura só no sucesso | Falta som específico | P1 |
| Construir ou reparar estrutura (`build`) | Marteladas; conclusão da obra | Falta | P0 |
| Recolher tronco, saque ou ração (`collect_log`, `collect_loot`, `collect_feed`) | Pegar e acomodar carga | Falta | P2 |
| Entregar recursos (`deliver`) | Depósito no estoque | Falta | P1 |
| Negociar no mercado ou com outra comunidade (`trade`) | Troca/pequeno som de moedas | Falta | P1 |
| Compartilhar alimento (`share`) | Entrega breve de item | Falta | P2 |
| Saquear abrigo rival (`raid`) | Retirada de recursos/alerta discreto | Falta | P1 |
| Capturar e conduzir ovelha (`capture_sheep`, `lead_sheep`) | Balido e entrada no curral | Falta | P1 |
| Ovelhas pastam, bebem ou fogem | Balido ocasional, próximo à câmera | Falta | P2; evitar tocar em cada atualização do rebanho |

## Interface e ações sem efeito sonoro próprio

Na interface atual, há ações de selecionar pessoas/estruturas/reinos, abrir e fechar painéis, zoom e navegação do mapa, pausar/retomar, avançar um dia, mudar velocidade, criar outro mundo, construir prédios, recrutar unidades, ordenar ataques, capturar torre e destruir torre. O manifesto não inclui sons de interface ou confirmação. Cliques de seleção e comandos podem ter feedback curto; zoom/pan podem permanecer silenciosos. Para comandos estratégicos, tocar confirmação depois que o jogo aceitar ou rejeitar a ordem.

Patrulhar, guardar posição, voltar à guarnição, beber, descansar, socializar, explorar e migrar são ações ativas, mas não precisam de um efeito individual a cada dia de simulação. Se houver passos, devem ser discretos e limitados às unidades próximas ou selecionadas para evitar repetição excessiva.

## Itens do manifesto sem ação correspondente confirmada

- `crossbow_fire`: não há unidade de besta no elenco atual; arqueiros usam arco.
- `sword_unsheathe`: não identifiquei uma ação ou animação explícita de desembainhar no fluxo atual; fica sem gatilho confirmado por enquanto.
- `character_fall`: não há uma ação atual de queda não fatal. Para morte real de combate, `body_fall_fatal`/`body_thud` podem ser usados na posição do evento.
- `war_horn`: manter como sinal genérico independente; o pacote agora separa convocação (`war_call`) e recuo (`retreat_ordered`).
- Pesca: não está entre as ações disponíveis dos moradores nem nos comandos da interface; fica fora deste mapa.

## Ordem sugerida para completar os sons

1. Corrigir resultados e ciclos de combate/trabalho conforme os pré-requisitos; depois ligar lança, flecha, impactos e destruição já presentes no pacote.
2. Trabalho: picareta, construção/reparo, forrageio e entrega de recursos.
3. Estratégia: confirmação de ordens, retirada/fim de campanha, captura e recrutamento concluído.
4. Economia e tarefas de moradores: troca, saque, ovelhas e caça bem-sucedida.

Na futura integração, tocar sons em eventos efetivos (ataque acertou, carga chegou, obra terminou), não a cada atualização de agente. Batalhas e trabalhos ocorrem em grupo, então é preciso limitar simultaneidade e repetição.

As ações foram conferidas principalmente em `src/config/ecosystem.js`, `src/simulation/individuals/actions.js`, `src/simulation/kingdoms/military.js`, `src/simulation/kingdoms/campaigns.js`, `src/simulation/commands.js` e `src/ui/game.js`.
