# JUL-293 — Guard de recálculos territoriais: perfil, causalidade e decisão

**Data:** 10/11/2026  
**Implementação:** [PR #105](https://github.com/Julioall/kingdom/pull/105)  
**Benchmark completo:** [GitHub Actions #42753716627](https://github.com/Julioall/kingdom/actions/runs/42753716627), artefato `jul293-territory-cache`.

## Por que o recálculo completo era redundante?

`recomputeKingdomTerritories` era chamado antes e depois das ações dos NPCs, todos os dias, verificando cada tile e distâncias para castelos, torres e reivindicações.

Os dois recálculos são semanticamente necessários **quando as influências mudam** — obra concluída, torre destruída, raio/integridade alterados, mudança de reino, reivindicação anexada/expirada. Em dias sem essas mudanças, projetam novamente as mesmas posses e contam os mesmos tiles sem benefício.

## Otimização

`src/simulation/kingdoms/territory-cache.js` mantém `WeakMap` privado ao mundo.

O guard compara, em ordem:
1. Reinos relevantes e fontes ativas: castelos/torres concluídos, posição, dono, integridade/raio efetivo e ordem que resolve empates.
2. Reivindicações `annexed` efetivas; expiração reavaliada com o dia **antes e depois** da virada do calendário.
3. Grade atual de tiles: referência da grade e de cada célula, posição, tipo de terreno e dono.
4. Contagens territoriais dos reinos, seed, epoch e retrocesso do relógio.
5. Chamadas com contexto de cerco e relatório de perda **sempre recalculam**.

Se tudo coincidir com a última projeção, o mapa, os totais e a revisão da navegação ficam intactos. Se qualquer condição falhar, o algoritmo original executa integralmente, incluindo `reportTerritoryLoss`/prestígio, avisos de fronteira e invalidação de rotas quando a posse muda.

O modo `setTerritoryRecomputeMode(world, 'always'|'cached')` existe somente para testes/A/B. O cache não é serializado, não altera o protocolo Worker, não toca no RNG e não posterga construções, anexações ou batalhas.

## Resultados do primeiro A/B no Linux / Node 24

Três mundos reais (seeds **1, 42 e 2026**), **35 dias** por mundo, versão `cached` versus `always`, alternando ordem de execução a cada dia. **SHA-256 do snapshot autoritativo completo e RNG iguais em cada um dos 105 dias**, sem qualquer divergência.

| Etapa | Recalcular sempre, média | Guardado, média | Diferença |
|---|---:|---:|---:|
| Territórios antes dos NPCs | 4,84 ms/dia | 0,64 ms/dia | −86,74% |
| Territórios após os NPCs | 4,63 ms/dia | 0,65 ms/dia | −85,95% |
| **Territórios juntos** | **9,47 ms/dia** | **1,29 ms/dia** | **−86,35%** |
| **Passo completo** | **260,41 ms/dia** | **251,37 ms/dia** | **−3,47%** |

Na primeira amostra, cada mundo teve **70 chamadas territoriais reaproveitadas** após uma projeção inicial. Trata-se de um cenário estável; **não** extrapolar a mesma taxa para guerras com construções e destruições frequentes.

### Testes dirigidos de situações dinâmicas

`tests/territory-recompute-cache.test.mjs` compara o guard com recálculo completo nas seguintes condições:
- castelo/torre: raio, integridade, destruição/recuperação e inversão da ordem de prioridade;
- reivindicação anexada e expiração na virada do calendário;
- alteração externa de contagem, dono e terreno da célula;
- contexto de perdas territoriais em cerco (duas chamadas contextuais sempre processadas);
- passos completos com RNG e `WorldSnapshot` rigorosamente idênticos.

## Limites e decisões

- Esta é uma medida de **tempo de parede em Node/Linux**, proxy de CPU, não FPS real de Chrome/RTX.
- O cache inspeciona 12.544 tiles por chamada; se a proporção de mudanças for muito alta ou o mapa muito pequeno, o custo relativo será diferente. Repetir A/B com guerras e obras ativas e medir o uso de heap.
- O ganho de **−3,47% no passo completo** é uma única execução sujeita a diferenças de JIT/GC/runner. Não atribuir ganho garantido no FPS sem QA com GPU real.
- A investigação futura de máquina de estados e inferência neural foi **adiada a pedido do usuário**, registrada em [JUL-292](https://linear.app/julio-alves/issue/JUL-292), sem alteração de código nesta PR.
- `main` permanece protegida até homologação integral; apenas `dev` é elegível depois de CI completo.

**Próximo gate:** repetir benchmark e smoke Chromium no HEAD final da PR; depois testar uma guerra com perda de torre e a conclusão/expiração de anexações no navegador real.
