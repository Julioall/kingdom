# Cadência do clima e do ambiente — auditoria de 09/11/2026

## Frequências observadas no loop autoritativo

Fonte: `src/simulation/systems.js`, `src/simulation/ecology/climate.js`, `hydrology.js`, `plants.js`, `roads.js`.

| Processo | Cadência existente | Necessidade / decisão |
|---|---:|---|
| `updateClimate`: chuva/temperatura/umidade de regiões e tiles | Todo dia | **Manter diário.** Sorteios usam `rand(world)` e determinam chuva, seca e visibilidade de hoje. Pular 29 dias altera a sequência RNG e o replay. |
| `updateSoilAndWater`: infiltração, evapotranspiração, escoamento e umidade regional | Todo dia | **Manter diário.** Alterações impactam água potável, sede, caça, agricultura e mortalidade. |
| `updateRoadWear`: pisoteio, pressão do uso e desgaste | Todo dia | **Manter diário.** Os limiares de estrada e colisão são sensíveis ao uso de hoje. |
| `updateAnimals` e `updatePeople` | Todo dia | **Manter diário.** Fome, sede, movimento, reprodução e decisões causais. |
| `updatePlants`: regeneração e dispersão | A cada **7 dias** | Já amortizado. Crescimento de campos deve preservar o calendário atual. |
| `clearWildVegetationNearCorrals` dentro de `updatePlants` | Todo dia | **Manter limpeza diária**; a geometria estática da área protegida pode ser memorizada. |
| `decompose`: nutrientes, detritos e matéria orgânica | Todo dia | Manter até existir integrador calibrado, com paridade de nutrientes e produção. |
| `updateKingdomMarkets` e `maintainKingdomFortifications` | A cada **30 dias** | Já amortizados. |
| `reportWorldState` (relatório ecológico) | A cada **30 dias** | Já amortizado. |

## Alteração segura nesta rodada

`corralNaturalClearanceTiles` (vegetação removida em torno dos currais) agora reutiliza **somente o conjunto geométrico de células**, por no máximo 30 dias de simulação, usando um `WeakMap` por mundo que não entra nos saves nem no transporte Worker.

- Invalida **imediatamente** se um curral surgir, desaparecer, for destruído, mudar integridade, posição ou raio, ou se a grade do mundo for substituída.
- Em um mundo sem mudança de currais, recompõe a geometria apenas nos dias 0, 30, 60, ...; continua checando e removendo vegetação proibida **todos os dias**.
- Mantém a API original que retorna um novo `Set`, sem dar aos consumidores permissão para alterar o cache interno.
- Não muda a ordem de consumo, o RNG, a chuva, a vegetação, a geometria das estradas nem as ações dos NPCs.
- `corralClearanceCacheDiagnostics(world)` expõe somente hits/reconstruções/último dia, para testes e perfilamento.

## Gate antes de ampliar para 30 dias

Comparar worlds completos com as mesmas seeds, noites secas/chuvosas, currais novos/destruídos, colheitas, sede, morte e territórios, validando estado autoritativo e hash de snapshots por dia. Medir CPU/p95 do **passo inteiro** e não afirmar ganho de FPS sem medições no navegador GPU real.

**Não alterar para mensal** a meteorologia, água, nutrição, metabolismo nem a decomposição por mera economia de loops. Uma simulação mensal dessas regras seria um novo modelo ecológico, não uma otimização equivalente; deveria ser opt-in e submetida a testes de comportamento separados.

Refs: JUL-277 (custo de transporte), JUL-281 (integração/QA) e investigação de cadência ambiental.
