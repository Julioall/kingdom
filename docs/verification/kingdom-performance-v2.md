# Kingdom Performance V2 — gates e rollback

A fase inicial mantém o motor de simulação original sem encurtar as etapas de
ecologia, hidratação, vegetação, comida, combate e mercado.

## Entregas
- Instrumentação opt-in de sociedade/NPCs, combate, campanhas, fronteiras e economia.
- Busca de presas/ameaças em uma passagem e índice diário de pessoas para percepção de ameaças.
- Máscara semanal das células bloqueadas por estruturas para a regeneração de árvores.
- Atualização de HTML de painéis de reino/fauna/flora/crônicas somente quando muda.
- Modos de transporte e orçamento cognitivo **opt-in** e independentes no navegador.
- Metadados do Worker em `?profile=1`: tempo de simulação, captura e fases.

## Flags de QA
- `?seed=42&profile=1`: profiler sem alterar a política normal.
- `?seed=42&profile=1&transport=delta`: os mesmos atores completos com tiles em delta.
- `?seed=42&profile=1&transport=compact`: projeção de atores leve, com inspetor via Worker.
- `?seed=42&profile=1&cognitiveBudget=128`: scheduler neural experimental.
- `?seed=42&profile=1&transport=compact&cognitiveBudget=128`: experiência combinada.

Não confundir ganhos do transporte com os do agendamento cognitivo.
Para rollback basta remover os parâmetros da URL. O perfil de jogo normal
ainda não usa os modos experimentais por padrão.

## Testes e métricas
`npm test` cobre a semântica, instrumentação e consultas no Worker.
`node scripts/benchmark-phase-v2.mjs out/perf-v2.json` mede p50/p95
por fase, com snapshots completos idênticos entre um mundo instrumentado e
outro não instrumentado.

`.github/workflows/performance-v2.yml` executa A/B de dois checkouts em
um mesmo host nas populações 100/500 e seeds 1/42. Em
`workflow_dispatch`, pode executar 5.000 pessoas. A comparação exige
hash do estado autoritativo idêntico e informa os tempos, mas não
considera um ganho de poucos % prova suficiente sem repetições e
inversão da ordem dos ensaios.

QA humano adicional: Chrome em GPU real, FPS e p95 do frame, heap,
p95 Worker, resync e seleção de NPC/animal, nascimentos, mortes,
comércio e combate com campanhas. Essas verificações ainda precisam
ser realizadas antes de ativar os modos opcionais por padrão.
