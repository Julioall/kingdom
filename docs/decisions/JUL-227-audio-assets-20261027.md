# JUL-227 — proveniência e distribuição dos efeitos de combate

Data da revisão: 27/10/2026
Escopo: 26 recortes MP3 (11 balanços com impacto, 3 balanços sem contato e 12 grunhidos), acionamento e níveis de áudio.

## Fontes localizadas

A revisão das páginas oficiais do Pixabay identificou 15 gravações de origem. As 11 variações de metal/whoosh são de floraphonic (IDs 234620, 234623, 234626, 234627, 234629, 234625, 234635, 234630, 234628, 234622 e 234632). As três variações de vento são de Phoenix_Connection_Brazil (IDs 108398, 108400 e 108401), adaptadas como balanço sem contato. Os doze recortes vocais vêm da página “grunts”, ID 33249, creditada na página a mattgarkusha (Freesound); a conta que distribui a página é freesound_community.

Cada um dos 26 efeitos agora aponta no manifest.json para título, URL da fonte, criador, licença declarada pela página e data da revisão. As páginas do Pixabay para as três famílias declaram uso gratuito sob a Pixabay Content License. O resumo oficial permite uso gratuito e adaptação sem atribuição obrigatória, mas veda redistribuir o conteúdo de forma autônoma; os termos completos são a fonte juridicamente vinculante.

## Decisão

Manter esta implementação em uma branch de desenvolvimento e numa PR draft para que possa ser revisada e testada no jogo. Não integrar em main até resolver como os arquivos públicos acessíveis individualmente serão distribuídos, guardar prova de download/origem e fazer playtest audível. A página/licença localizada resolve a identidade da fonte dos grunhidos; ela não comprova quando/por qual conta o arquivo foi baixado nem, sozinha, aprova o formato de empacotamento do produto.

Alternativas consideradas:

1. Remover os 26 arquivos até a revisão: elimina o risco de distribuir antes de decidir, mas impede revisar o comportamento de áudio que motivou os recortes.
2. Manter a fatia isolada em dev/PR draft: preserva implementação e testes, permite avaliação interna e bloqueia promoção a produção. Escolhida.
3. Substituir por gravações originais ou assets sob licença compatível com arquivos autônomos: alternativa preferida se a revisão do pacote público não confirmar o formato atual.

## Pendências de aceite

- Guardar comprovantes de download para as 15 fontes.
- Validar a distribuição de recortes MP3 acessíveis sob public/assets contra os termos aplicáveis; substituir/empacotar de outra forma se necessário.
- Fazer playtest audível de acerto em armadura, acerto sem armadura, erro, defesa e grunhido, conferindo volume, sincronização e duplicação.
- Manter JUL-227 aberta e esta PR em draft até as pendências acima estarem demonstradas.

## Fontes oficiais consultadas

- Pixabay Content License Summary: https://pixabay.com/service/license-summary/
- Pixabay Terms of Service: https://pixabay.com/service/terms/
- As URLs individuais dos 15 assets estão registradas no manifest.json (cada recorte aponta à sua fonte).

## Revisão de game audio e pesquisa

Data: 27/10/2026

- Aplicada a skill Game Studio `game-playtest`: para uma mudança puramente sonora, screenshot não comprova mix ou sincronização. O aceite audível ainda precisa testar acerto em armadura, acerto sem armadura, erro, defesa e grunhido, incluindo duplicação, volume e alinhamento com contato.
- A busca do SciSpace para estudos de feedback auditivo encontrou `Synchronization in games sound: an audiovisual study on player experience and performance` (2022, DOI https://doi.org/10.1145/3534085.3534342) e `Good Feedback for bad Players? A preliminary Study of ‘juicy’ Interface feedback` (2016). Os resumos indexados apontam que dessincronização pode piorar experiência/desempenho e que feedback redundante pode ter custo de desempenho; a evidência é contextual e não comprova benefício neste jogo. A tentativa de abrir as páginas do editor ACM retornou 403, então tratamos esses resultados como orientação de desenho, não como validação independente.
- Decisão de desenho: manter somente sinais de evento que correspondem ao resultado real do golpe/defesa e preservar o agendamento junto ao contato; não adicionar camadas redundantes. A validação final continua sendo playtest audível do jogo.
- Consensus não pôde ser consultado: a cota gratuita informou 30 buscas mensais esgotadas, com reset em 1º/11/2026. Nenhuma conclusão foi inferida dessa indisponibilidade.
- Alternativas: manter os efeitos como draft para playtest interno; remover os arquivos até a revisão; ou substituir por gravações próprias/CC0 se o empacotamento dos recortes não for aceito. A opção de draft foi mantida, sem promoção a produção.

## Browser smoke checkpoint — 27/10/2026

No SHA de código `a04d053` (PR final após complemento documental: `e1e4494`), o jogo abriu em `http://127.0.0.1:4176/` e avançou do dia 4 ao dia 217 a 3×. Os controles mostraram áudio ligado e o status “Efeitos sonoros e vento prontos”; não houve erro nem aviso no console. As crônicas registraram combates nos dias 93, 105 e 119 e armistício no dia 196, com as campanhas retornando. Isso demonstra que o runtime e a cadeia de áudio inicializaram durante uma sessão com combate. Não confirma a audibilidade, mix ou sincronização de cada efeito; esses cinco casos seguem como aceite pendente. O wrapper `npm run dev` encontrou a porta local do serviço de IA já ocupada, então o smoke usou Vite diretamente em 4176 sem interromper o processo existente.
