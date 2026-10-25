# Forja UI + HUD — edição de produção

Kit sem framework para interfaces de jogos no navegador. Inclui o editor de **cards, banners e inventário**, fitas em 3-slice, molduras/botões em 9-slice com repetição e HUD de barras nos tamanhos grande/compacto com seis cores.

## Estrutura

```text
Forja-UI-HUD-Producao/
├── src/
│   ├── index.html         # Editor visual
│   ├── styles.css         # Estilos do editor e autotile
│   ├── app.js             # Estado/controles/editor
│   ├── engine.js          # Componentes cards/banners/inventário
│   ├── hud.js             # Componente reutilizável: ForjaHUD
│   └── hud.css            # Estilos do HUD 3-slice
├── assets/sprites/       # Sprites de execução (PNG, sem atlas redundantes)
├── demo/
│   ├── index.html         # Entrada para as duas demos
│   ├── hud.html           # Demonstração de vida/mana/energia
│   ├── hud.css
│   └── hud-demo.js
└── README.md
```

## Como executar

1. Descompacte o ZIP sem mudar as pastas de lugar.
2. Abra `demo/index.html` para escolher entre editor e HUD. Os caminhos também são relativos para abertura local via `file://`, mas para testes consistentes prefira o servidor indicado abaixo.
3. Para testar via servidor local, na pasta raiz execute `python -m http.server 8000` e abra `http://localhost:8000/demo/`.

As fontes MedievalSharp e Patrick Hand carregam via Google Fonts quando há internet; existem fallbacks locais. As imagens e o JavaScript não dependem de internet.

## HUD reutilizável

```html
<link rel="stylesheet" href="src/hud.css">
<script>window.FORJA_ASSET_BASE = 'assets/sprites/';</script>
<script src="src/hud.js"></script>
<div id="life"></div>
<script>
  const life = ForjaHUD.create({size:'big', color:'red', value:80, max:100, label:'Vida'});
  document.getElementById('life').append(life);
  ForjaHUD.setValue(life,55);
  ForjaHUD.setColor(life,'blue');
</script>
```

Opções: `size` = `big` ou `small`; `color` = `red`, `blue`, `green`, `yellow`, `purple` ou `gray`; `value`, `max`, `label`, `width` em px. A cor é um PNG recolorido do **preenchimento original**, preservando contornos e iluminação pixelados. As bases são feitas com as peças originais e somente o centro repete horizontalmente.

**Caminhos:** por padrão o componente presume `../assets/sprites/` relativo ao documento `src/index.html` ou `demo/hud.html`. Ao incorporar no seu jogo, defina `window.FORJA_ASSET_BASE` antes de `hud.js`, como no exemplo.

## Editor

Abra `src/index.html`. Configure itens, escolha entre 16 brasões, troque fitas, molduras e dimensões, escolha barra e cor, importe/ exporte JSON. `FantasyUI` fica disponível em `window.FantasyUI` para usar em outros scripts (renderização DOM).

### Autotile
- As **faixas** usam 3-slice (pontas íntegras e centro repetido).
- **Painéis/botões** usam 9-slice (cantos fixos e centro/bordas repetidos).
- As **barras** repetem a parte central da moldura e do preenchimento. Pontas não são repetidas.

### O que foi removido
- HTMLs de versões anteriores, screenshots, arquivos de construção/testes, atlas duplicados e os grandes dados base64 embutidos nas demos.
- Os sprites continuam individualizados, em PNG, para facilitar a integração.

## Licença
Este pacote agrupa sprites fornecidos pelo usuário e imagens de brasões criadas nesta conversa. Confirme a licença dos sprites originais antes de distribuição comercial; a inclusão no ZIP não transfere direitos sobre eles. Fontes de terceiros são carregadas via Google Fonts; respeite as respectivas licenças.
