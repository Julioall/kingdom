# Desbloqueio de habilidades por treino e combate — 30/10/2026

Referência: [JUL-193 — XP por habilidade, níveis, especializações e generais](https://linear.app/julio-alves/issue/JUL-193/m614-xp-por-habilidade-niveis-especializacoes-e-generais).

## Comportamento

O domínio usa o maior valor entre `militaryLevel` (promoções existentes, limitado a 1–7) e `1 + floor(militaryTraining * 4)` (preparo normalizado entre 0 e 1). O treino operacional pode levar até o nível 5; os níveis 6–7 exigem promoções. Patente de comando não concede habilidades. Mérito bruto não é convertido diretamente em nível, preservando a pausa de progressão por falta de edifícios da classe e a exclusão de mérito acumulado durante essa pausa.

| Nível | Habilidades novas |
| --- | --- |
| 1 | Ataques básicos, defesa, Cura Simples |
| 2 | Combo; Regeneração, Fortitude, Lentidão |
| 3 | Rajada de estocadas, tiro triplo; Cura em Área, Velocidade, Fraqueza, Proteção, Purificação |
| 4 | Investida de escudo/lança, tiro concentrado; Armas Abençoadas, Exaustão, Veneno mágico, Dissipação |
| 5 | Chuva de flechas, Maldição |
| 6 | Grande Cura, Santuário |
| 7 | Domínio máximo, mantendo os tetos de alvos e dano |

Áreas e contatos múltiplos atingem até `min(7, nível + 1, teto da habilidade)` unidades distintas. Uma investida de nível 4 pode empurrar 5 inimigos; no nível 7, até 7. Chuva de flechas usa o mesmo limite total por ataque. Tiro triplo continua com três flechas; buffs/debuffs mantêm seus tetos individuais menores. A quantidade de flechas visuais da chuva não representa dano em um número ilimitado de pessoas.

O Santuário possui vagas, em vez de proteção ilimitada para até 100 pessoas. Aliados vivos fora de repouso que estejam mais próximos do centro ocupam as vagas; empates usam ID. Vagas são realocadas ao sair/entrar na área. A proteção real e as auras usam a mesma seleção. A área continua fixa no chão.

IA e controle manual consultam a mesma política. O Worker rejeita especiais bloqueados antes de enfileirar comandos, gastar estamina ou travar movimento. Magias ainda bloqueadas permanecem nos loadouts planejados, mas não entram no repertório executável. O inspetor mostra domínio, limites e requisitos. Os campos persistidos existentes são usados sem regravar saves ou elevar automaticamente os NPCs; fixtures de testes avançados agora declaram veteranos explicitamente.

## Validação

- `npm test`: 550 testes aprovados; execução em `browser-ui-evidence/progression-full-tests.txt`.
- Teste adicional de formação densa: 6 testes de impacto aprovados em `browser-ui-evidence/progression-charge-tests.txt`. Confirma exatamente 5/7 arremessos nos níveis 4/7. Foi executado após o início da suíte completa.
- Oito testes de progressão cobrem desbloqueios exatos, treino operacional, pausas de promoção, rejeição sem gasto, loadouts persistidos, limites de cura e ocupação do Santuário.
- `npm run build`: TypeScript, Vite e otimização de 514 PNGs aprovados; log em `browser-ui-evidence/progression-build.txt`.
- `node scripts/verify-magic-browser.mjs --visual-only --output=browser-ui-evidence/progression`: batalha com 100 veteranos, sem erros de página; captura inspecionada em `vfx-detail.png` e métricas em `visual-report.json`.
- A amostra de navegador foi coletada em paralelo com build/testes; seus FPS não sustentam uma conclusão sobre melhora de desempenho.

## Limites desta etapa

Este é o desbloqueio sobre a progressão existente. XP individual por habilidade, diminuição de recompensa contra bonecos, especializações por classe/arma e uma política neural treinável para cada especial continuam no escopo aberto da JUL-193. A pontuação legada de mérito não equivale ao sistema completo de XP por uso eficaz. Flecha envenenada com consumível também permanece pendente na JUL-186; Veneno mágico é outra habilidade.

A JUL-193 foi atualizada no Linear preservando os requisitos ainda pendentes e seu estado Todo/arquivada. Esta entrega não declara a tarefa inteira concluída.
