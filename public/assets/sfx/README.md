# Kingdom — Biblioteca completa de efeitos sonoros (v2.8)

**82 efeitos sonoros**. A biblioteca usa OGG e MP3; sons de ovelha, balanço sem contato, impactos combinados de espada/armadura e grunhidos recortados estão disponíveis apenas em MP3. O vento tem uma cópia OGG para reprodução preferencial e o MP3 original como alternativa.

O vento (`wind_ambience`, `effect_wind_ambience_01`) toca em um único loop após a liberação do áudio. O ganho varia suavemente com a câmera: 70% no zoom de 50% e 10% no zoom de 1600%, multiplicado pelo volume geral. O vento acompanha a câmera durante a pausa e não acelera com a simulação. Desativar os efeitos interrompe o loop.

A reprodução começa em `loop_start_seconds=2`, após o trecho inicial muito baixo da gravação. A ativação é tentada novamente em novas interações se o navegador ainda não tiver liberado o áudio; mudanças de câmera atualizam o ganho imediatamente e o contexto reaplica o nível atual ao retomar. Falhas temporárias de carregamento do vento têm novas tentativas espaçadas.

O jogo tenta iniciar o áudio assim que monta a tela. Se a política de reprodução automática do navegador bloquear essa tentativa, o botão de som ao lado das configurações passa a indicar “Ativar som” e o estado muda para “aguardando ativação”; clicar nesse botão ou na tela libera o áudio sem precisar alterar o zoom. Com o áudio ativo, esse botão silencia todos os canais. A preferência de áudio desligado continua sendo respeitada.

Os controles “Música” e “Efeitos” são independentes e salvos localmente; vento e ações passam pelo canal de efeitos. O mute geral não altera os dois volumes. O botão de teste não faz parte da interface.

## Nivelamento de volume

Os 81 efeitos não ambientais (133 arquivos OGG/MP3) têm compensações de volume medidas por formato em `normalization.formats`, aplicadas uma única vez ao ganho de cada reprodução. O alvo é -24 LUFS, com teto de pico verdadeiro de -2 dBTP e amplificação máxima de 14 dB. Impactos com picos muito curtos podem ficar abaixo do alvo para preservar sua dinâmica. Efeitos menores que a janela de medição são medidos por repetição de três segundos. Os arquivos-fonte originais permanecem intactos.

Após a compensação dos arquivos, um barramento próprio dos efeitos repõe 12 dB de ganho para manter as ações audíveis com a atenuação de zoom e distância. O vento passa diretamente ao volume geral e mantém sua curva própria de volume; enquanto efeitos audíveis tocam, ele recua temporariamente para 45% desse volume, respeitando o mínimo de 10%, e retoma suavemente depois. Distância, posicionamento e controles gerais continuam ativos. Um compressor suave protege a saída quando muitos efeitos se sobrepõem.

Para medir novamente: `python scripts/measure-sfx-loudness.py --ffmpeg CAMINHO_DO_FFMPEG --apply`. O relatório fica em `reports/sfx-loudness.json`; nenhum processamento de loudness é feito no navegador.

## Novos efeitos e eventos

- `effect_character_body_impact_01` (`character_body_impact`) → pawn sem armadura atingido por golpe corpo a corpo. Militar continua usando `sword_armor_impact`; flechas usam os eventos próprios de impacto.
- `effect_hammer_build_01` e `effect_hammer_build_02` (`hammer_build`) → variações aleatórias das marteladas durante a construção feita pelo pawn.
- `effect_mining_01` (`mining`) → extração bem-sucedida de pedra ou minério.
- `effect_harvesting_01` (`harvesting`) → coleta bem-sucedida de frutos, arroz ou brotos para ração.
- A colheita de frutos e arroz usa ganho 0,26, metade do nível anterior.
- `effect_sheep_bleat_01` e `effect_sheep_bleat_02` (`sheep_bleat`) → balidos de ovelhas adultas, alternados a cada vocalização.
- `effect_sword_swing_miss_01..03` (`sword_swing_miss`) → uma variação quando um ataque de espada termina sem contato; ganho máximo 0,20, metade do balanço atual.
- `effect_sword_armor_swing_hit_01..11` (`sword_armor_swing_hit`) → balanço seguido de impacto metálico quando espada ou lança atinge armadura; iniciar 180 ms antes do contato. Ganho 0,98 para espada e 0,735 para lança.
- Lanceiros reutilizam os sons de balanço de espada a 0,30 (25% abaixo do 0,40 da espada); em erros, o som sem contato toca a 0,15 (25% abaixo do 0,20 da espada).
- `effect_combat_grunt_01..12` (`combat_grunt`) → doze recortes curtos do arquivo de grunhidos, em cerca de um quinto dos ataques corpo a corpo; ganho 0,18 e até dez vozes simultâneas.
- `effect_lamb_call_mother_01` (`lamb_call_mother`) → chamado de cordeiro com menos de 180 dias quando está separado da mãe registrada.
- `building_melee_impact` → `effect_building_destroy_01` quando espada ou lança causa dano a uma estrutura. Se o golpe também a destruir, o impacto toca primeiro e uma variação do evento `building_destroyed` toca em seguida.
- Flecha contra alvo sem armadura → `effect_arrow_wood_impact_01`; contra alvo militar com armadura → `effect_crossbow_fire_01`, conforme o mapeamento definido.
- `arrow_sequence` mantém `effect_arrow_action_sequence_01` reservado para uma rajada de quatro flechas em arco, caindo numa área. A ação de rajada ainda não existe no combate atual, por isso o evento não dispara em tiros individuais.

As coletas só produzem som quando a simulação registra uma quantidade positiva obtida. O deslocamento até o recurso não produz áudio de mineração ou colheita.

Ovelhas nascem com cerca de 24% da massa adulta e crescem até os 180 dias. A vocalização ambiente é espaçada entre animais e tem volume reduzido conforme a distância.

## Novas funções

### Destruição de construções

Os quatro impactos antes classificados como `effect_rock_smash_01..04` agora são:

- `effect_building_destroy_01`
- `effect_building_destroy_02`
- `effect_building_destroy_03`
- `effect_building_destroy_04`

Evento **`building_destroyed`**. Quando uma construção for efetivamente destruída, **sortear exatamente um dos quatro** e sincronizar com a animação de colapso/entulho. Não tocar todos simultaneamente, nem tocar repetidamente enquanto a construção sofre dano.

### Corneta — guerra e recuo

As duas chamadas da mesma gravação de corneta grave agora têm significados independentes:

- `effect_war_horn_call_01` → evento **`war_call`** (convocação para a guerra).
- `effect_war_horn_retreat_01` → evento **`retreat_ordered`** (ordem de retirada).

O mapeamento de primeira/segunda chamada é uma **decisão de design**, não uma convenção universal reconhecível pelo timbre. Pode ser invertido se a direção de áudio preferir. O efeito `effect_war_horn_01`, vindo de **outra gravação**, continua disponível como corneta genérica (`war_horn`), sem ser vinculado automaticamente aos dois comandos.

## Arquivos

- `audio/ogg/`: formatos recomendados para reprodução web.
- `audio/mp3/`: alternativas de compatibilidade.
- `manifest.json`: metadados, fontes, recortes, IDs e eventos.
- `audio_events.json`: associação dos comandos de jogo aos arquivos e regras de reprodução.

## Migração da versão 2.0

- `effect_rock_smash_01..04` → `effect_building_destroy_01..04`
- `effect_hunting_horn_01` → `effect_war_horn_call_01`
`effect_hunting_horn_02` → `effect_war_horn_retreat_01`

Os nomes anteriores foram substituídos no pacote para evitar duplicação e manter um ID inequívoco para cada efeito.

## Nota sobre licenças

As fontes originais estão documentadas em `manifest.json`. Verificar individualmente as licenças antes de distribuir o jogo ou seus assets.
