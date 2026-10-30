# Magias táticas dos sacerdotes — 30/10/2026

Este relatório registra a entrega inicial. Para os tempos, perfis e comportamento visual posteriores solicitados durante o uso do jogo, consulte [o refinamento de VFX](priest-vfx-refinement-20261030.md).

Implementação na branch `codex/priest-tactical-magic`, derivada de `codex/test-game-ui-pixel-art-20261028` (`55b974c`). Rastreamento: [GitHub #53](https://github.com/Julioall/kingdom/issues/53), [Linear JUL-235](https://linear.app/julio-alves/issue/JUL-235/kingdom-magias-taticas-dos-sacerdotes-e-integracao-do-kit-vfx).

## Uso no jogo

Selecione um monge. No inspetor, escolha um papel ou configure até cinco magias, respeitando `availableMagicSpells` da unidade. Espaço assume/devolve o controle; WASD move, mouse aponta, teclas 1–5 conjuram as magias equipadas. E/1 mantém a cura primária quando a primeira magia é cura: a animação se repete até recuperar os feridos elegíveis, soltar a tecla ou faltar mana. As demais magias são conjurações individuais.

Mana e recarga são comprometidas no início. O efeito só ocorre ao terminar a conjuração. Morte, atordoamento, incapacidade, deslocamento superior a 0,75 tile ou perda da magia equipada cancelam a conjuração sem reembolso. Alvos, distância e elegibilidade são verificados novamente na conclusão.

## Parâmetros iniciais consolidados

Tempos em segundos, distâncias em tiles. Cura e veneno usam frações da vida máxima; dano efetivo é registrado em HP de combate. Alcance de conjuração: 6 tiles. Valores configuráveis em `src/simulation/magic/catalog.js`.

| Magia | Mana | Conjuração | Recarga | Efeito | Duração | Raio / máximo de alvos |
|---|---:|---:|---:|---|---:|---|
| Cura Simples | 12 | 0,35 | 0,9 | +7% vida | instantânea | individual |
| Cura em Área | 28 | 0,85 | 3,5 | +6% vida | instantânea | 2,8 / 8 |
| Grande Cura | 75 | 2,2 | 14 | +8%, depois +2%/s | 6 | 3,8 / 10 |
| Regeneração | 22 | 0,6 | 4 | +1,5% vida/s | 6 | individual |
| Fortitude | 26 | 0,65 | 5 | −20% custo de estamina | 12 | 2 / 5 |
| Velocidade | 24 | 0,65 | 5 | +15% deslocamento | 8 | 2 / 5 |
| Armas Abençoadas | 28 | 0,65 | 5 | +12% dano | 10 | 2 / 5 |
| Proteção Mágica | 26 | 0,65 | 5 | −15% dano recebido | 8 | 2 / 5 |
| Fraqueza | 26 | 0,65 | 5 | −15% dano causado | 10 | 2 / 5 |
| Lentidão | 24 | 0,65 | 5 | −20% deslocamento | 7 | 2 / 5 |
| Exaustão | 26 | 0,65 | 5 | +20% custo de estamina | 10 | 2 / 5 |
| Maldição | 30 | 0,65 | 5 | −40% cura recebida | 8 | 2 / 5 |
| Veneno | 26 | 0,65 | 5 | −0,8% vida/s | 6 | 1,8 / 4 |
| Purificação | 22 | 0,45 | 3,5 | remove debuffs mágicos elegíveis | instantânea | 2,5 / 6 |
| Dissipação | 26 | 0,7 | 4,5 | remove buffs mágicos elegíveis | instantânea | 2,5 / 6 |
| Santuário | 45 | 1,5 | 12 | −10% dano dentro da área | 8 | 3 / 100 |

Os soldados usados no cenário têm vida de combate máxima 360/300/220/240 para guerreiro/lanceiro/arqueiro/monge, estamina 400 e mana máxima 200. O sistema reaproveita essas capacidades existentes, sem novo aumento global. Por exemplo, Grande Cura restaura inicialmente 28,8 HP de um guerreiro; o máximo teórico com regeneração é 72 HP, se não houver maldição, interrupções posteriores da regeneração ou excesso de cura.

## Arquitetura e regras

- `simulation/magic/catalog.js`: catálogo, disponibilidade, papéis e prioridades táticas.
- `simulation/magic/effects.js`: efeitos independentes, classificação, acumulação e modificadores limitados. Atributos-base permanecem intactos.
- `simulation/magic/system.js`: conjuração, validação, IA, interrupções, cura/dano periódico, métricas e zonas.
- `ui/magic/particle-runtime.js`, `presets.json`, `presentation.js`: runtime nativo Canvas 2D, separado da lógica. `inspector.js`: configuração das unidades e prioridade dos generais.
- Reutilizados: ciclo de simulação, Worker/protocolo/sessão, elegibilidade de combate, dano/cura e morte, custos de recursos, movimento/navegação/colisões, animação de cura, mérito e comando dos generais.

Reaplicar um efeito renova a duração e mantém a maior intensidade, sem soma ilimitada e sem reiniciar a cadência periódica. Efeitos diferentes se combinam multiplicativamente. Limites finais: custo de estamina 0,25–2×, velocidade 0,35–1,5×, dano causado 0,4–1,6×, dano recebido 0,5–1,5×, cura 0,1–1,5×. Vida nunca supera o máximo. Purificação e Dissipação preservam atributos permanentes e condições não mágicas.

O Santuário usa a posição atual; entrar/sair altera imediatamente o modificador consultado pelo combate. Zonas sobrepostas não somam proteções territoriais. O relógio de magias é independente do dia: pulsos de aproximadamente 100 ms no navegador, suspensos na pausa, e avanço explícito no modo headless/manual. Integrações headless que controlam esse relógio devem usar apenas uma fonte de avanço.

Os deltas do Worker enviam apenas os campos de magia/vida/animação dos personagens alterados; não reenviam cérebros e históricos de navegação. Eventos só são reenviados quando sua sequência muda. Reiniciar o mundo limpa os emissores e protege contra callbacks do mundo anterior.

## IA e combinações

A IA pontua ferimentos, quantidade de alvos, estamina, ameaças, efeitos existentes e custo. Não usa uma rotação fixa. Curandeiro, protetor e enfraquecedor são conjuntos editáveis, não árvores de talentos. Generais recebem informação sobre apoio mágico e podem priorizar recuperação, proteção, ofensiva, enfraquecimento ou poupar magias, sem substituir sua ordem de avanço/retirada/formação.

Combinações verificadas pelo cálculo central e pelos testes de integração:

- Fortitude + Proteção: 0,8× custo e 0,85× dano recebido.
- Fortitude + Armas: economia física e 1,12× dano confirmado.
- Velocidade + Armas: 1,15× movimento e 1,12× dano; colisões continuam no caminho original.
- Cura + Regeneração: recuperação inicial e periódica, limitada pela vida máxima.
- Exaustão contra Fortitude: 0,8 × 1,2 = 0,96× custo, sem anulação por sobrescrita.
- Maldição contra Grande Cura: cura inicial e periódica multiplicadas por 0,6.
- Purificação remove veneno/lentidão/maldição/exaustão elegíveis; Dissipação remove proteções e bônus mágicos.
- Santuário protege o ponto ocupado; perseguir um inimigo para fora abandona essa proteção.

## Kit visual e desempenho

Fonte: kit fornecido pelo usuário em `Downloads/Kingdom_Kit_Magias_Sacerdotes_para_Codex`, incluindo `integracao/kingdom-debuff-vfx.js`, presets, HTMLs de laboratório/runtime e ZIP v2. O JS original declara `Copyright (c) 2026. MIT.`; o aviso foi preservado no runtime adaptado. Os HTMLs são referências funcionais; não são iframes nem dependências de produção. O arquivo C# não é usado neste projeto web.

O runtime foi convertido para ESM e adaptado para culling, posições mutáveis, cache limitado de cores e menos alocações. Círculos são desenhados antes dos atores, auras depois. Círculos e partículas usam os pés interpolados dos sprites e acompanham a câmera. Indicadores de seleção/alvo usam o mesmo desenho isométrico. Sem glow em produção.

Limites: 360 instâncias visuais, 800 partículas simultâneas, até três camadas persistentes por personagem, orçamento dividido entre efeitos visíveis. Todos os efeitos lógicos continuam ativos. Desaparecimento visual de 240 ms. Estilo configurável por `setSpellStyle`: cor, rotação, velocidade/quantidade/opacidade das partículas e opacidade do círculo.

## Evidências reproduzíveis

- `npm test`: 519/519 passaram na execução final; `focused-tests.txt`: 49/49, incluindo o teste adicional de civis e cancelamento por troca de equipamento.
- `npm run build`: TypeScript + Vite passaram; 514 PNGs convertidos para WebP, 9,11 → 6,10 MiB.
- `node scripts/verify-magic-browser.mjs`: Chrome/Playwright, 100 soldados, Worker real com fixture de QA, seleção, cinco slots, controle manual, Grande Cura, limpeza/caps e erros de página.
- Último navegador: 34 conjurações, 1 cancelamento, 971 mana, 1240,8 HP curados, 101,744 HP de veneno, 54 aplicações, 16 purificações, 3 dissipações; duas zonas, 50 afetados. Maior delta de magia observado: 23.370 bytes; erros de página: nenhum. Taxa reportada pelo profiler: 86,8 renderizações/s, p95 do mapa 18,8 ms. É uma medição local, não garantia de FPS em outros dispositivos.
- Capturas em `browser-ui-evidence/magic`: `casting-100-soldiers.png`, `active-battle.png`, `priest-loadout.png`, `manual-greater-heal.png`; dados em `browser-report.json`.
- `node scripts/benchmark-magic.mjs --seconds=60 --output=browser-ui-evidence/magic/balance-final.json`: nove cenários, seeds 42/7/99, formações espelhadas, 50 por lado, iniciativa alternada, relógio mágico 100 ms e rodadas físicas de 1 s. Começam com 70% da vida para observar cura efetiva. Sem sacerdotes: 50 físicos/lado; com sacerdotes: 46 físicos + quatro sacerdotes/lado. Mistos: dois curandeiros, um protetor, um enfraquecedor. Não é um teste de equivalência absoluta entre composições.

| Seed | Sem sacerdotes: sobreviventes V/C | Curandeiros V/C | Mistos V/C |
|---|---|---|---|
| 42 | 34/16 | 35/24 | 28/23 |
| 7 | 12/33 | 42/24 | 40/14 |
| 99 | 41/1 | 44/0 (fim em 46 s) | 25/35 |

Os sacerdotes mudam sobrevivência, dano e duração; não garantem vitória. O cenário misto também inverte resultados dependendo da semente. A cura efetiva dos curandeiros chegou a 16.972,8 HP (seed 7); os mistos curaram aproximadamente 9.566–9.689 HP nos três cenários e executaram contramagias. O JSON contém custo, estamina gasta, vida restante, dano e duração por lado.

O p95 da lógica mágica com sacerdotes ficou entre 0,047 e 0,0972 ms por pulso, com até 82 efeitos lógicos simultâneos. O p95 do pulso completo ficou aproximadamente entre 20,8 e 56,2 ms no conjunto; há picos de combate/navegação acima disso. Esses resultados não atribuem todos os travamentos anteriores à LLM ou ao renderizador e não representam correção geral de performance.

## Limitações e revisão humana

Foi reproduzido congestionamento inicial do arqueiro 145 atrás do NPC 151 na seed 42, também com magias desativadas. O rastreamento mostrou posição inalterada até o dia 41, mas deslocamento nos dias 51 e 61: demora prolongada, não bloqueio permanente. Está separado em [#54](https://github.com/Julioall/kingdom/issues/54). O teste de torre agora declara explicitamente seu escopo sem multidão: navegação, entrada e ocupação. Passar esse teste não resolve nem oculta o cenário completo congestionado.

O cenário usa três sementes e uma arena limpa; não cobre todas as formações, mapas e equipamentos. Revisão humana pendente: legibilidade em zoom baixo, preferência das cores, sensação dos tempos/custos e balanceamento em campanhas longas. Não foi refeita a navegação nem o combate inteiro. O endpoint Linear `get_agent_context` foi tentado e retornou indisponível; issues e branch foram consultadas por ferramentas disponíveis.

A árvore já continha alterações não commitadas de controles, ataques, terreno, UI e assets de solicitações anteriores. A consolidação inclui as dependências de gameplay para manter a branch executável; as exclusões preexistentes de assets não fazem parte desta entrega e ficam preservadas fora do commit. A base do PR é a branch de trabalho original, evitando incluir os 281 commits anteriores como novidade contra main.

## Auditoria de aceite

| Critério | Evidência |
|---|---|
| 16 magias reais, custo, tempo e alcance | catálogo e teste parametrizado de cada magia em `magic-system.test.mjs` |
| Conjuração interrompível sem efeito antecipado | testes de morte, atordoamento, deslocamento e troca de loadout |
| Modificadores reais preservando bases | testes centrais e dano confirmado de espada, lança e flecha em `magic-combat-integration.test.mjs` |
| Remoção, periodicidade e limites | testes de expiração, refresh, veneno, cura máxima e contramagias |
| Áreas dependentes de posição | teste de entrada/saída/expiração do Santuário |
| IA contextual e autonomia dos generais | testes de prioridade por ferimentos/buffs e ordem mágica preservando a manobra |
| Círculos, animação e partículas seguindo unidades | testes de apresentação mais capturas da batalha e conjuração manual |
| Compatibilidade e regressões | suíte completa, TypeScript, build e navegador sem erros; congestionamento preexistente separado em #54 |
| Batalha com aproximadamente 100 soldados | fixture compartilhada, nove benchmarks e QA no navegador com 100 atores |
| Balanceamento inicial avaliável | parâmetros, sobrevivência, custo, dano, cura e estamina no JSON e neste relatório |

A validação humana de aparência e balanceamento permanece aberta. O congestionamento #54 também permanece aberto e não é declarado resolvido por esta entrega de magias.
