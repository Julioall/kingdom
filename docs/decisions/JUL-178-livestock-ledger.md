# JUL-178 — registro de ração e cenário controlado de rebanho

Data: 26/10/2026

Branch: `codex/jul195-integration`

Commits de implementação: `5c55c6ec145a810cee2decafa5ca4a87da83cda0` e `6a0aac72ee0acac88870357238f2afa61b53e921`

Evidência reproduzível: `docs/verification/JUL-178-livestock-shock-20261026.json`

## Decisão

`feedCommunalHerds` já debitava ração finita dos estoques da comunidade e devolvia o total consumido ao chamador, mas o mundo não retinha esse total em um ledger cumulativo. Agora, após um débito bem-sucedido, acumula `ecologyFlows.livestockFeedConsumed`. Isso torna visível a entrada do rebanho no snapshot e no replay sem alterar a regra de alimentação. `harvests.livestockMeat` continua registrando a saída da conversão de uma ovelha em carne, enquanto a carga pessoal mostra a localização imediata do produto.

Foi adicionado `npm run audit:livestock` para exercitar, em quatro seeds, a sequência de ração comunitária, abate emergencial e entrega ao abrigo. A repetição da seed 42 compara os resultados observáveis. O replay não afirma que o mundo padrão alcança essa decisão sozinho: sua configuração inicial atribui três ovelhas adultas geradas a uma comunidade, cria um abrigo utilizável, reduz os estoques alimentares comuns e de governo a zero, deixa uma pessoa com reserva 8 e torna as três ovelhas visíveis. A chamada de captura usa o gerador determinístico com estado fixo. O harness mantém apenas essa pessoa ativa no update de ações para isolar a custódia do produto.

## Resultado observado

Em cada seed (`1`, `42`, `987`, `2026`): 0 alimento comunitário inicial; 3 ovelhas adultas; 0,36 de ração disponível; 0,36 debitada e lançada no ledger; 1 abate; 23,04 unidades de carne produzidas; 2 adultas restantes; carga pessoal zerada após entrega; 23,04 registrados no estoque comunitário e no campo físico do abrigo. Os estoques de alimento e ração da comunidade permaneceram em zero após a ação. A repetição da seed 42 produziu os mesmos campos observáveis (`determinismVerified: true`). O fator nutricional representa 57,6 pontos de necessidade para os 23,04 de carne; não é uma segunda criação de alimento. O saldo comunitário e o campo do abrigo representam o mesmo estoque espelhado, não duas cópias consumíveis.

O replay usual do mundo não comprovou a emergência do rebanho: as execuções de 253 e 730 dias já documentadas reportaram `harvests.livestock=0`. Um smoke adicional de `stepDay` reproduziu a permanência da carga e o desvio para forragear sob reserva baixa; esse é o motivo da correção de prioridade abaixo. O teste e o harness agora passam por `updatePeople` e confirmam a entrega ao abrigo sob estado controlado. Isso demonstra conservação e entrega sob choque, não que o mundo padrão alcance a política sozinho nem que o alimento seja consumido/sustentado ao longo do tempo. A JUL-178 permanece aberta para os demais critérios, incluindo crianças, custo de sementes, campanha e cenários de mercado.

## Alternativas consideradas

| Alternativa | Decisão | Justificativa |
| --- | --- | --- |
| Manter apenas o retorno transitório de `feedCommunalHerds` | Rejeitada | Replays e snapshots posteriores não poderiam reconciliar o débito cumulativo da comunidade com a entrada consumida pelo rebanho. |
| Criar leite, carne periódica ou produção automática | Rejeitada | Criaria uma cadeia nova de produto e mais regras ecológicas sem evidência; o escopo exige custos e saídas finitos. |
| Contar o saldo comunitário de carne e a carne espelhada no abrigo como estoques separados | Rejeitada | A entrega grava o mesmo saldo em ambos os campos; somá-los de novo adiava um abate que a disponibilidade real não sustentava. A regra agora soma apenas carne física que ainda não está representada no saldo comunitário. |
| Forragear antes de entregar carne já carregada quando a reserva está baixa | Rejeitada | O executor desviava do abrigo apesar de já transportar alimento destinado ao estoque comum; agora prioriza a entrega quando existe destino válido. A necessidade diária crítica ainda consome a carga antes da escolha de ação. |
| Adicionar um contador no ledger e um choque de teste controlado | Escolhida | Expõe o débito já existente, testa a conversão existente e preserva o limite de duas adultas sem simular biomas ou estações. |
| Usar apenas seeds/horizontes normais | Insuficiente | O rebanho de emergência não foi acionado nos replays anteriores, então isso não evidencia seu fluxo. O cenário controlado complementa os replays normais, sem substituí-los. |

## Fontes e orientação

- Game Studio / skill `game-playtest`: a regra econômica permanece na simulação; o renderer não foi alterado. Como esta fatia não muda UI, animação ou combate, a validação adequada é o replay de ledger e os testes direcionados, sem screenshot de browser.
- SciSpace: Moritz, Buffington, Yoak et al., [“No Magic Number: an Examination of the Herd-Size Threshold in Pastoral Systems Using Agent-Based Modeling”](https://doi.org/10.1007/S10745-017-9927-0) (2017). O resumo relaciona as taxas de retirada ao crescimento do rebanho e recomenda compreender o limiar como faixa de probabilidades; isso justifica replays em várias seeds, mas não calibra um limiar do Kingdom.
- SciSpace: Langelaan, van Langevelde e Wagener, [“Resilience of pastoralist livelihoods in dry grazing systems under different preferences”](https://doi.org/10.1016/j.ecoleco.2026.109120) (2026). O resumo descreve uma troca entre retirada, retorno econômico e resiliência sob choques. A referência motiva medir custo e resultado juntos; suas dinâmicas ecológicas não foram importadas para o jogo.
- Consensus continua sem cota de busca até 01/11/2026; a restrição já está registrada em `docs/decisions/JUL-195-architecture-and-evidence.md`.
- A ferramenta de notas `linear_get_agent_context` não está instalada (`Tool get_agent_context not found`), confirmado nesta etapa. O código, as issues e as evidências anteriores foram usados como fontes operacionais.

## Validação nesta etapa

- `node --test tests/livestock-food.test.mjs`: 7/7, incluindo saída da reserva duplicada e entrega de carne sob pressão alimentar.
- `npm run audit:livestock -- --output docs/verification/JUL-178-livestock-shock-20261026.json`: quatro seeds e repetição da seed 42; replays passaram, entregaram a carne ao abrigo e foram determinísticos no SHA `6a0aac72ee0acac88870357238f2afa61b53e921`.
- `npm run audit:food -- --days 30 --seeds 42 --repeat-seed 42`: estado e crônica repetidos iguais, sem estoques negativos, zero mortes por fome e `determinismDiff=[]` no SHA `6a0aac72ee0acac88870357238f2afa61b53e921`; hash de estado `21b51efe89f05dfa278cdde8e4913f404092c915956e73cb0c9b562c29f8d868`.
- `npm run build`: passou (99 módulos); permanece o aviso conhecido de chunk acima de 500 kB.
- `git diff --check`: passou.
- `npm test`: 95/95 passou em 69,6 s; inclui Worker determinístico, economia, campanha, rebanho, navegação alimentar e memória social.

## Limite da decisão

O cenário controlado chama `feedCommunalHerds`, `attemptHumanHunt` e o update de ação de uma pessoa isolada. Não demonstra que `stepDay` ou a política autônoma produzam a configuração, nem que a carne armazenada sustente o grupo por vários dias; o replay padrão ainda tem abate zero. Essa diferença está explícita para evitar marcar como concluído um aceite maior do que a prova disponível. A etapa não altera biomas nem regras sazonais; estações continuam representadas apenas pela troca visual de tiles.
