# Kingdom — coordenação da simulação por domínios

A simulação autoritativa pertence ao Worker; **renderizador e componentes do HUD não mudam o mundo diretamente**. O ponto de entrada de um dia é `src/simulation/systems.js`. A ordem nele é um contrato de causalidade e, durante refatorações estruturais, não deve mudar.

## Responsabilidades

| Módulo | Contrato | Não deve fazer |
| --- | --- | --- |
| `systems.js` | Agendar fases do dia em ordem estável; decidir quando obter snapshot | Implementar regras de clima, comércio ou batalha em detalhe |
| `runtime/environment-phase.js` | Estabelecer recursos ambientais, estradas e domínio territorial antes das decisões | Atualizar UI, produzir comida fictícia |
| `runtime/economy-maintenance.js` | Atualizar estoques soltos, decomposição legada e manutenção periódica de mercados/fortificações | Criar renda sem ledger; importar renderer |
| `runtime/day-consequences.js` | Aplicar consequências territoriais e publicar registros periódicos | Inventar resultados de guerra ou mudar arbitrariamente ordens de agentes |
| `runtime/phase-measure.js` | Instrumentar fases com custo zero de relógio quando desativada | Guardar estado da partida; mudar a ordem dos sistemas |

## Invariantes para PRs seguintes

1. A mesma seed e os mesmos comandos devem resultar no mesmo estado autoritativo após refatoração puramente estrutural.
2. Estoques de alimento, material, ouro e soldo permanecem finitos, segregados por proprietário e registráveis. **Não confundir produção ambiental com inventário disponível.**
3. A ecologia detalhada não é prioridade de produto, mas os seus componentes continuam em uso. Substituí-los **por cadeias econômicas reais** antes de desligar os sistemas atuais.
4. A saída para renderização é snapshot/evento da simulação, não ponteiro mutável para estado interno do Worker.
5. A IA recebe observações limitadas, produz ordens validadas e registra consequências; nenhuma otimização pode dar conhecimento oculto a governantes ou generais.
6. As fases são medidas quando o profiler está ativo. Não ligar perfilamento em toda execução, pois as amostragens alteram o custo medido.

## Próximas extrações

- `src/ui/game.js`: input/câmera, composição do mapa e entidades, HUD/inspeção e controle de sessão, com testes de equivalência.
- `src/simulation/individuals/actions.js`: separar planejamento de ações, validação e execução.
- `src/simulation/kingdoms/campaigns.js`: separar operações do quartel-general, logística/custo, formação no campo e resolução de conflitos.
- Evolução de renderizador 2D acelerado (PixiJS) somente com comparação A/B no navegador e contratos de snapshots preservados.

## Verificação

```bash
npm run typecheck
npm test
npm run build
node scripts/benchmark-phase-v2.mjs out/perf-phase-refactor.json
```

Após a verificação no Node, comparar `?seed=42&profile=1&renderHz=display` com a versão anterior em navegador real e cenários de combate. O objetivo de 144 FPS não equivale a validação de renderização com GPU, sobretudo com 5.000 personagens.
