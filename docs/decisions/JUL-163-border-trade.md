# JUL-163 — escambo e fronteira fechada

Data: 26/10/2026
SHA de implementação: `d6d052f1f02aae9832fe103d28ce31dabd5e08ad`
Issue relacionada: [JUL-163](https://linear.app/julio-alves/issue/JUL-163/m4-disputas-territoriais-logistica-e-guerra-com-consequencias)
Cobertura alimentar associada: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-cultivo-caca-civis)

## Pergunta e observação do código

O que significa uma fronteira fechada para o escambo de comunidades? `trade.js` escolhe um parceiro comunitário por contato visível, excedente complementar e confiança. A relação entre reinos já registra `status: 'at-war'`, mas não havia política explícita de fechamento comercial. As verificações de saldo e o ledger transacional permanecem a cargo dos helpers de inventário e `trade-ledger.js`.

## Evidência consultada e limites

* SciSpace encontrou Chang e Wu, [Insecure Resources, Bilateral Trade, and Endogenous Predation](https://doi.org/10.1002/SOEJ.12430) (Southern Economic Journal, 2020). O resumo analisa condições em que países adversários ainda comerciam e como abertura comercial pode alterar os incentivos de armamento. Isso é evidência contra presumir que guerra equivale a embargo; não prescreve regras para um simulador de aldeias nem fornece limiar adequado ao Kingdom.
* A busca atual no SciSpace não confirmou a referência que havia sido descrita como “A resource based game theoretical model for military conflicts” (2007), então ela foi removida. SciSpace identificou Sheeba e Ghose, [Optimal resource allocation and redistribution strategy in military conflicts with Lanchester square law attrition](https://doi.org/10.1002/NAV.20303) (Naval Research Logistics, 2008). O trabalho é sobre alocação de forças defensoras, não sobre comércio ou fronteiras do Kingdom; não sustenta a regra de escambo desta decisão.
* Consensus foi tentado nesta execução e recusou a busca: cota mensal de 30 pesquisas esgotada, com reset em 01/11/2026. Isso confirma a limitação já registrada na meta; não bloqueia a alteração.
* Game Studio e a arquitetura existente favorecem mudanças determinísticas na simulação, separadas do Canvas/Worker de renderização. A confirmação de produto virá dos testes de estado e do replay, não da literatura.

## Alternativas e decisão

| Alternativa | Vantagem | Limite | Decisão |
| --- | --- | --- | --- |
| Tratar todo estado `at-war` como embargo | Implementação simples | Confunde guerra com política comercial e descarta comércio bilateral possível | Rejeitada |
| Não modelar fechamento de fronteira | Nenhum campo novo | Não permite reproduzir o cenário “fronteira fechada” pedido pela auditoria JUL-178 | Rejeitada |
| Consultar `kingdomRelations[low:high].borderClosed` para escambo direto | Torna a restrição explícita; preserva guerra e comércio como decisões separadas; revalida no ponto de execução mesmo com parceiro obsoleto | Não fecha rotas físicas nem o mercado compartilhado; apenas bloqueia a troca direta entre comunidades | Escolhida para esta fatia |

O campo opcional `borderClosed: true` bloqueia descoberta e execução de escambo comunitário entre reinos diferentes. Guerra sozinha não fecha a fronteira. Mercados locais, transferências internas e navegação de pessoas ficam fora desta política e precisam de contratos próprios se passarem a depender de fronteiras. No estado atual do código, nenhuma política da IA escreve esse campo: este incremento implementa e testa a consequência de um fechamento explícito fornecido ao estado, não uma decisão autônoma de fechar/abrir a fronteira. Essa decisão de agente ainda precisa de contrato e replay em JUL-163.

## Validação

`tests/war-trade.test.mjs` cobre paz com comércio aberto, fechamento explícito impedindo descoberta e execução de parceiro obsoleto sem mutação de estoques, e guerra com fronteira aberta permitindo escambo. `node --test tests/war-trade.test.mjs tests/economy-conservation.test.mjs`: 12/12; `git diff --check`: aprovado. Os resultados headless demonstram a regra de troca; um replay de longo prazo ainda precisa demonstrar impacto econômico e continua pendente em JUL-163/JUL-178.
