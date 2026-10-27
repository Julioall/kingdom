# JUL-178 — target de coleta sob fome crítica

**Status:** fatia em validação; JUL-178 continua In Progress.

## Contexto e evidência

A branch `test/kingdom-autonomous` parte do merge `587894d136956e0db5f385f50830dd63eeca7613`; a `main` remota `b36727648370ac52a02707b86fbcfcb5a9315d10` já é ancestral e não havia commit novo a integrar.

O trace local de seed 42 mostra Cora N morrendo de fome no dia 795. Nos oito dias anteriores, sua posição oscilou enquanto o alvo de forrageio mudou diariamente. O trace registrou uma mancha com 80,48 unidades de biomassa colhível a cinco tiles; a agente continuou escolhendo alvos pequenos antes de alcançá-la. A regressão em `tests/food-navigation.test.mjs` reduz o caso a duas opções e falhava no código anterior: com reserva zero, o seletor devolvia o arbusto próximo com 1 unidade, em vez do alvo com 100 unidades a cinco tiles.

O contrato local usa `DAILY_FOOD_NEED = 0.78` pontos de reserva e `FOOD_RESERVE_PER_UNIT = 0.72`. Portanto, uma unidade colhida repõe menos que a ração diária. Na regressão, o alvo distante permite colher até cinco unidades (`3.6` pontos), cobre três dias estimados de deslocamento (`2.34`) e uma ração (`0.78`); o alvo próximo não cobre a ração. A decisão usa o fluxo de inventário existente e não adiciona comida.

As medições históricas também mostram 200 trocas de alvo antes da colheita em 1.798 inícios de alvo no horizonte de 365 dias; 103 ocorreram enquanto o alvo anterior ainda estava visível e 24 enquanto continuava colhível. Esse JSON está no diretório local `reports/` como material de trabalho não rastreado; permaneceu sem alteração. A regressão rastreada reproduz a decisão equivocada sem depender desse arquivo.

No SHA-base, o replay de seed 42/253 dias repetiu os mesmos hashes de estado (`02b86b130fff1fa3b461327abe7aca3c906d4216d167c7a2bd5c1bae9a24bf86`) e crônica (`53fd0857bdec1eaf343ad96c0365c45e2b619c328971131092363e5b99c0b31d`). A seed terminou sem morte humana por fome; houve uma morte humana por invasão e uma morte de animal selvagem por fome. Esse resultado cumpre a sobrevivência humana curta, mas não demonstra acesso sustentável ou saúde populacional em horizonte longo.

## Decisão

Sob reserva crítica (`<= 8`), o seletor dá preferência a um recurso cujo rendimento pessoal esperado cubra o custo estimado de viagem e a próxima ração. Mantém o alvo atual se ele ainda estiver perceptível, colhível, alcançável e cobrir esses custos. Alvo falho, esgotado ou insuficiente libera a reavaliação; se nenhum alvo for suficiente, a política mantém o melhor recurso disponível como contingência.

Isso combina compromisso curto com replanejamento por evidência. O código já exclui recursos sem ponto de aproximação acessível e mantém uma lista curta de alvos sem rota; essa proteção continua ativa. Não há cooldown longo nem bloqueio permanente do alvo.

## Alternativas consideradas

1. **Aumentar biomassa ou regeneração:** rejeitada. A biomassa agregada já pode ser alta enquanto pessoas morrem; esse ajuste não corrige o acesso e ampliaria a ecologia fora do escopo.
2. **Cooldown uniforme de sete dias:** rejeitado pelos replays históricos, que elevaram as mortes por fome em comparação com a alternativa então vigente.
3. **Manter só o bônus de continuidade atual (`0.14`):** insuficiente; a regressão demonstra que um alvo próximo de baixo rendimento ainda supera um alvo de sobrevivência mais distante.
4. **Travar o alvo em qualquer condição:** rejeitada. Recurso esgotado ou sem rota precisa ser descartado; a retenção vale somente enquanto o alvo continua válido e paga a viagem mais a próxima ração.

## Referencial e limitações

- SciSpace encontrou Müller et al. (2020), [“Modelling food security: Bridging the gap between the micro and the macro scale”](https://doi.org/10.1016/j.gloenvcha.2020.102085). O artigo destaca heterogeneidade, comportamento adaptativo e consequências dependentes do tempo em modelos alimentares. É orientação metodológica; não prova que esta regra melhore Kingdom.
- SciSpace também retornou Thorn (2026), [“Households under pressure: a systems framework for modeling the ‘watch’ famine archetype”](https://doi.org/10.1057/s41271-026-00646-5), que discute forrageio e racionamento como respostas à lacuna alimentar. O resumo aponta que coping pode ajudar, mas racionamento pode elevar risco quando reduz reservas energéticas; é um modelo parcial, não uma calibração para este jogo.
- Consensus foi tentado e está sem cota até 01/11/2026 (30 buscas mensais utilizadas). O conector Game Studio não está disponível; usei o skill local `game-playtest`. A alteração é somente lógica de simulação e não muda sprites, UI ou combate, então não há nova captura visual pertinente nesta fatia.
- O conector de contexto compartilhado do Linear também não respondeu: `get_agent_context` retornou `Tool get_agent_context not found`. A issue, histórico do Linear, código e relatórios versionados foram usados no lugar.

## Validação desta fatia

- Regressões direcionadas `food-navigation` + `economy-conservation`: 11/11 passaram após a implementação. O novo caso falha antes da regra de retenção e passa depois.
- `npm test`: 167/167 passaram.
- `npm run typecheck`: passou.
- `npm run build`: passou (107 módulos; 489 imagens otimizadas pelo script existente, redução de 8,03 MiB para 5,27 MiB).
- Replay de seed 42/253 dias antes da mudança: determinístico e sem morte humana por fome; as contagens por tipo distinguem a morte animal por fome da morte humana por invasão.
- Replay pós-mudança de seed 42/253 dias: 0 mortes humanas por fome, 1 morte de animal selvagem por fome, 3.951 adultos-dia com reserva abaixo de 20, sem estoque negativo; a conciliação da campanha fechou (2 lados, 0 sem ledger, 0 sem balanceamento). A repetição produziu exatamente o mesmo estado (`667daaf54ac5e282a885cffd6cb6e0313cd9263803c01271c84216dee841ab31`) e crônica (`ded9eb46a5dc51df2cf3fdbcf1acee57d7b7ddceb57fb1830b7940a3929eafc1`). O auditor iniciou antes do commit da fatia e, por isso, seu campo `sourceRevision` aponta para o SHA-base; o arquivo do código simulado e o SHA do commit serão vinculados na evidência seguinte.
- O replay pós-mudança terminou com uma campanha ainda ativa e saldos comunitário, tesouro, mercado e campo iguais a zero. Isso confirma conciliação, mas não prova reserva disponível para uma guerra futura.
- Replay de 800 dias na seed 42 no SHA commitado: pendente. O trace histórico da seed 42 registra a primeira morte humana por fome no dia 795, então esse horizonte cobre a falha original.

JUL-178 permanece aberta. Os critérios multissemente, horizontes de 365/730 dias, choques controlados, reconciliação completa e avaliação de reservas de campanha ainda precisam de evidência atualizada.

## Replays atuais de 730 dias e diagnóstico da roça

Foi executado `npm run audit:food -- --days 730 --seeds 1,42,987,2026 --repeat-seed 42` no commit de simulação `74fa34f7be7e416abf2608eac667272106c747d1`. O código de simulação permaneceu igual no commit `49f37ea` que acrescentou métricas de estado do campo. Relatório versionado: `docs/verification/JUL-178-food-current-730-20261027.json`.

| Seed | Pessoas vivas no final | Mortes humanas | Adultos-dia com reserva <20 | Colheita cultivada acumulada | Regrowth cultivado | Ovelhas selvagens mortas de fome | Comida comunitária no fim |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 100 | nenhuma | 34.694 | 15.057,27 | 24.442,24 | 22 | 0 |
| 42 | 90 | 9 invasões, 1 combate | 37.933 | 0 | 0 | 4 | 0 |
| 987 | 100 | 2 invasões, 1 combate | 26.694 | 29.549,30 | 33.698,29 | 25 | 15,53 |
| 2026 | 101 | 3 invasões | 31.741 | 13.310,15 | 16.413,39 | 24 | 121,13 |

O replay repetido da seed 42 gerou o mesmo SHA de estado (`b81c68cf31a0c97882df0e0a437d597a2a32471c1da9f63b6f1e6f115c0c14b3`) e o mesmo SHA de crônica (`9a1103d3033d7d2e61e1dcf13cfc6ae1a8cf8ac6b9ca9b078826f4f1d6314b25`). Os ledgers de campanha ficaram balanceados em todas as seeds. Nenhuma morte humana foi atribuída a fome; isso não demonstra que a população esteja bem alimentada: houve 26.694–37.933 adultos-dia com reserva abaixo de 20, e a comida comunitária terminou quase sempre zerada. Animais selvagens morreram de fome.

Os replays registraram 68–78 transações de mercado por seed em 730 dias, mas o relatório não discrimina mercadoria, ator nem motivo. Esse contador não prova que a venda de colheita ou a compra de alimento estejam funcionando para os moradores.

Um replay separado de 365 dias/seed 42, com instrumentação de campo no commit `49f37ea7eb8e75d2982d997b928c90fb619adad`, encontrou duas roças incompletas no dia 365 (32/34 e 19/34), cada uma com 8 unidades de sementes atribuídas e nenhuma biomassa cultivada semeada, em pé ou colhida. Estado: `bc6c30241495ade900999eb9e27d9a7c0cf18e30cccb485384c6a884d3a1793a`; crônica: `972d8b364b3ae14f60bd87479d2f54534550bf10273f67d00a87e43fd387d9e5`. Evidência completa: `docs/verification/JUL-178-food-fields-seed42-365-20261027.json`.

Conclusão limitada: conservar biomassa vegetal no mapa é necessário, mas ela não comprova comida colhida, armazenada ou comprável. A seed 42 também mostra um gargalo de construção antes de qualquer ciclo de cultivo. A proposta de compra de sementes no mercado está detalhada em `docs/decisions/JUL-178-market-seed-cycle.md` e foi adicionada ao escopo de JUL-201; a auditoria JUL-178 segue aberta enquanto faltarem a reprodução mais ampla, a distinção de transações e o fechamento da cadeia de acesso.
