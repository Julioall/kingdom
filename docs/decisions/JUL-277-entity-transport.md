# JUL-277 — Diagnóstico dos deltas de entidades e contrato do Worker

**Data:** 10/11/2026. **Decisão:** **não ativar deltas de entidades no Worker** até separar o estado de renderização dos detalhes cognitivos e comprovar economia de CPU e transferência no navegador.

## Evidência histórica: por que o delta genérico falhou?

A [PR #101](https://github.com/Julioall/kingdom/pull/101) tentou patches genéricos de `people`, `animals` e `structures`. Os dados do benchmark mostraram **6,19 MB de patch vs 6,38 MB de objetos completos por dia**, apenas ~3% menores, porque as áreas alteradas são justamente as mais caras:

| Campo (um dia de exemplo) | JSON de campos alterados (aprox.) |
|---|---:|
| `people.perception` | 3,70 MB |
| `people.navigationRoute` | 1,21 MB |
| `animals.perception` | 0,74 MB |
| `people.knownRoutes` | 0,20 MB |

A PR continua experimental e sem gates verdes; **não** deve ser ativada, nem presumir que todo campo de um ator é estático só porque seu ID não mudou.

## Prova de conceito de patches por recurso

[PR #107](https://github.com/Julioall/kingdom/pull/107) implementa codec **desconectado do Worker** para `perception.resources` por `tileIndex`: entradas, saídas, alterações por campo e ordem exata. Valida schema/duplicações/valores e usa fallback integral se patch não for ao menos 10% menor em bytes JSON. A reconstrução é imutável e seus resultados são validados contra recursos reais de pessoas e animais.

[Benchmark reproduzível](https://github.com/Julioall/kingdom/actions/workflows/jul277-resource-rows.yml): três seeds (1,42,2026), dias 2–8 (21 dias/seed), 120 atores por dia; **2.520 observações de ator e 228.518 linhas de recursos**.

| Métrica | Versão inicial JSON por campo | Comparação direta de objetos |
|---|---:|---:|
| Recursos completos, total | 84,61 MB | 84,61 MB |
| Patches + fallbacks, total | 37,22 MB | 37,22 MB |
| Redução em `perception.resources` | **56,01%** | **56,01%** |
| Custo total de encode (21 amostras dia) | 2.307,93 ms | 1.438,95 ms |
| Custo médio de encode/dia | ~109,9 ms | **~68,5 ms** |
| Custo médio de decode/dia | ~44,5 ms | **~46,1 ms** |
| Atores com patch/fallback | 2.142 / 378 | 2.142 / 378 |

Os dias de regeneração semanal (7º dia) reduzem a economia da parcela para ~34%, contra ~55–64% nos dias comuns. Isso faz sentido: mais mudanças reais na vegetação exigem mais campos atualizados.

**Importante:** os ganhos de bytes são **somente em `perception.resources`**, não no payload total do Worker. Tempos são `performance.now` em Node/Linux (proxy de CPU), não structuredClone, Chrome GPU, rede, heap ou FPS. O benchmark calcula os patches em sequência fora de `stepDay`. O custo adicional médio de ~115 ms de encode+decode/dia é alto o suficiente para **não justificar ativação** na arquitetura atual.

## Nova direção recomendada — duas camadas de dados

Em vez de enviar toda a cognição de cada ator a cada dia:

1. **Camada quente de renderização:** payload mínimo para posição, identidade, animação, saúde/status, reino, ordens visíveis, estruturas e tiles; deltas revisionados/validados pelo Worker e pela UI.
2. **Camada de detalhe sob demanda:** `inspect-person` e `inspect-animal` consultam `perception`, `navigationRoute`, `knownRoutes`, `sensoryMemory`, `brain`, `militaryBrain`, `lastDecision` e demais históricos apenas quando o usuário abre o inspetor. A resposta deve conter `epoch`, `revision`, `personId` e um contrato de expiração, para que uma inspeção tardia não sobrescreva o ator recém-selecionado.
3. **Resync/fallback:** reset completo após gaps, eventos de spawn/despawn, render DTO incompleto, alteração de protocolo ou falha de validação. Não usar estado de interface como fonte autoritativa para a simulação.
4. **Auditoria da interface:** `src/ui/game.js` usa `perception.territorialAwareness`, `knownRoutes`, `brain` e `militaryBrain` no painel detalhado. A separação não pode remover esses dados sem antes migrar o inspetor e testar toda interação; buscas estáticas não provam ausência de acesso dinâmico.
5. **Gates:** paridade da experiência visual e do inspetor (NPC e animal), comandos e seleção, replays/epoch/reset, tamanho real de structuredClone, latência p95 do Worker, heap/GC, A/B 50/500/5k atores, Chrome com GPU local.

A proposta de HFSM/estado neural segue apenas registrada em [JUL-292](https://linear.app/julio-alves/issue/JUL-292), adiada pelo usuário. **Este diagnóstico não altera o comportamento dos NPCs e não faz rollout de entidade delta.**
