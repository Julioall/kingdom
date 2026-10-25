# Plano do sistema de efeitos sonoros

## 1. Objetivo e estado atual

O plano trata dos efeitos das ações que já existem no Kingdom. Não considera mecânicas apenas sugeridas. O pacote analisado é `C:\Users\Julio\Downloads\Kingdom_SFX_Completo_v2_1.zip`, versão 2.1.0.

O manifesto referencia 38 nomes de fontes distintos; o ZIP fornece 47 efeitos processados em 28 grupos de evento. Cada efeito tem uma versão OGG e uma MP3 (94 arquivos de áudio, cerca de 1,81 MiB no total). As 38 gravações originais não são arquivos adicionais do pacote. Os efeitos ainda não estão extraídos para o projeto, e não encontrei código de reprodução de som.

A validação encontrou pré-requisitos de combate, mineração e apresentação. O [levantamento anterior à implementação dos sons](audio-prerequisites.md) define a ordem e os critérios de saída: resultados explícitos de ataque, animações com contato, trabalho próximo ao recurso, eventos transitórios compartilhados com os efeitos visuais e correção/validação da entrada nas torres. Este plano fica condicionado à conclusão desses pontos em cada fluxo que receber áudio.

A [pesquisa de hitboxes e sincronização de combate](combat-collision-research.md) propõe o próximo estágio: corpo, defesa e armas como regiões distintas, fases autoritativas e passos menores apenas no combate. Essa proposta vai além do replay simplificado do motor diário e precisa ser prototipada antes dos sons.

As fontes do jogo executam ações no Worker de simulação e enviam snapshots à interface. `world.events` é um registro textual curto, sem ID de evento ou coordenada estável para cada ação; não deve ser usado como canal de áudio. Já existem sinais visuais úteis — `lastArrowSequence`, `lastAttackSequence`, `visualActivity`, eventos de campanha e destruição de estruturas — que podem orientar os novos eventos sonoros.

## 2. Reaproveitamento dos efeitos existentes

| Ação atual | Efeitos que podem ser reaproveitados | Ligação recomendada |
|---|---|---|
| Guerreiro ataca | `sword_slash` (4) | Um corte por ataque iniciado, com variação escolhida pelo áudio, sem chamar por quadro da animação. |
| Ataque acerta alvo | `sword_armor_impact` (1), `light_thud` (1) | O motor não tem um atributo geral de armadura. Usar perfil visual confirmado ou contato neutro, sem mudar resistência/dano para classificar som. |
| Ataque é bloqueado | `shield_impact` (5) ou `sword_clash` (2) | Guerreiro tem escudo no asset; lanceiro defende com arma. Registrar o resultado real e o perfil do defensor; `defend` é atribuído também em acertos normais e não comprova bloqueio. O choque do lanceiro é metal genérico, não um aparo de espadas calculado pelo motor. |
| Lanceiro ataca | `spear_thrust` (6) | Um som por estocada. O jogo já distingue a classe `lanceiro`. |
| Arqueiro dispara | `bow_release`; alternativas `arrow_release` (2), `bow_string_twang` | Adotar componentes separados. Um release no início do projétil; candidatos alternativos dependem de audição. `bow_draw` só entra após existir marcador de preparação na animação, sem adiar o tick da simulação. |
| Flecha viaja e atinge alvo | `arrow_flight`, `arrow_impact`, `arrow_wood_impact` | Usar o mesmo relógio e duração da flecha visual, com resultado `miss|blocked|hit` no evento. Impacto apenas no contato correto. Não reproduzir as sequências compostas junto dos componentes. |
| Monge cura | `magic_cast`, `magic_heal` | Uma conjuração e no máximo um efeito de cura por cast, associado ao alvo principal/área, mesmo havendo vários beneficiários. |
| Pessoa recebe dano | `character_hurt` (2), `light_thud` (1) | Reação curta, apenas em dano real e com limite por unidade/intervalo para não virar uma camada constante de vozes. |
| Pessoa morre em combate | `body_fall_fatal` ou `body_thud` | Um som no evento de morte e na última posição conhecida; não requer uma nova mecânica de queda. Uma animação própria é melhoria visual. Para morte por flecha, apresentar a morte no contato visual. |
| Morador derruba árvore (`gather`, atividade `chop`) | `axe_slash`, `wood_impact` | Reaproveitar movimento e batida após corrigir aproximação/contato. `wood_impact` não confirma som de tombamento, e a árvore atual vira toco sem animação de queda. |
| Ataque danifica estrutura | `wood_impact`, `arrow_wood_impact`, `arrow_impact` | Impacto conforme arma/alvo. O modelo não registra material de todos os prédios, então usar impacto específico de madeira somente quando a classificação do alvo for confiável. |
| Estrutura é destruída | `building_destroyed` (4) | Sortear uma variação por destruição. O evento ocorre só quando a estrutura passa a destruída, nunca por cada dano recebido. |
| Campanha é mobilizada | `war_call` (1) | Um toque global por campanha efetivamente criada, inclusive mobilização automática; sem repetir por lado ou tropa. |
| General ordena recuo | `retreat_ordered` (1) | Somente para a ordem `withdraw` validada do general. O estado `withdrawing` também acontece após vitórias/armistícios e não é esse gatilho. |

### Efeitos do pacote sem gatilho atual ou com uso condicional

- `crossbow_fire`: sem unidade de besta no jogo atual; os arqueiros usam arco.
- `sword_unsheathe`: não há uma ação/animação explícita de desembainhar.
- `character_fall`: não há uma animação atual de queda de unidade.
- `body_fall_fatal` e `body_thud`: podem representar uma morte real de combate; escolher um, não sobrepor os dois. A animação de queda é opcional.
- `war_horn`: fica disponível para outro sinal estratégico; com `war_call` e `retreat_ordered`, não precisa duplicar esses eventos.
- `effect_arrow_action_sequence_01` e `effect_arrow_flight_impact_sequence_01` são composições de significado e duração diferentes. `audio_events.json` os agrupa no mesmo `arrow_sequence`; a tabela de runtime deve separá-los em eventos distintos ou escolher explicitamente apenas um fluxo composto.

## 3. Ações existentes ainda sem som no pacote

Estas ações estão ativas no jogo, mas não encontrei nelas um efeito específico entre os 47 do pacote:

- Minerar pedra e extrair ouro (`gather` com atividade `mine`): picareta e fragmentos.
- Forragear alimento (`forage`): colheita curta de frutos/raízes.
- Construir ou reparar (`build`): trabalho de obra, início e conclusão.
- Recolher tronco, saque ou ração e entregar carga (`collect_log`, `collect_loot`, `collect_feed`, `deliver`): pickup/depósito. Podem compartilhar um som de depósito com variação por material.
- Trocar recursos, compartilhar alimento ou saquear (`trade`, `share`, `raid`): confirmação da transação, partilha ou alerta discreto.
- Capturar/conduzir ovelha (`capture_sheep`, `lead_sheep`) e atividades do rebanho: balido. Não há ação de abertura de portão confirmada.
- Captura de torre: confirmação de mudança de dono, separada de destruição; não reutilizar desabamento.
- Feedback de interface: seleção, ordem aceita/rejeitada, recrutamento concluído, pausa, avanço de dia e mudança de velocidade.
- Bebida, descanso, socialização, exploração, migração, patrulha, guarda e retorno à guarnição não precisam de um efeito novo por ação/dia. Passos podem ser uma camada futura, restrita a unidades próximas ou selecionadas.

Pesca não está entre as ações ativas do jogo e continua fora do plano.

## 4. Arquitetura proposta

### Fronteira entre simulação e áudio

1. A simulação emite eventos de apresentação sem conhecer o navegador ou APIs de áudio. Um `combat.attack_resolved` registra a ação e seu resultado, evitando emissões independentes e contraditórias por cada campo de saúde/pose.
2. Campos mínimos: `eventId`, `actionId`, `type`, `day`, `simulationTime`, IDs/classes de origem e alvo, posições/alturas e ponto mirado, `outcome`, dano aplicado e indicador de morte. O envelope já identifica a época. IDs de apresentação usam contador separado de `world.nextId` e do RNG.
3. O coletor é transitório e fica fora do objeto `world`; `createWorldSnapshot` copia os campos do mundo em `base`. O lote vai no envelope da resposta, com dias inicial/final, eventos e contagem de descartes. Limite inicial proposto: 512 registros por solicitação, reservando espaço para sinais estratégicos e destruições; medir esse valor.
4. O Worker aceita até 12 dias por pedido; avanços do relógio são agrupados em até 3 pela sessão. Transportar os resultados selecionados desse período, mas condensar ações locais repetidas por ator/tipo. A apresentação utiliza o evento recente compatível com o snapshot final, sem reproduzir uma história de 12 dias de sons sobre uma única imagem.
5. `GameSession` valida época/revisão, aplica a projeção e entrega o lote uma vez ao coordenador de apresentação antes de renderizar. Visuais e áudio compartilham seleção, `actionId` e relógio. Remover os caminhos equivalentes antigos por comparação de snapshot para não duplicar flechas, cura e poeira de trabalho.
6. No motor atual, o voo de 350–850 ms existe somente na apresentação. No modelo por contato pesquisado, disparo, fases e voo precisam de tempo autoritativo no Worker e perfis compartilhados com a UI; a visualização segue esse tempo sem recalcular um contato independente. Inicialização/reset descartam histórico; época/revisão expirada não toca nada.
7. O áudio fica na thread principal. A coleta desativada deve ser sem efeito sobre a simulação e sobre os cenários de diagnóstico. Nunca derivar acertos somente de `lastAttackSequence`, pose `defend` ou textos de `world.events`.

A mudança deve atualizar os tipos em `protocol.ts`, incrementar a versão de protocolo e atualizar o runtime, a sessão e a documentação do contrato. Eventos de UI, como ordem aceita/rejeitada, são locais à conclusão de `session.dispatch`; não duplicá-los no diário da simulação.

O registro textual de campanha, como mobilização, batalha, armistício e cerco, ajuda a localizar os pontos de emissão, mas não substitui eventos sonoros próprios: ele é histórico, limitado e voltado ao diário.

### Componentes sugeridos

- `src/audio/audio-catalog.js`: catálogo curado de tipos de evento, pools de variação e caminhos de arquivo. Separar aliases semânticos de IDs de arquivo.
- `src/audio/audio-manager.js`: inicialização, carregamento/decodificação, volume, limites simultâneos, distância, prioridade, deduplicação e encerramento de vozes.
- Coordenador de apresentação compartilhado com `createActivityEffects`: seleciona o evento, mantém a pose transitória e agenda contato visual/sonoro uma vez.
- `public/audio/ogg/` e `public/audio/mp3/`: conservar os pares do pacote, pequeno o suficiente para fallback (cerca de 1,81 MiB somando ambos). Carregar/decodificar somente um formato por efeito; tentar MP3 se o OGG falhar. Não baixar ambos em cada reprodução.
- Preservar `manifest.json`, `audio_events.json` e `README.md` do pacote junto à documentação de assets/licenças. O runtime deve usar o catálogo revisado, não consumir cegamente todos os agrupamentos do `audio_events.json`.

Usar Web Audio para decodificar cada arquivo uma vez e criar uma nova fonte por reprodução. Criar ou retomar o `AudioContext` após uma interação do usuário; navegadores podem bloquear áudio iniciado sem interação. A API também permite controle de ganho e panorâmica. Referências: [boas práticas da Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) e [AudioContext.resume()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume).

## 5. Regras de reprodução e mixagem

- Um efeito por evento semântico: um acerto não deve emitir simultaneamente “golpe”, “armadura”, “escudo” e “ferimento” se só um desses resultados ocorreu.
- Variação aleatória fica no gerenciador de áudio e não usa o RNG da simulação.
- Priorizar evento próximo, selecionado ou estratégico; reduzir volume com a distância da câmera e panoramizar pela posição horizontal no mapa.
- Eventos fora de cena e sons de trabalho repetitivos podem ser descartados. Não formar filas de áudio antigas quando a simulação avança a 2×/3×.
- Limitar a simultaneidade por categoria e por posição/fonte. Em uma batalha grande, preservar os eventos mais informativos e misturar ataques repetidos em vez de tocar cada golpe.
- Volume principal, combate, mundo/trabalho e interface precisam de controles próprios, com opção geral de mudo e preferências persistidas.
- Se a aba ficar oculta, não acumular áudio para tocar depois; ao voltar, só eventos novos devem ser reproduzidos.
- A velocidade de simulação não acelera a duração/altura dos arquivos. Ela aumenta a taxa de eventos, que deve ser contida pelos limites de mixagem.
- Limites iniciais de afinação: 16 vozes simultâneas globais, com reserva para UI e um sinal estratégico. Contato de combate, fala de dor e trabalho têm limites próprios e descarte por prioridade; esses números precisam ser medidos no jogo.
- Cornetas estratégicas e UI usam canal global, independente da distância da câmera. Efeitos locais usam posição e enquadramento; na visão geral, priorizar a seleção e reduzir o trabalho repetitivo de toda a população.
- Catálogo sem asset, arquivo ausente ou falha de decode não pode impedir a ação nem provocar tentativas de download a cada quadro. Marcar indisponibilidade, registrar um diagnóstico limitado e continuar silenciosamente. Não tocar uma fila antiga após o arquivo carregar.
- O relógio visual atual continua durante a pausa, mas o modelo por contato precisa pausar a progressão lógica e visual dos golpes/projéteis e seus marcadores ainda não alcançados. Caudas de sons já iniciados podem terminar. O avanço manual apresenta o intervalo avançado uma vez. Mudo, aba oculta e reset cancelam agendas apropriadas; não suspender indiscriminadamente o contexto e perder feedback de interface.

## 6. Sequência de entrega

1. **Corrigir os ciclos de gameplay/apresentação:** seguir `audio-prerequisites.md`, com resultados de combate, animações/contato, alcance da mineração/corte e contrato de entrada nas torres.
2. **Adicionar o canal transitório Worker → UI:** eventos com IDs próprios, apresentação visual compartilhada, lotes limitados e reset sem duplicação; cobrir destruição, captura e ordens estratégicas.
3. **Validar os pré-requisitos sem som:** testar resultados, posição e duração das ações em 1×/2×/3×, avanços em lote, pausa, reset e estado da simulação com a coleta ligada/desligada.
4. **Auditar os recortes e preparar o catálogo:** ouvir os candidatos, especialmente flecha e destruição; conferir licenças antes de distribuir; extrair os pares de formatos e conservar atribuição. As sequências compostas de flecha ficam fora da reprodução padrão.
5. **Construir o núcleo de áudio:** desbloqueio em interação, carregamento/decodificação, volumes, mudo, limite de vozes, prioridade e mixagem espacial 2D.
6. **Ligar os sons disponíveis:** começar por combate/campanha; adicionar trabalho e interface conforme os assets chegarem. Eventos sem arquivo ficam conhecidos e silenciosos.
7. **Ajustar no jogo:** conferir sincronização visual, distância, repetição, volume em batalhas/populações grandes e preferências após recarregar.

## 7. Decisões fechadas na validação

- Arqueiros usam componentes sincronizados; um release, voo opcional e um contato conforme o resultado. Sons alternativos de release ficam para seleção auditiva, e composições completas permanecem fora do fluxo padrão.
- `war_call` representa a mobilização efetiva, automática ou solicitada. `retreat_ordered` representa a ordem explícita aceita; retorno normal após armistício não recebe esse som.
- Morte real de combate pode usar um impacto na última posição conhecida; não exigir arte nova para permitir o áudio. Uma animação própria melhora a leitura e deve acompanhar a apresentação de mortes por flecha no contato.
- Material do alvo é um perfil de apresentação, com fallback neutro; não presumir escudo/armadura/madeira a partir apenas de redução de saúde.
- A aquisição de novos sons não bloqueia o núcleo; eventos sem arquivos ficam conhecidos e desativados até o respectivo pacote chegar.

## 8. Resultado e alcance da validação

O ZIP passou na conferência estrutural: 47 IDs únicos, 47 OGG e 47 MP3 referenciados e presentes, 28 grupos coincidentes nos dois JSON, 38 nomes de fonte distintos, durações declaradas coerentes e nenhum OGG idêntico por SHA-256. Isso não comprova a qualidade dos cortes, volume, semântica auditiva ou licença de cada origem.

A semente 42 produziu mineração real e há sprites de picareta nas cinco paletas. A mecânica existe, mas extrai fora de alcance visual e não tem um ciclo de contato confiável. Um acerto controlado incrementou duas vezes o contador usado para dano. Dos 41 testes existentes selecionados, 39 passaram; dois casos de entrada na torre precisam ser reconciliados com os offsets de colisão.

Evidências e pré-requisitos: [avaliação detalhada](audio-prerequisites.md), [cenários de simulação](../reports/audio-prerequisites-audit.json) e [resumo da validação](../reports/audio-prerequisites/validation-summary.json). O parecer é viável com as correções descritas; a ligação dos sons de combate e trabalho depende dessas correções, e ainda falta audição individual dos efeitos.
