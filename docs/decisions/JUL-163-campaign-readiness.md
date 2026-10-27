# JUL-163 — prontidão e evidência de campanha

**Data:** 26/10/2026

**SHA da implementação testada:** `cb4a06c546c9ae117ae107ffdd5dbd84bb440504`
**Status da fatia:** regressões de prontidão adicionadas; M4 permanece In Progress.

## Decisão

Uma campanha autônoma só pode mobilizar contra um local relatado/observado e quando a força atacante possui reservas para 18 dias de ração. Enquanto espera por provisões, não deve transferir ou consumir estoque. Se a situação não mudar durante 180 dias, a guerra termina em armistício sem vencedor e preserva o status quo territorial.

Essas são regras existentes de `src/simulation/kingdoms/campaigns.js`; esta fatia adiciona testes que protegem o comportamento contra regressões. Não foi alterada a heurística de guerra, a oferta de comida ou o poder de combate.

## Alternativas consideradas

| Alternativa | Motivo para rejeitar |
| --- | --- |
| Mobilizar mesmo sem localização conhecida | Dá ao reino objetivo global/omnisciente e enfraquece a rastreabilidade exigida por JUL-163. |
| Debitar suprimentos antes de confirmar o orçamento mínimo | Perde recursos enquanto a unidade permanece no posto, sem campanha ou viagem executada. |
| Manter indefinidamente a guerra sem efetivo/ração | Cria estado terminal sem ação útil; o armistício preserva as fronteiras e registra o custo da espera. |
| Criar comida para satisfazer a mobilização | Viola os estoques finitos e confunde política militar com produção ecológica. |

As referências já consultadas para M4 incluem Sheeba e Ghose, “A resource based game theoretical model for military conflicts” (2007), sobre alocação temporal/espacial de recursos sob conflito. A evidência é metodológica e não calibra os 18/180 dias do Kingdom; essa calibração é contrato de gameplay coberto por teste, não resultado acadêmico. Ver também [a decisão de escambo e fronteira](JUL-163-border-trade.md), que registra os limites de SciSpace, Consensus e Game Studio.

## Evidência

`tests/campaign-readiness.test.mjs` usa o motor de produção (`engine.createWorld(42)` e `prepareKingdomCampaigns`):

1. Guerra sem localização observada fica `blocked`, registra o motivo e não cria campanha.
2. Guerra com alvo observado, mas zero alimento no tesouro, estoque comunitário e reservas dos soldados, fica `awaiting-supplies`; nenhum estoque é debitado e nenhum soldado é atribuído. Após 180 dias, vira `settled-without-supplies`, a relação retorna a paz e registra tratado de status quo sem vencedor.

Validação direcionada: `node --test tests/campaign-readiness.test.mjs` passou com 2/2; `git diff --check` passou. Isso não substitui replays de campanhas que marcham, combatem, ocupam ou recuam nem encerra o aceite de JUL-163.
