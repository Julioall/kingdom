# JUL-178 — Matriz de estresse alimentar

Data: 27/10/2026  
Código de simulação validado: `1a2a8d6ff8b7c96afa08ae8486c70d1a61cea310`

## Execução

Comando executado no checkout baseado no SHA acima:

```powershell
node --test tests/food-unit-days.test.mjs tests/food-survival.test.mjs tests/food-navigation.test.mjs tests/food-harvest-conservation.test.mjs tests/cultivated-field-batch.test.mjs tests/field-construction-reserve.test.mjs tests/war-trade.test.mjs tests/campaign-readiness.test.mjs tests/economy-conservation.test.mjs tests/food-farm-ui.test.mjs tests/ai-calendar-observations.test.mjs
```

Resultado: **67/67 testes passaram**. Também foram executados separadamente os dois novos casos de ausência de trabalhador/sem sementes: **7/7** testes nos arquivos `cultivated-field-batch` e `field-construction-reserve`.

## Cenários cobertos

| Choque ou controle | Evidência determinística | Resultado observado |
| --- | --- | --- |
| Estoques pessoais/comunitários vazios | `food-survival`: soldado sem alimento compartilhado não forrageia; dependente sem cuidador útil não recebe comida; `economy-conservation`: transferências insuficientes são limitadas à origem | Nenhuma ração é criada; o soldado pode comprar uma ração finita se houver ouro e oferta acessível |
| Mercado vazio / oferta incompleta | `war-trade`: mercado sem oferta executável e compra abaixo do lote; `economy-conservation`: saldos do mercado de 0 a 12 | Compra não ocorre, nenhum saldo fica negativo e o motivo de bloqueio é observado |
| Fronteira fechada / caminho bloqueado | `war-trade`: comércio rejeitado com fronteira fechada; `food-navigation`: destino de coleta bloqueado ou inacessível | Não há troca nem coleta pela rota impossível; o agente pode tentar uma borda alcançável ou trocar de tarefa |
| Carga no limite | `food-harvest-conservation` e `economy-conservation` | A colheita não remove quantidade que não cabe; excedente só é creditado a um destino comunitário válido |
| Sem sementes | `cultivated-field-batch`: `cropSeedStored = 0` ao semear | Nenhum tile muda, a roça fica gasta e nenhum alimento ou ciclo é criado |
| Sem trabalhador civil elegível | `field-construction-reserve`: comunidade composta por soldados, com plano de primeira roça e materiais zerados | Nenhuma tarefa de preparo é atribuída, nenhuma obra é criada e estoques não mudam |
| Guerra sem ração | `campaign-readiness`: mobilização sem 18 dias de suprimento | Campanha aguarda e resolve sem combate, sem criar campanha ativa nem debitar estoque |
| Unidade/persona-dia e colheita válida | `food-unit-days` e `cultivated-field-batch` | 1 comida vegetal = 1 dia; 50 pessoas × 180 dias = 9.000; 8 sementes em 24 tiles produzem até 10.000, das quais 8 ficam retidas para replantio |

## Limite da evidência

Esses são testes unitários/de integração com choques controlados, não replays longos de mundo inteiro sob cada choque. Os replays normais de 253/365/730 dias nas quatro seeds e repetição de 42 estão nos relatórios JSON finais anexados à JUL-178. A auditoria segue aberta porque a colheita da roça ainda é creditada diretamente ao estoque comunitário, sem transporte físico observado; também faltam medições/solução para o acesso individual quando o saldo comum está alto e algumas reservas pessoais permanecem abaixo de 20 dias.
