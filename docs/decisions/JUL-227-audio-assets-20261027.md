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
