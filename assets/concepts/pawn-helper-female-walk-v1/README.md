# Ajudante feminina — caminhada v1

Teste de caminhada no lugar, em três quartos para a direita. Oito quadros gerados juntos com imagegen; 100 ms por quadro (10 FPS), loop de 0,8 s. Prompt integral em `prompt.txt`.

## Arquivos

- `walk-preview.gif`: reprodução com fundo de inspeção.
- `walk-preview.webp`: versão animada com alfa.
- `pawn-helper-female-walk.png`: atlas RGBA horizontal de 1536 × 192; oito células de 192 × 192.
- `frames/`: quadros individuais, em ordem de geração.
- `index.html`: player com pausa, avanço manual, velocidade e comparação com o repouso anterior.
- `manifest.json`: configuração, hashes, recortes, escala compartilhada e âncora.
- `generated-sheet.png`: saída original 4 × 2, sem sobrescrever o conceito ou o idle.
- `reference-canvas.png`: canvas de referência preparado a partir do primeiro quadro do idle. A geração utilizou a imagem original da personagem como entrada visual.

## Processamento e limites

Extração row-major da grade 4 × 2. Normalização usa o script instalado de sprite-pipeline: escala única para toda a sequência, alinhamento inferior central e inserção em células de 192 × 192, com base convencional `(96,135)` incluindo sombra. A escala é calculada dos limites medidos, não de uma constante do teste anterior.

Quadros não foram reordenados, repetidos ou animados por deformação procedural. O GIF tem fundo de inspeção; PNG e WebP preservam o alfa dentro dos recortes. Não houve alteração no manifesto ativo ou nos NPCs da simulação.

Verificações automáticas: oito poses não vazias com hashes distintos, oito quadros no GIF, atlas 1536 × 192 e transparência em todas as células. Prancha inspecionada: roupa e direção consistentes, movimento visível nas pernas e braços; persistem variações de forma e contatos simplificados. Base da bbox termina em y=135, uma convenção de empacotamento que não comprova contato anatômico perfeito.

A caminhada é um protótipo visual. Contato dos pés, simetria das fases, transição último→primeiro e velocidade de deslocamento exigem refinamento e validação no jogo antes da adoção.
