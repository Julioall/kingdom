# Kingdom — revisão UI/HUD com game-ui-frontend

Data: 2026-10-28  
Base: `dev` (commit inicial da revisão: `615e7bbdc0a17d8a8214ad0359af11d53e86c32b`)  
Skill oficial: https://github.com/openai/plugins/tree/main/plugins/game-studio/skills/game-ui-frontend  
Origem conferida: `SKILL.md` blob `f2681fb955143f96cb04bfa4f1cb09d6839b162a`.

## Integração da skill

- A pasta `.agents/skills/game-ui-frontend/` incorpora o `SKILL.md` e o manifesto `agents/openai.yaml` da fonte oficial, em escopo de projeto.
- Como este trabalho ocorreu pela integração GitHub e não num checkout local com npm, **o comando `npx` não foi executado**. Os arquivos equivalentes foram inseridos no branch pelo GitHub.
- Em um checkout local, para atualizar/reinstalar pelo CLI: `npx skills add https://github.com/openai/plugins --skill game-ui-frontend`. Escolher escopo de projeto e agente correspondente.
- Os links `../web-game-foundations` e `../../references` citados pela skill apontam para material compartilhado do repositório de origem; são referências externas, não dependências do jogo nem arquivos JS a carregar em produção.
- A skill não adiciona dependências ao `package.json` nem interfere com a migração futura para PixiJS.

## Direção visual adotada

**Fantasia:** observação estratégica de dois reinos autônomos em um mundo vivo, com economia e riscos de sobrevivência.  
**Câmera:** mapa 2D top-down com zoom/pan (possível 2.5D futuro).  
**Verbos:** acompanhar habitantes, inspecionar reinos e estruturas, ler crônicas, pausar/acelerar e ajustar o mundo.  
**Materiais:** pergaminho, madeira e heráldica Tiny Swords já existentes — sem aparência de painel administrativo.  
**Tipografia:** MedievalSharp para títulos e Patrick Hand para textos, com números alinhados e contraste adequado.  
**Motion:** transições discretas de painéis; respeito ao `prefers-reduced-motion`.  
**Proteção de mapa:** pequenos controles e estado básico visíveis; textos longos em painéis fechados por padrão; alertas apenas em condições críticas.

## O que foi verificado no código

| Área | Evidência atual | Avaliação |
| --- | --- | --- |
| Mundo e HUD | `index.html`, `src/ui/game.js`, `src/ui/styles/main.css` | Mundo em canvas e interfaces textuais em DOM: alinhado à skill |
| Abertura da partida | Painéis de reinos, inspetor e ajustes começam visualmente recolhidos | Bom uso de disclosure progressivo |
| Tema | Assets pergaminho, botões e brasões `public/assets/kingdom-ui` | Preservar, não substituir por componentes genéricos |
| Alerta alimentar | `.map-tags` oculto por padrão e `environmentToggle` oculto; risco podia ficar invisível | Corrigido: a faixa de risco surge quando há pessoas com reservas baixas |
| Acessibilidade | Painéis recolhidos por transform/opacity permaneciam focáveis | Corrigido: `inert` e `aria-hidden` sincronizados com estado |
| Mobile | Barra de 5 métricas + data ocupava várias linhas antes do mapa | Mitigado: uma faixa horizontal rolável para métricas |
| Código da interface | `game.js` ~215 KB, CSS com camadas de sobrescritas | Refatoração recomendada em PR próprio |

## Alterações desta PR

1. Instalação do conteúdo oficial da skill no projeto, sem dependência de runtime.
2. `syncHudPanelAccess` mantém painéis fechados fora da ordem de foco e da árvore assistiva.
3. `syncFoodPressureAlert` expõe o alerta crítico de alimentação sem abrir o painel ambiental completo.
4. Ajuste responsivo no HUD mobile preserva controles principais e libera altura do mapa.
5. Testes unitários para a sincronização de visibilidade assistiva e para a presença/ausência do alerta.

## Adaptação pixel art após revisão dos assets disponíveis

A primeira rodada preservava a identidade visual, mas não reaproveitava molduras do kit em novas superfícies. Esta revisão introduz `src/ui/styles/pixel-hud.css`, carregado após `main.css`, para aplicar uma estética pixel art concreta **sem alterar o canvas**.

- **Slot de madeira** (`wood-slot.png`, componente 9-slice): contadores de comida, riqueza, pessoas e estatísticas da barra superior.
- **Papel** (`paper.png`, componente 9-slice): calendário, seletores de reinos e cartões de dados do inspetor.
- **Slot escuro** (`slot.png`, componente 9-slice): aviso de risco alimentar com marca vermelha e mensagem legível.
- **Controles, pergaminhos e ícones**: preservados os botões pressionados/regulares, fitas, scrolls, imagens e cursores existentes. Texturas exibidas com `image-rendering:pixelated`.
- **Responsividade e legibilidade**: espessuras da moldura e tipografia adaptadas ao HUD horizontal móvel; painéis e centro do mapa continuam sob demanda.

Não foram adicionados kits de terceiros nem fontes pixeladas que prejudiquem a leitura. A tipografia medieval continua intencional. Testes estáticos em `tests/pixel-hud-assets.test.mjs` verificam que as referências aos sprites existem e que a camada de estilo é importada. **O visual ainda precisa ser comparado no navegador em tamanhos desktop/mobile antes do merge.**

## Próximas melhorias sugeridas, fora do escopo desta PR

- **P1 — auditoria visual real:** validar em desktop 1440×900 e 1024×768, mobile 390×844 e 320×640, com foco, touch, zoom/pan, seleção, crônicas, ajustes e sobreposição de alertas; capturar screenshots.
- **P1 — feedback contextual:** fornecer feedback curto para comandos de construção, economia, ordens militares e trocas de moeda, próximo da ação, sem criar mais painéis permanentes.
- **P1 — economia legível:** diferenciar ouro, prata e cobre na interface do tesouro/mercado quando os snapshots de simulação fornecerem os três saldos; evitar rótulo de riqueza que pareça equivaler somente a ouro.
- **P2 — extrair componentes DOM:** separar inspetor, comandos, crônicas e barra de indicadores de `src/ui/game.js`, com pequenas funções puras e testes, mantendo o canvas isolado.
- **P2 — consolidar CSS:** remover overrides obsoletos por fases, criar tokens de espaçamento/dimensões/cores, e padronizar estados `hover`, `focus-visible`, `disabled`, `selected`.
- **P2 — playtest de performance:** medir FPS, custo de repaint/layout e uso de memória com painéis abertos/fechados antes/depois da adoção de PixiJS. Renderização de textos e controles permanece no DOM; mundo continua na camada renderizável.

## Verificação

- Testes automatizados previstos: `node --test tests/hud-panel-access.test.mjs`; suite completa: `npm test`; compilação: `npm run build`.
- **Limite de validação:** a sessão de edição não dispõe de checkout executável do repositório nem navegador de teste. O resultado foi revisado estaticamente; screenshots, avaliação visual responsiva, suíte completa e build dependem de CI ou execução em checkout local. Não considerar a PR pronta para merge sem esses gates.
- Não alterar `main` diretamente; abrir PR para `dev` e manter em revisão até a validação.
