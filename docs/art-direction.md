# Kingdom — direção de arte para novos recursos

Data: 24/10/2026. Referência: assets atuais de `public/assets/tiny-swords/`, `public/assets/kingdom-autotile/` e `public/assets/kingdom-ui/`.

Definição de designer: **fantasia medieval acolhedora em pixel art cartoon, com personagens chibi, volumes compactos, contornos azul-marinho, iluminação pictórica por blocos de cor e materiais quentes equilibrados por sombras azuladas e verde-petróleo. Perspectiva de jogo vista de cima em três quartos, com fachadas e volumes visíveis.**

Este guia descreve a compatibilidade visual com os arquivos presentes. As cores foram extraídas de 20 referências representativas; os papéis de materiais, iluminação e desenho são interpretações visuais. As recomendações de produção são critérios de direção de arte, não alegações sobre o processo original do artista.

## Personalidade visual

O mundo tem formas amigáveis, artesanais e levemente exageradas: casas estreitas com telhados altos, castelos arredondados, pedras grandes, vegetação em massas e equipamentos fáceis de identificar. O desenho transmite aventura e legibilidade, mesmo quando a simulação representa escassez ou guerra.

Adjetivos de referência: medieval, lúdico, compacto, expressivo, artesanal, colorido e legível. O acabamento é de sprite 2D com linguagem de pixel art e sombreado em áreas delimitadas. Construções e copas possuem detalhes de pincelada traduzidos em clusters, como veios de madeira e folhagens recortadas.

## Câmera e desenho

- Construir para uma câmera elevada: mostrar topo/telhado e frente do objeto, com profundidade curta. Usar perspectiva ortográfica estilizada de três quartos como descrição de produção; o ângulo exato não foi medido.
- Usar os assets vizinhos como gabarito de inclinação e proporção. O cenário é montado em grade quadrada; os arquivos não estabelecem uma grade isométrica de losangos 2:1.
- A silhueta deve comunicar identidade antes da textura. Porta, telhado, copa, ferramenta e arma são massas reconhecíveis em escala pequena.
- Preferir curvas simplificadas, cantos suavizados pelo desenho e pequenas irregularidades orgânicas. Paredes, torres e objetos têm volume robusto e pouco detalhe fino.
- Aplicar contornos escuros coloridos. Separações internas podem usar tons do próprio material; evitar uma espessura única imposta a famílias de resolução diferente.
- Preservar espaços negativos entre corpo e equipamento. Detalhes menores devem continuar legíveis com a câmera afastada.

## Personagens e animais

Personagens são chibi: cabeça/chapéu/capacete dominantes, tronco curto, membros reduzidos, mãos e pés simplificados. O rosto usa poucos sinais; profissão e papel aparecem principalmente na silhueta, ferramenta, carga e vestimenta.

Como orientação para novos humanos, usar cabeça e cobertura ocupando aproximadamente metade da altura corporal visível, ajustada ao gabarito. Essa proporção é uma recomendação visual aproximada, sem segmentação anatômica medida; armas, sombras e adornos ficam fora dessa comparação.

Guerreiros têm equipamentos maiores e posturas mais marcadas. O canvas amplo da lança acomoda a arma, sem significar que o lanceiro possui um corpo maior que os demais. Animais usam volumes arredondados e poucos traços; a ovelha se lê como massa clara de lã sobre cabeça/pernas escuras.

Para gestos sociais, manter a escala do corpo e apoiar expressão em inclinação da cabeça, mãos e postura: falar, ouvir, oferecer, receber e recusar. Acessórios e balões ficam separados quando possível para reutilização. Gestos novos precisam de âncora estável e identificação inequívoca do objeto entregue.

## Luz, volume e textura

- Leitura predominante de luz superior, com vários destaques superiores/esquerdos; direção inferida visualmente. Conferir a face equivalente na referência da família, pois a luz não é uniforme em todo o acervo.
- Modelar materiais com poucos níveis visíveis de sombra, base e luz. Como ponto inicial, trabalhar com 3–4 tons por material e expandir apenas quando a referência justificar.
- Fazer mudanças de matiz: vegetação vai de verde-amarelado à luz para verde-petróleo/azulado na sombra; metais combinam cinza esverdeado e luz menta; madeira conserva marrons/ocres e sombras vinho.
- Trabalhar texturas em manchas e grupos de pixels: tábuas, lascas, pedras, tufos e telhas. A densidade deve ser menor nas áreas que precisam destacar rosto, ferramenta ou identificação de facção.
- Sombra de contato curta, escura e discreta, apoiando o sprite no chão. Preservar a sombra já incluída na referência e conferir se o renderer adiciona outra.
- As amostras têm poucas cores opacas dominantes e vários sprites incluem alfa parcial. Manter transições de borda coerentes com a família; evitar blur, brilho difuso e degradação causada por reamostragem.

## Paleta medida e uso recomendado

Os códigos abaixo são cores presentes nos PNGs indicados. Representam uma seleção funcional, não uma paleta global fechada. A ordem das rampas é sombra → base → luz, escolhida por interpretação do material.

| Família/material | Cores de referência | Fonte e aplicação |
|---|---|---|
| Contorno e profundidade | `#161C2E` | Presente em personagens, árvores, construções, terreno e UI; azul-marinho quase preto |
| Pele do morador | `#C8A876` → `#EFE1AB` | `people/blue/pawn_idle.png`; sombra e luz do rosto |
| Tecido/chapéu terroso | `#5E5455` → `#977B6B` → `#ADA081` | Mesmo morador; cinza amarronzado e couro/tecido |
| Madeira da casa azul | `#74514B` → `#8D6857` → `#BD8A59` → `#E5BE76` | `buildings/blue/house1.png`; estrutura e destaques |
| Alvenaria clara | `#BBAE93` → `#E1DCA3` | Casa/castelo azuis; pedra/reboco quente |
| Metal esverdeado | `#688C8A` → `#9CBEAA` → `#D4EDC2` | Guerreiro/lanceiro azuis; aço estilizado e luz menta |
| Conífera | `#315A6D` → `#2D8381` → `#37AE7B` → `#68D367` | `trees/tree-1.png`; sombra azul até verde luminoso |
| Copa amarelada | `#49655C` → `#699157` → `#BBBC41` → `#F1D15F` | `trees/tree-3.png`; alternativa existente para vegetação |
| Grama | `#80AC5E`, `#9BB94E`, `#B8B958` | `kingdom-autotile/Tilemap_color1.png`; massas e variação |
| Rochas de borda | `#354F59` → `#486F66` → `#669D9D` → `#8CC3C4` | Mesmo atlas; profundidade e faces azul-esverdeadas |
| Água base | `#47ABA9` | `kingdom-autotile/water-background.png`; arquivo base de cor única; desenho final recebe espuma e tratamento do renderer |
| Ouro | `#AC7A58` → `#CEA554` → `#E9F044`, detalhe `#FFFFFF` | `minerals/gold-stone-1.png`; recurso luminoso de alto contraste |
| Pergaminho | `#C4B2AF` → `#E2D0C2` → `#EEE1C6` | `kingdom-ui/paper.png`; bordas, marcas e superfície |
| Madeira de interface | `#53373C` → `#6E4D4D` → `#9B6253` → `#D7B888` | `kingdom-ui/wood-panel.png`; moldura/material de UI |

### Facções

As cinco variantes de `house1.png` têm a mesma geometria e bbox, mas trocam rampas coordenadas de telhado, madeira e alguns neutros. Portanto, uma variante de facção deve ser uma recoloração por materiais; um filtro global de matiz não preserva necessariamente a hierarquia existente.

| Família de facção | Sombra do telhado | Base | Luz |
|---|---|---|---|
| Azul/ciano | `#4C5C8B` | `#4795A7` | `#63B7BA` |
| Vermelho/coral | `#924159` | `#DE5454` | `#F4A47B` |
| Amarelo/ocre | `#98694E` | `#DCAA46` | `#F9E279` |
| Roxo/malva | `#5C547E` | `#A37096` | `#C88BAD` |
| Preto/ardósia | `#413E52` | `#54667E` | `#7D95A5` |

Personagens e UI usam rampas próximas, mas não idênticas às construções. No guerreiro azul aparecem `#485884` e `#4697AC`; no brasão ciano aparecem `#425062`, `#4D7084` e `#3F8C9B`. Escolher a família de referência antes de aplicar a recoloração. O preto de facção é ardósia colorida, distinto do contorno comum `#161C2E`.

## Resolução, escala e entrega

Dimensões abaixo vêm dos arquivos/manifesto atuais. A bbox é do primeiro quadro, com alfa maior que zero e incluindo sombra; origem superior esquerda e limites finais exclusivos. Ela não mede isoladamente corpo, chão, colisão ou área ocupada no mapa.

| Referência | Canvas por quadro/arquivo | Área visível do primeiro quadro | Quadros |
|---|---|---|---|
| Morador azul em idle | 192 × 192 | 52 × 71; bbox `(69,64)–(121,135)` | 8 |
| Guerreiro azul em idle | 192 × 192 | 79 × 89; bbox `(62,48)–(141,137)` | 8 |
| Lanceiro azul em idle | 320 × 320 | 69 × 150; bbox `(115,48)–(184,198)`; inclui lança | 12 |
| Ovelha em idle | 128 × 128 | 45 × 44; bbox `(41,40)–(86,84)` | 6 |
| Conífera 1 | 192 × 256 | 119 × 190; bbox `(37,51)–(156,241)` | 8 |
| Árvore 3 | 192 × 192 | 90 × 146; bbox `(51,24)–(141,170)` | 8 |
| Casa azul 1 | 128 × 192 | 112 × 157; bbox `(8,16)–(120,173)` | Arquivo estático |
| Castelo azul | 320 × 256 | 312 × 208; bbox `(4,41)–(316,249)` | Arquivo estático |
| Ouro pequeno | 128 × 128 | 32 × 29; bbox `(48,50)–(80,79)` | Arquivo estático |

Para variantes compatíveis:

- Duplicar o gabarito de canvas, escala corporal e âncora da família. Aproveitar margens para gestos, equipamento e movimento, sem preencher o canvas inteiro com o objeto.
- Exportar PNG RGBA, preservando proporção e transparência. Não embutir fundo de cenário no sprite isolado.
- Para sprite animado, manter células de dimensões fixas, sequência explícita e âncora consistente. Registrar estados, direções, ordem, FPS e loop no manifesto.
- Tempos vêm do runtime. O manifesto registra, por exemplo, 10 FPS para a conífera; um PNG sozinho não comprova o tempo autoral. Conferir cada ação antes de reutilizar a cadência.
- Projetar animação com antecipação, ação e recuperação quando pertinente. Idle e vento devem ser discretos; gestos sociais precisam funcionar mesmo observados parcialmente.
- Inspecionar o ciclo inteiro e a transição último→primeiro. O presente estudo usa imagens estáticas e medições dos quadros; não aprova novos ciclos de animação.
- Comparar a 100%, ampliado por vizinho mais próximo e no zoom real do jogo. O passo de pixel efetivo deve seguir a referência; os canvases grandes não autorizam detalhe arbitrariamente fino.
- Terreno novo exige encaixe entre bordas, cantos, topo, parede e rampa conforme o atlas/renderer. Uma ilustração isolada não constitui um autotile pronto.
- UI modular deve respeitar regiões esticáveis/repetíveis e molduras. O brasão ciano de referência contém partes separadas para composição; seu PNG não representa um escudo inteiro já montado.

## Briefing reutilizável

> Criar [RECURSO] para Kingdom, compatível com a referência [ARQUIVO]. Fantasia medieval acolhedora em pixel art cartoon, volumes compactos e silhueta clara. Câmera elevada em três quartos, com topo e fachada visíveis conforme o gabarito. Personagens chibi com cabeça/cobertura grande, corpo curto e membros simplificados. Contornos azul-marinho `#161C2E`, materiais em blocos de sombra, base e luz, com sombras frias e destaques quentes. Textura artesanal organizada em clusters de pixels. Aplicar a rampa de [MATERIAL/FACÇÃO] extraída da família de referência. Preservar canvas [L × A], escala do corpo, âncora [X,Y] e margens do gabarito. Entregar PNG RGBA [estático / sequência especificada], com transparência e bordas compatíveis. Manter leitura em tamanho pequeno, consistência entre quadros e iluminação coerente com os assets vizinhos.

Preencher material, referência, dimensões e âncora antes de gerar. Para equipamento assimétrico, definir quais direções podem ser espelhadas e quais precisam de desenho próprio. O briefing orienta o resultado visual; dimensões, alinhamento e integração precisam de verificação posterior.

## Critérios de revisão de design

- O recurso pertence à mesma família visual quando colocado entre uma casa, um morador e uma árvore existentes?
- A silhueta explica função/espécie/profissão no zoom normal?
- A rampa mantém contraste entre contorno, sombra, base e luz e diferencia facções?
- A perspectiva, o apoio no chão e a escala combinam com a referência?
- A textura preserva áreas de descanso e não compete com rosto, equipamento e sinalização?
- Equipamento, sombra e gesto cabem no quadro, com âncora estável?
- Transparência e bordas funcionam sobre grama, água e UI clara/escura?
- Todas as direções e estados exigidos têm entrega e metadados explícitos?

## Evidência local

- `reports/art-direction/asset-reference-board.png`: prancha de 20 referências, recortes e amostras de cor. Escalas da prancha variam para inspeção; não comparar tamanho físico entre células. Atlas reduzidos são visão de conjunto.
- `reports/art-direction/kingdom-palette.png`: prancha de cores por material e facção; `kingdom-palette.gpl` e `kingdom-palette.json`: seleção exportável com nomes e procedência. Não são uma paleta global obrigatória.
- `reports/art-direction/asset-measurements.json`: dimensões, bbox, hash, cores opacas e alfa parcial por referência. Paleta medida no primeiro quadro, ou no arquivo inteiro para imagens estáticas/atlas.
- `reports/art-direction/reference-profiles.json`: perfis calculados pela skill PixelAnalyser para seis sequências, incluindo todos os quadros e deltas geométricos. Deltas de centroide não são fluxo óptico nem prova de movimento anatômico.
- `reports/art-direction/inspect-assets.py`: reprodução das medições e prancha; depende de Pillow, NumPy, fontes locais e do script instalado da skill.

Exemplo da contagem: primeiro quadro do morador azul contém 9 cores RGB totalmente opacas e 394 pixels de alfa parcial; o castelo tem 17 cores opacas e 2.788 pixels de alfa parcial. Esses números não são limites de paleta para todo recurso, nem comprovam ausência de antialiasing RGB. O atlas de terreno amostrado tem 10 cores opacas e nenhum alfa parcial.
