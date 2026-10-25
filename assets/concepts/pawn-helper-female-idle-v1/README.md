# Ajudante feminina — teste de idle v1

Animação experimental gerada com imagegen a partir do conceito feminino anterior. Oito quadros, 200 ms por quadro, loop de 1,6 s. Prompt completo em `prompt.txt`.

## Abrir

- `idle-preview.gif`: prévia animada com fundo de inspeção.
- `idle-preview.webp`: animação com alfa.
- `index.html`: player com reprodução, pausa, avanço manual e velocidade. Abrir localmente ou servir esta pasta por HTTP.
- `pawn-helper-female-idle.png`: spritesheet horizontal RGBA de 1536 × 192, oito células de 192 × 192.
- `frames/`: quadros individuais.
- `manifest.json`: origem, grade, âncora e normalização.

## Processamento

O gerador entregou uma grade 4 × 2 de 1536 × 1024. As linhas vieram com posições verticais diferentes. `package-animation.py` extrai a grade em ordem e aplica o normalizador da skill sprite-pipeline, com escala única e alinhamento inferior central. O conteúdo é acomodado em 72 × 72, dentro de células finais de 192 × 192; âncora convencional `(96,135)`, incluindo sombra. Não há redimensionamento individual para igualar alturas nem criação de poses por código. Os intermediários são preservados.

## Verificação

- Confirmados oito quadros não vazios, com conteúdo distinto e alfa preservado dentro dos recortes.
- GIF confirmado com oito quadros; atlas confirmado em 1536 × 192.
- Inspeção da prancha dos oito quadros: roupa, direção e identidade mantidas; há pequenas variações de forma/cabelo e amplitude entre poses.
- Player verificado no navegador: carregamento, reprodução automática, pausa, avanço do quadro 3 para 4 e retorno à reprodução.
- Conteúdo não toca borda da célula final. A base da bbox termina em y=135 em todos os quadros; isso não comprova estabilidade anatômica dos pés.
- Sem validação dentro da simulação ou aprovação como asset final. Manifestos ativos do jogo não foram alterados.

O teste comprova o fluxo de gerar, separar e reproduzir uma animação. Refinamento artístico e revisão em escala real no jogo permanecem necessários para adoção.
