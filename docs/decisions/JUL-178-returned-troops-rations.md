# JUL-178 — reintegração individual durante a retirada

Data: 27/10/2026

## Problema

O trace de Davi X mostrou um soldado em casa, com a campanha em retirada e ração de campo zerada, mas ainda associado à campanha enquanto outros soldados regressavam. A regra de guarnição e a compra militar recusavam quem mantinha `campaignId`. Assim, mesmo após seu retorno registrado, ele podia continuar sem acesso à rotina de ração da guarnição.

## Decisão

Durante a preparação da retirada, soldados que já têm o retorno registrado ou chegam ao ponto de reunião saem individualmente da lista ativa da campanha e voltam ao serviço militar. A campanha continua com os soldados ainda em campo. A reintegração preserva classe, posto e lealdade, limpa a ordem de campo e registra um evento de retorno por lado; não cobra ração da campanha nem concede comida automaticamente. A rotina existente de guarnição só pode abastecer o soldado conforme estoque e acesso físico à guarnição ou à casa em que descansa.

Foi considerada uma exceção para fornecer ração da guarnição a pessoas ainda vinculadas à campanha. Isso manteria um mesmo soldado em duas fontes de suprimento e exigiria um novo lançamento de origem no ledger da campanha. A reintegração individual separa os períodos de campo e guarnição e permite que o ledger de campo continue reconciliando sua própria carga. Outra alternativa, esperar toda a campanha regressar, reproduziu o período sem acesso à ração.

## Evidência e fontes

- `tests/campaign-readiness.test.mjs` reproduziu a falha antes da mudança: o soldado já retornado mantinha `campaignId` enquanto outra tropa seguia em campo. Após a correção, verifica retorno por flag ou chegada física, preservação da classe/lealdade/vaga, débito exato do tesouro ao retirar ração e impossibilidade de o soldado liberado consumir a carga da campanha. Também verifica que um soldado ainda designado à campanha não retira a ração de guarnição.
- Testes focados de campanha, ração e conservação passaram 16/16; `npm test` passou 266/266; typecheck/build e `git diff --check` passaram. O jogo iniciou e avançou no navegador sem erros de console; esse smoke não reproduziu a retirada.
- Replay de 365 dias da seed 42 no código `4909a3cee9f1e47b203cea4001fe7386f95972a3`, com repetição: estado `4c734e826355e2376fac0d93d4a414474bcc8c1d71f183f3a25cca6a524d15a1` e crônica `be9062eea7d24aa4cf582caa35ca5f95041ace51b8061b71abac067f6a0a5e57` coincidiram. Não houve mortes humanas nem animais; os ledgers dos quatro lados de campanha foram reconciliados. A contagem de adulto-dias abaixo de 20 foi 1.997, contra 2.409 no replay anterior de descanso; estoques comuns finais foram 12.325,54 e 21.772,16. A comparação é de mundos que divergiram após a mudança e não isola todos os efeitos.
- Trace individual no mesmo código: Davi já estava fora da campanha no dia 240, descansou na casa no dia 251 e sua reserva pessoal subiu de 48,331 para 54,649 no dia 252; estava vivo no dia 365, com reserva 36,748. O trace não registra a origem da refeição individual, então o débito de origem é demonstrado pelo teste controlado, não atribuído pela observação agregada. Relatórios: `docs/verification/JUL-178-returned-troops-365-seed42-20261027.json` e `docs/verification/JUL-178-returned-troops-trace-365-seed42-20261027.json`.
- SciSpace foi consultado sobre simulação de logística militar. *Tactical logistics and distribution systems (TLoaDS) simulation* (1999, [DOI](https://doi.org/10.1145/324898.325030)) discute simulação da distribuição de suprimentos, inclusive rações. A fonte não valida a regra específica deste jogo nem seus números; os testes e replays são necessários para avaliar o comportamento.
- Game Studio foi consultado na arquitetura e no playtest das fatias do projeto. Consensus seguia sem cota até 01/11/2026.

## Limites

A guarnição ainda usa a política existente de estoques, cuja proteção da reserva civil requer auditoria própria. Um retorno à guarnição só oferece comida quando há estoque e o soldado tem acesso ao local previsto; escassez e morte permanecem possíveis. A mudança pode alterar a disponibilidade de soldados para outras campanhas após o retorno e precisa de replays de guerra, não apenas testes isolados.
