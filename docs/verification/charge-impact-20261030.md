# Impacto das investidas — 30/10/2026

Investidas de escudo e lança arremessam cada personagem efetivamente atingido. Conforme a última correção do usuário, são golpes de empurrão: não retiram vida e não geram sangue. O escudo desloca até 3,2 tiles; a lança, 2,8. Uma defesa frontal reduz o deslocamento para 1,2 tile. Corpos se espalham para os dois lados do eixo da investida; o salto dura 600 ms, com altura máxima de 0,8 tile (0,35 se protegido). O sprite permanece vertical: nenhuma rotação lateral é aplicada.

O deslocamento autoritativo é calculado com amostragem a cada 0,12 tile, respeitando água, limites, desníveis e obstáculos sólidos. O personagem pode atravessar outros corpos durante o arremesso, mas a posição escolhida para pousar precisa estar livre. Se não houver espaço, o deslocamento é limitado pela última posição válida. O módulo visual interpola origem/destino e altura, sem usar teleporte visível como efeito.

Após a queda, o torpor dura três segundos de simulação. Parry aplica o mesmo bloqueio por três segundos após o contato, sem arremesso. O relógio compartilhado de simulação continua funcionando sem sacerdotes e congela na pausa. Os campos antigos por dia foram mantidos para compatibilidade de consumidores antigos; os caminhos de produção consultam o prazo em milissegundos. Encerrar o prazo limpa os campos e permite retomar ações.

Atordoamento bloqueia movimento manual, previsão do cliente, movimento autônomo, deslocamento de combate, ataques básicos/especiais, ações contra estruturas, defesa manual e conjuração. Filas de ataque, combos e rajada de estocadas são interrompidos. A apresentação ignora a investida/animação ofensiva antiga de um personagem já atordoado. Poeira marca o pouso e as estrelas existentes indicam o torpor.

Módulos: `simulation/kingdoms/combat-status.js` centraliza o bloqueio; `launchCombatPerson` reutiliza colisões e índice espacial existentes; `ui/knockback-presentation.js` calcula salto e deslocamento sem giro. Campos de estado são enviados nos deltas do Worker, inclusive na recuperação.

## Validação

- Suíte completa: 538/538 testes aprovados, em `browser-ui-evidence/impact/tests.txt`.
- Após o ajuste final das manchas no chão, 38 testes focados e TypeScript passaram. Cobrem três alvos por investida nas duas classes, ausência de dano no empurrão, ausência de giro, salto/pouso, colisões, bloqueio de todas as teclas de ataque, movimento manual/autônomo, recuperação sem sacerdotes e sangue apenas em dano confirmado.
- `npm run build` aprovado; log em `browser-ui-evidence/impact/build.txt`.
- `node scripts/verify-charge-browser.mjs`: Worker real com cenário de QA de um guerreiro e três alvos estacionários. Usa seleção, Espaço e tecla 3 na UI; confirma três arremessos, vida intacta e prazo de atordoamento, sem erros de página. Apenas os balões de pensamento foram ocultados na captura para permitir inspecionar os corpos. A IA dos alvos é desativada no fixture de QA para isolar impacto de esquivas; isso não modifica a produção.
- Capturas inspecionadas: `airborne.png` e `landing.png`. Posições e prazos: `browser-report.json` no mesmo diretório. A captura evidencia o arremesso e a manutenção da postura vertical; duração e bloqueios são verificados pelos testes de lógica.

O sistema mantém o alcance de início das habilidades existente. Não faz vítimas arremessadas causarem dano em cadeia e não remove colisões do cenário. O cenário de navegador valida o escudo; o caso equivalente de lança é coberto pelo teste de integração de múltiplos alvos.

## Sangue direcional e manchas temporárias

O arquivo fornecido `index-jsfiddle-Ca9Y7-9 (1).html` foi usado como referência de rajada, gravidade e tons de vermelho. A adaptação nativa em `ui/blood-presentation.js` não incorpora a página ou seus controles. Cada contato que realmente retire vida em espada, estocada ou flecha emite até 36 gotas determinísticas no sentido geral do ataque, com dispersão irregular. A última revisão reforçou a cor, o tamanho intermediário das gotas e a quantidade. Gotas rápidas deixam dois rastros curtos e afilados, amostrados da trajetória curva anterior, em vez de linhas retas de velocidade. Não altera o RNG da simulação. Erros, aparos, estruturas, bonecos e ambas as investidas de empurrão não geram sangue.

As gotas caem em aproximadamente 180–545 ms, com arrasto, pequenos atrasos, alturas e curvaturas variadas. O espalhamento ocupa uma área irregular, mantendo a direção média do golpe. A grade de desenho usa 32 amostras por unidade. Suas manchas ficam na camada de chão, sob os personagens, por aproximadamente dez segundos após o pouso e desaparecem gradualmente nos últimos 1,2 s. O efeito completo termina em 10,5 s e respeita o limite existente de eventos visuais; não grava manchas permanentes no terreno. Quatro testes focados de sangue verificam contato, exclusão de empurrões, direção, dispersão, rastros e duração; passaram com TypeScript.

`node scripts/verify-charge-browser.mjs --blood` confirmou dano de ataque básico sem arremesso e sem erros de página. As capturas `blood-hit.png`, `blood-stains.png` e `blood-cleared.png` foram inspecionadas; resultado em `blood-report.json`. Os testes verificam direção, tempo do contato, ausência de repetição, exclusão do empurrão e expiração das manchas. A suíte completa acima antecede apenas o último refinamento da camada/duração das manchas, coberto pela execução focada final.
