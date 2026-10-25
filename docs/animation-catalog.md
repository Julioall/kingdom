# Catálogo de animações Tiny Swords

O catálogo cobre todas as animações PNG do pacote local: **252 folhas animadas**, mais **5 flechas** estáticas prontas para projéteis. As variantes de unidades contemplam blue, red, purple, yellow e black. Outros 153 PNGs são classificados como imagens estáticas (construções, UI, nuvens, tilesets e objetos), sem tratar um atlas como uma sequência de animação.

`src/ui/animation-manifest.js` registra ID, categoria, classe, cor, ação, arquivo de origem, URL publicada, tamanho da imagem, tamanho e número dos quadros, FPS, repetição e âncora em pixels. Os arquivos publicados permitem usar o catálogo sem instalar o pacote de arte original.

| Grupo | Ações e variantes | Entradas |
| --- | --- | ---: |
| Aldeão (`pawn`) | idle/run simples e com axe, gold, hammer, knife, meat, pickaxe e wood; interact com axe, hammer, knife e pickaxe | 100 |
| Lanceiro (`lancer`) | idle, run, attack e defend nas direções up, up-right, right, down-right e down | 60 |
| Guerreiro (`warrior`) | idle, run, attack, attack-2, defend | 25 |
| Arqueiro (`archer`) | idle, run, attack (tiro), arrow (projétil) | 20 |
| Monge (`monk`) | idle, run, heal, heal-effect | 20 |
| Ovelha | idle, move, grass | 3 |
| Efeitos | dust-01/02, explosion-01/02, fire-01/02/03, water-splash | 8 |
| Cenário | quatro árvores, quatro arbustos, quatro pedras na água, espuma e pato | 14 |
| Recursos | destaque do recurso de ouro e das seis pedras de ouro | 7 |

## Usar no código

```js
import { getAnimation, getUnitAnimation, listAnimations,
  getAnimationFrame, createAnimationRenderer } from './animations.js';

const renderer = createAnimationRenderer({ onReady: () => requestRender() });
const animation = getUnitAnimation('aldeao', 'run-wood', 'red');
// Também aceita lanceiro, guerreiro, arqueiro e monge.
const secondAttack = getUnitAnimation('guerreiro', 'attack-2', 'blue');
const healing = getUnitAnimation('monge', 'heal-effect', 'purple');
const arrow = getUnitAnimation('arqueiro', 'arrow', 'yellow');
const splash = getAnimation('effect.water-splash');
const available = listAnimations({ category: 'unit', palette: 'red', unit: 'pawn' });

// Opcional: pré-carregar uma animação antes de usá-la.
await renderer.load(animation);

// x/y representam a âncora: pés das unidades, centro dos efeitos.
// Em ações pontuais, o relógio começa no instante do evento.
renderer.draw(ctx, splash, x, y, {
  elapsedMs: now - eventStartedAt,
  scale: 1,
  flipX: false,
  rotation: 0, // radianos; útil para a flecha
});
if (getAnimationFrame(splash, now - eventStartedAt).done) removeEffect();
```

Cada renderer carrega somente as folhas solicitadas e mantém um cache. `draw` retorna `false` durante o carregamento; `onReady` permite redesenhar quando a imagem chega. `load` retorna uma Promise e rejeita se houver falha. `onError` recebe falhas causadas por carregamentos iniciados automaticamente em `draw`.

Movimento, espera, defesa, fogo e cenário se repetem. Ataques, interações, cura, explosões, poeira e respingos terminam no último quadro, sinalizado por `done`. Para reproduzir uma ação continuamente, passe `loop: true`; para variar a fase das sequências, use `phase` em quadros. Uma flecha contém apenas um quadro e é posicionada/rotacionada pelo chamador.

O jogo desenha aldeões e militares pelo renderer compartilhado. Transporte e espera usam sprites de madeira, ouro e carne; trabalho usa picareta, machado, martelo ou faca conforme a ação realizada. Ao se aproximar de um trabalho, o aldeão corre ou espera com a ferramenta em mãos. As cargas já presentes na sprite não recebem um segundo desenho sobreposto.

Extração, corte e construção geram poeira no ponto real do trabalho; passos em terra geram poeira leve. Beber e pescar geram respingos no ponto da água. Esses efeitos nascem uma única vez por ação observada e expiram com a sequência; reiniciar o mundo limpa os efeitos anteriores. Jazidas de ouro selecionadas ou em extração usam o destaque animado. O campo `visualActivity` transmitido pela simulação identifica tipo, alvo e dia da atividade sem modificar seus custos ou resultados.

Ataques de batalha reiniciam a sequência no primeiro quadro, têm prioridade durante a interpolação do movimento e terminam sem repetição. Guerreiros alternam as duas variantes de ataque. O mapeamento das direções militares continua em `military-sprites.js`. Cura mágica, fogo, explosões, projéteis e os demais objetos decorativos aguardam mecânicas correspondentes.

Com o servidor de desenvolvimento ativo, `reports/active-animations.html` exibe uma prévia das poses e efeitos aplicados, usando os mesmos módulos do jogo.

## Proporção e qualidade original

Pessoas, militares, ovelhas, arbustos, árvores, recursos e construções compartilham a grade nativa de 64 pixels por célula, por meio de `spriteScale` em `src/ui/map-camera.js`. O fator de crescimento de plantas e a redução das crianças são uniformes nos dois eixos. Os pés das construções respeitam as margens transparentes de cada arquivo.

Os PNGs integrados foram restaurados a partir do pacote original, preservando cores e transparência. Troncos usam o recurso de madeira original; sombras duplicadas e adereços artificiais sobre as sprites foram removidos. A validação do catálogo compara os arquivos publicados com os originais quando a pasta local está disponível.

A câmera desenha diretamente na resolução física da área visível, respeitando `devicePixelRatio`, com suavização desativada. Zoom e arraste alteram a câmera e redesenham os originais, sem ampliar um bitmap previamente reduzido. O cache do terreno tem o tamanho da tela e é invalidado ao mudar a câmera. Os limites dos tiles são alinhados aos pixels físicos para eliminar frestas. O zoom permite inspeção até 1600%; o inverso da transformação da câmera mantém a seleção no lugar correto.

## Atualizar ou verificar o catálogo

Com a pasta local `Tiny Swords/` presente:

```sh
npm run assets:map
npm run assets:check
```

O gerador publica as folhas ausentes e preserva as imagens já integradas ao jogo. A verificação confere as dimensões publicadas e se o manifesto corresponde ao pacote local. Os testes do catálogo verificam os PNGs publicados, as variantes, os recortes, a reprodução e o carregamento; não dependem da pasta original para rodar em um checkout novo.
