# JUL-178 — registro de ração e cenário controlado de rebanho

Data: 26/10/2026  
Branch: `codex/jul195-integration`  
Commit de implementação: `5c55c6ec145a810cee2decafa5ca4a87da83cda0`  
Evidência reproduzível: `docs/verification/JUL-178-livestock-shock-20261026.json`

## Decisão

`feedCommunalHerds` já debitava ração finita dos estoques da comunidade e devolvia o total consumido ao chamador, mas o mundo não retinha esse total em um ledger cumulativo. Agora, após um débito bem-sucedido, acumula `ecologyFlows.livestockFeedConsumed`. Isso torna visível a entrada do rebanho no snapshot e no replay sem alterar a regra de alimentação. `harvests.livestockMeat` continua registrando a saída da conversão de uma ovelha em carne, enquanto a carga pessoal mostra a localização imediata do produto.

Foi adicionado `npm run audit:livestock` para exercitar, em quatro seeds, a sequência de ração comunitária e abate emergencial nas funções de produção. A repetição da seed 42 compara os resultados observáveis. O replay não afirma que o mundo padrão alcança essa decisão sozinho: sua configuração inicial atribui três ovelhas adultas geradas a uma comunidade, cria um abrigo utilizável, reduz o alimento comum a zero, deixa uma pessoa com reserva 8 e torna as três ovelhas visíveis. A chamada de captura usa o gerador determinístico com estado fixo.

## Resultado observado

Em cada seed (`1`, `42`, `987`, `2026`): 0 alimento comunitário inicial; 3 ovelhas adultas; 0,36 de ração disponível; 0,36 debitada e lançada no ledger; 1 abate; 23,04 unidades de carne produzidas e carregadas; 2 adultas restantes. A repetição da seed 42 produziu os mesmos campos observáveis (`determinismVerified: true`). O fator nutricional representa 57,6 pontos de necessidade para os 23,04 de carne; não é uma segunda criação de alimento.

O replay usual do mundo não comprovou a emergência do rebanho: as execuções de 253 e 730 dias já documentadas reportaram `harvests.livestock=0`. Portanto, este resultado demonstra conservação e conversão sob um choque alcançável, não o benefício da política em condições naturais nem a sobrevivência ao longo do tempo. A JUL-178 permanece aberta para os demais critérios, incluindo entrega/consumo posterior, custo de sementes, campanha e cenários de mercado.

## Alternativas consideradas

| Alternativa | Decisão | Justificativa |
| --- | --- | --- |
| Manter apenas o retorno transitório de `feedCommunalHerds` | Rejeitada | Replays e snapshots posteriores não poderiam reconciliar o débito cumulativo da comunidade com a entrada consumida pelo rebanho. |
| Criar leite, carne periódica ou produção automática | Rejeitada | Criaria uma cadeia nova de produto e mais regras ecológicas sem evidência; o escopo exige custos e saídas finitos. |
| Adicionar um contador no ledger e um choque de teste controlado | Escolhida | Expõe o débito já existente, testa a conversão existente e preserva o limite de duas adultas sem simular biomas ou estações. |
| Usar apenas seeds/horizontes normais | Insuficiente | O rebanho de emergência não foi acionado nos replays anteriores, então isso não evidencia seu fluxo. O cenário controlado complementa os replays normais, sem substituí-los. |

## Fontes e orientação

- Game Studio / skill `game-playtest`: a regra econômica permanece na simulação; o renderer não foi alterado. Como esta fatia não muda UI, animação ou combate, a validação adequada é o replay de ledger e os testes direcionados, sem screenshot de browser.
- SciSpace: Moritz, Buffington, Yoak et al., [“No Magic Number: an Examination of the Herd-Size Threshold in Pastoral Systems Using Agent-Based Modeling”](https://doi.org/10.1007/S10745-017-9927-0) (2017). O resumo relaciona as taxas de retirada ao crescimento do rebanho e recomenda compreender o limiar como faixa de probabilidades; isso justifica replays em várias seeds, mas não calibra um limiar do Kingdom.
- SciSpace: Langelaan, van Langevelde e Wagener, [“Resilience of pastoralist livelihoods in dry grazing systems under different preferences”](https://doi.org/10.1016/j.ecoleco.2026.109120) (2026). O resumo descreve uma troca entre retirada, retorno econômico e resiliência sob choques. A referência motiva medir custo e resultado juntos; suas dinâmicas ecológicas não foram importadas para o jogo.
- Consensus continua sem cota de busca até 01/11/2026; a restrição já está registrada em `docs/decisions/JUL-195-architecture-and-evidence.md`.
- A ferramenta de notas `linear_get_agent_context` não está instalada (`Tool get_agent_context not found`), confirmado nesta etapa. O código, as issues e as evidências anteriores foram usados como fontes operacionais.

## Validação nesta etapa

- `node --test tests/livestock-food.test.mjs`: 6/6.
- `npm run audit:livestock -- --output docs/verification/JUL-178-livestock-shock-20261026.json`: quatro seeds e repetição da seed 42; replays passaram e foram determinísticos.
- `npm run build`: passou (99 módulos); permanece o aviso conhecido de chunk acima de 500 kB.
- `git diff --check`: passou.
- `npm test`: 94/94 passou em 70,5 s; inclui Worker determinístico, economia, campanha, rebanho, navegação alimentar e memória social.

## Limite da decisão

O cenário controlado chama diretamente as funções de produção `feedCommunalHerds` e `attemptHumanHunt`. Não demonstra que `stepDay` ou a política autônoma produzam a configuração, nem que a carne seja entregue e consumida depois. Essa diferença está explícita para evitar marcar como concluído um aceite maior do que a prova disponível. A etapa não altera biomas nem regras sazonais; estações continuam representadas apenas pela troca visual de tiles.
