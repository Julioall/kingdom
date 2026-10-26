Origem: arquivos de arte do AutoTile.zip fornecido para este projeto (TerraForge Studio).

O Kingdom usa estes cinco atlas, o fundo de água e a faixa Water Foam. O fundo de água é pixel a pixel idêntico ao arquivo que já existia em public/assets/tiny-swords/terrain/. A lógica reutilizada/adaptada está em src/simulation/world/island-terrain.js e src/ui/game.js; a interface do editor e o formato de mapa JSON não fazem parte do jogo.

O README do pacote de origem informa que direitos e créditos dos sprites originais devem ser verificados conforme a licença da arte antes de qualquer distribuição pública. Esta nota preserva essa ressalva; o ZIP não contém uma licença de redistribuição dos sprites.

Ativos de agricultura do Kingdom: `crop-field.png` é o atlas original 2×2 de solo lavrado em células de 64×64, sem plantas. O renderer atual usa `rice-field-ground.png` como camada do talhão e desenha os brotos separadamente conforme a biomassa cultivada. Vegetação natural, minérios, tocos, troncos soltos e estradas não aparecem dentro do talhão. `buildings/<facção>/farmhouse.png` é a construção estática de roça em canvas RGBA de 128×192 pixels, com telhado na paleta da facção.

`rice-field.png` é um segundo atlas 2×2 de 64×64 por célula, com lama, água rasa e mudas de arroz em fileiras. Ele está disponível como tile separado; a simulação atual ainda não identifica arroz como um tipo de cultivo, então a roça genérica recebe o estágio visual das plantas pela biomassa cultivada.

`rice-field-dry.png` e `rice-field-dry-plants.png` são a variação seca anterior, em atlas 2×2 de 64×64 sobre o solo lavrado.

`rice-field-ground.png` é um atlas 2×2 de quatro variações de canteiro em células de 48×48, inspirado no terreno `1_Terrains_48x48 (1).png` e retexturizado com a paleta do Kingdom. Cada canteiro é quase quadrado, com cantos suavemente arredondados, borda de terra elevada e irregular e uma sombra discreta à esquerda e embaixo. Os cantos transparentes deixam o terreno do mapa aparecer; o chão não tem sulcos arados.

`rice-growth-stages.png` contém os quatro desenhos de crescimento em células 64×64, empilhadas na ordem do estágio 1 ao 4. As mudas ficam centralizadas e contidas na área interna do canteiro; o renderer reduz cada quadro para o tile de terreno de 48×48. `rice-growth-wind.png` é o atlas animado de 1024×256: dezesseis fases suaves e quatro linhas, uma por estágio. As raízes ficam imóveis e o solo não se deforma. As fases avançam a cada 50 ms, mantendo o ciclo de 800 ms das árvores do Tiny Swords. O renderer escolhe o estágio pela biomassa cultivada (0,8–24; 24–50; 50–80; 80 ou mais) e sobrepõe o arroz ao terreno da roça; a simulação ainda não possui um tipo de cultivo exclusivo para arroz.
