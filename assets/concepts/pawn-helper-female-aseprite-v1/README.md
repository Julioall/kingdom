# Ajudante feminina — Aseprite e Pixel MCP

Este teste reúne a animação de repouso e a caminhada num documento Aseprite editável.

## Documento

- `pawn-helper-female.aseprite`: tela de 192×192, uma camada e 16 quadros.
- Tag `idle`: quadros 1–8, 200 ms por quadro.
- Tag `walk`: quadros 9–16, 100 ms por quadro.

Os quadros vieram dos conceitos já gerados em `pawn-helper-female-idle-v1` e `pawn-helper-female-walk-v1`; este documento não substitui esses arquivos.

## Exportações

- `plugin-export/walk-only.gif`: ciclo de caminhada, 8 quadros, 100 ms por quadro.
- `plugin-export/walk-only.png` e `.json`: spritesheet horizontal da caminhada, 1536×192.
- `plugin-export/all-forward.png`, `.gif` e `.json`: exportação dos 16 quadros pelo Pixel MCP, incluindo metadados das tags `idle` e `walk`.

## Como foi montado

O script [`scripts/import-helper-aseprite.lua`](../../../scripts/import-helper-aseprite.lua) importa os PNGs de quadro no documento. Depois, o Pixel MCP criou as duas tags, definiu os tempos e exportou a spritesheet e o GIF completo. A CLI do Aseprite filtrou a tag `walk` para exportar o ciclo isolado.

O ZIP do Pixel Plugin é empacotado para Claude Code. Para este teste, usei o executável MCP local diretamente, sem registrar ou instalar o plugin globalmente. No Windows, o cliente de teste envia JSON com separadores LF puros e passa caminhos com `/` ao exportador.

O executável de teste e as dependências de compilação ficam em `.local/asset-tools/`, fora dos recursos do jogo.
