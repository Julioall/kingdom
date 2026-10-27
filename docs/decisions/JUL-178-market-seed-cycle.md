# Decisão — ciclo de sementes e produção da roça

Data: 27/10/2026
Estado: decisão de produto registrada; implementação pendente de JUL-178 e JUL-201
Issues: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-cultivo-caca-civis), [JUL-201](https://linear.app/julio-alves/issue/JUL-201/m3-fazer-peoes-venderem-excedentes-e-comprarem-no-mercado)

## Decisão

A roça terá um ciclo econômico visível: **comprar sementes no mercado local → transportar até a roça → plantar → crescer → colher → armazenar, consumir ou vender a produção**. A roça é propriedade da comunidade; moradores executam o trabalho. Assim, a compra de sementes sai de uma conta comunitária identificada e a produção entra primeiro na carga do trabalhador ou no estoque comunitário conforme a entrega efetivamente feita.

O mercado vende lotes finitos de sementes. O estoque de abertura tem origem explícita e é concedido uma única vez; depois, só aumenta com uma entrada registrada de sementes recuperadas da produção ou de uma compra/entrega de outro vendedor. Esgotar sementes ou caixa deve deixar a roça sem plantio, com a causa visível. Não haverá reposição automática.

O plantio consome a quantidade comprada e registra qual lote foi usado em qual campo. A colheita consome biomassa cultivada real, respeita capacidade de carga e reserva de replantio, e só então pode alimentar moradores, estoque comum ou mercado. O valor acumulado de colheita continua sendo histórico e nunca vira inventário vendável por si só.

Usar a ecologia de cultivo que já existe, com sua capacidade de campo, regrowth e reservas de raiz. Não adicionar biomas, calendário agrícola nem variação ecológica sazonal; as estações seguem como troca visual de tiles. A disponibilidade de sementes no mercado e a decisão da comunidade de investir nelas criam a escolha econômica.

## Por que

No código inspecionado, a construção da roça procura biomassa de arbusto de frutos nos próprios tiles do campo. Ao iniciar a construção, retira 8 unidades de frutos silvestres como sementes comunitárias; quando a construção termina, `sowCommunityField` as distribui diretamente no terreno. Não existe compra no mercado nem etapa de plantio como trabalho posterior.

A auditoria de 365 dias, seed 42, no commit `49f37ea7eb8e75d2982d997b928c90fb619adad`, encontrou duas roças incompletas no dia 365: progresso 32/34 e 19/34. Ambas tinham 8 unidades de sementes atribuídas, mas zero biomassa cultivada semeada, zero em pé e zero colhida. Isso identifica um gargalo adicional de construção nessa amostra; não demonstra que a compra de sementes sozinha o resolveria. A nova cadeia deve medir construção e atividade agrícola como etapas separadas.

Esse ciclo torna a roça parte da economia e explica a origem de cada alimento. Ele também integra JUL-201: peões podem vender excedentes realmente colhidos e usar ouro para comprar comida ou insumos disponíveis. A morte por fome continua possível quando a comunidade não investe, o mercado não tem estoque/caixa, o agente não trabalha ou a logística falha.

## Contrato de implementação

- A roça concluída pode permanecer em pousio enquanto não tiver semente comprada; construção não consome frutos silvestres como insumo oculto.
- Uma compra reduz exatamente o ouro da conta compradora e o estoque do mercado, e aumenta o inventário de sementes da comunidade pelo mesmo lote.
- Entrega e plantio movem sementes entre contas sem duplicar unidades. Lote, comprador, vendedor, preço, transporte, campo e data ficam auditáveis.
- A plantação usa os tiles válidos da roça e o modelo de regrowth existente; perda de semente, se houver, é uma saída explícita.
- A colheita reduz biomassa cultivada e gera carga/inventário segundo capacidade. Entregar, consumir, armazenar ou vender é uma transação posterior e identificável.
- A produção retém uma quantidade definida para o próximo plantio antes de oferecer excedente à venda. O estoque de sementes reservado não pode ser vendido por uma ação comum de mercado.
- Sem dinheiro, semente, rota, terreno plantável ou trabalhador, a interface e os relatórios mostram qual etapa bloqueou o fluxo. A rede pode decidir não plantar ou não colher.
- Os saldos de ouro, sementes, biomassa, carga e alimento são conservativos; não podem ficar negativos nem aparecer por reposição automática.

## Alternativas consideradas

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Continuar retirando sementes de frutos silvestres no local | Rejeitada como ciclo principal | Não cria compra, preço, escolha de investimento ou estoque agrícola rastreável; ainda exige abundância natural junto ao terreno. |
| Plantar automaticamente ao construir a roça | Rejeitada | Esconde o trabalho e a decisão econômica e mistura construção com produção. |
| Criar sementes ou dinheiro quando o estoque acaba | Rejeitada | Mascara escassez e rompe a conservação. |
| Fazer a roça comunitária comprar sementes e moradores trabalharem nela | Escolhida | Mantém a propriedade coerente com o `communityId` da estrutura e abre espaço para trabalho, mercado, comida e excedentes. |
| Dar terra e colheita privadas a cada morador | Adiada | Exigiria um novo sistema de propriedade fundiária e divisão da colheita, fora da correção atual de acesso/comércio. |

Preço, tamanho do lote, caixa/estoque inicial e fração de sementes retida ainda precisam de calibração. Escolhê-los por replays e conservação, não por números presumidos. A configuração inicial precisa ser finita e declarada; as sementes futuras precisam vir de produção contabilizada.

## Evidência e limites

- Código: `src/simulation/settlements/construction.js` seleciona campo com biomassa de frutos e coleta sementes ao começar a construção; `src/simulation/ecology/plants.js` move `cropSeedStored` para biomassa cultivada ao concluir; `src/simulation/individuals/actions.js` colhe biomassa e registra `cropHarvested`.
- Replay: `docs/verification/JUL-178-food-fields-seed42-365-20261027.json`, source revision `49f37ea7eb8e75d2982d997b928c90fb619adad`, estado `bc6c30241495ade900999eb9e27d9a7c0cf18e30cccb485384c6a884d3a1793a`, crônica `972d8b364b3ae14f60bd87479d2f54534550bf10273f67d00a87e43fd387d9e5`.
- Revalidação/replay repetido: `docs/verification/JUL-178-market-diagnostics-optin-seed42-365-repeat-20261027.json`, código `1a4f264d12963c4b48d62b2bbd8ee92120eb6942`, estado idêntico `a1c076a1744132e617daaa4be87626850974296958a03c0d213487f1564707b4`, crônica idêntica `972d8b364b3ae14f60bd87479d2f54534550bf10273f67d00a87e43fd387d9e5`. Nesse replay as duas roças ainda estavam incompletas (32/34 e 19/34), com 8 sementes cada e nenhuma biomassa plantada ou colhida. Das 68 operações de mercado, apenas uma foi uma troca civil iniciada por moradora; as outras 67 foram refeições militares automáticas. A instrumentação encontrou 17.252 verificações com estação fora de alcance e 2.082 sem oferta, reforçando que a próxima etapa precisa tornar o acesso, o plantio e a venda observáveis sem assumir que a oferta agregada é comprável.
- Matriz anual em quatro seeds: `docs/verification/JUL-178-food-diagnostics-optin-365-multiseed-20261027.json`, repetição 42 determinística no código/documentação `a205a414c975596f134abc24f39cab8aaf1868cb`. Em seeds 1/42/987/2026, completaram 2/0/2/1 roças e a colheita acumulada foi 6.660,06/0/8.811,65/3.711,63; seed 42 ainda terminou com 16 unidades de sementes armazenadas e nenhum plantio. O mercado fez 302 transações nessas quatro seeds, das quais 301 foram refeições automáticas de soldados e uma foi troca civil; nenhuma vendeu colheita. Em três seeds há biomassa em pé ao final e estoque comunitário de comida 0 ou quase 0. Isso confirma que o HUD/relatórios precisam separar alimento potencial no campo de saldo guardado/acessível e que a cadeia de trabalho é variável por seed. O replay não prova que comprar sementes, por si só, resolva escassez ou construção tardia.
- O replay é uma seed, não uma taxa de sucesso geral. Replays multissemente continuam necessários após a implementação; esta proposta não afirma que a compra de sementes corrigirá por si só a fome ou a construção incompleta.
- SciSpace já havia sido consultado para a decisão econômica: Cockburn et al. (2013), [Simulating Social and Economic Specialization in Small-Scale Agricultural Societies](https://doi.org/10.18564/jasss.2308), relaciona tarefas a necessidades e trocas no caso estudado; não define preços nem calibra esta mecânica. Consensus continua indisponível até a cota mensal reiniciar em 01/11/2026.
