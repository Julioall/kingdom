# Utility AI: continuidade de objetivos voluntários

O Kingdom já soma utilidades econômicas/individuais, logits neurais, preferências aprendidas e objetivos estratégicos na seleção de cidadãos. Esta integração **não cria outro decisor**: acrescenta uma margem pequena de continuidade ao final da comparação das pontuações existentes.

### Contrato

- **Opt-in**, controlado por `world.neuralOverrides.utilityContinuity === true`; desativado por padrão até testes comportamentais e A/B.
- Se a última decisão voluntária foi no dia anterior (`lastDecision.scores` presente) e sua ação segue viável (`utility >= 0`), o agente pode preservar o objetivo se outra alternativa vencer por no máximo **0,12 ponto**.
- Diferença superior a 0,12, decisão forçada, ação inválida, pressão de sobrevivência, ordem militar ou tarefa obrigatória **não recebem histerese**. Os guardas de prioridade já operam antes de `choosePeopleAction`.
- Nenhum `rand()` adicional, nenhuma inferência extra ou estado duplicado. Usa `lastDecision` já serializada e `world.day`.
- Os campos de aprendizado seguem a ação escolhida e mantêm a atualização normal do cérebro.

### Testar

```bash
node --test tests/utility-continuity.test.mjs tests/npc-action-state-machine.test.mjs
npm test
npm run typecheck
npm run build
```

A comparação V2/V3 deve permanecer idêntica no modo legado. Testes direcionados verificam margens de pontuação, envelhecimento da decisão, viabilidade e preservação de prioridades. Para avaliar o modo híbrido, usar comparação determinística **entre duas execuções híbridas idênticas**, além de critérios comportamentais (conclusão de tarefa, tempo de inatividade, necessidades atendidas, ordens cumpridas). Não interpretar estabilidade como aumento garantido de autonomia.
