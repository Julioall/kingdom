# JUL-180 — resposta local a ameaça durante construção

Data: 26/10/2026  
Base auditada: `fb0af4e7f8bc07d3dbf5a1c0b9ea36bcb4102164`  
Fixture de auditoria: `b46eef9638872cd2395469d589765fde36122716`

## Observação do jogo

`tests/construction-threat-audit.test.mjs` aproxima um soldado inimigo em campanha a quatro tiles de uma torre inacabada. `advanceKingdomProjects` suspende o progresso e o retoma no mesmo canteiro quando o inimigo sai, mas o trabalhador permanece exposto no posto. A evidência delimita a lacuna: pausa de progresso já existe; evacuação, proteção e persistência do vínculo com a obra não foram demonstradas.

## Decisão

Manter a simulação determinística local e tratar ameaça como uma interrupção temporária da tarefa. A resposta planejada é avaliar ameaça e rota com observações disponíveis ao trabalhador, escolher fuga/abrigo alcançável, liberar o slot ao sair, preservar projeto e progresso pagos e tentar retornar após uma janela segura com histerese. Não mover regra de domínio para o Canvas nem inserir inferência remota no passo diário.

## Alternativas

| Alternativa | Vantagem | Limite | Decisão |
| --- | --- | --- | --- |
| Só bloquear o progresso durante cerco | É simples e já conserva a obra | Deixa o trabalhador no alcance da ameaça | Insuficiente; manter apenas como guarda adicional |
| Evacuação determinística por risco local, com retorno e cooldown | Reproduzível, barata e compatível com Worker e replay | Distâncias/limiares ainda precisam de cenário de referência | Escolhida para protótipo após baseline |
| Treinar RL/usar LLM para escolher a reação | Pode explorar políticas mais variadas | Sem corpus, latência e validação suficientes; mistura seleção de alto nível com resposta urgente | Não adotar nesta fatia |

## Evidência consultada e limites

* SciSpace encontrou [A Benchmark for StarCraft Intelligent Agents](https://doi.org/10.1609/aiide.v11i2.12810), de Alberto Uriarte e Santiago Ontañón (AIIDE 2015). O resumo propõe cenários e métricas comuns para comparar agentes RTS. Uso isso para exigir fixtures repetíveis e comparação de resultados; não fornece um limiar de fuga específico para Kingdom.
* SciSpace encontrou [Meta-Level Behavior Adaptation in Real-Time Strategy Games](https://www.cc.gatech.edu/faculty/ashwin/papers/er-10-02.pdf), de Manish Mehta, Santiago Ontañón e Ashwin Ram (2010). O resumo descreve revisão de comportamento a partir da execução. A aplicação aqui é manter histórico do incidente e permitir reavaliação; o texto consultado não valida nossos custos nem a regra de segurança.
* SciSpace também encontrou STRATA, [Self-Learning Through Role-Aligned Tiered Agents for Real-Time Strategy Games](https://arxiv.org/abs/2609.38881) (2026, preprint). A hierarquia estratégico/logístico/tático é compatível com a divisão já existente; o resultado de vitória relatado usa um cenário fixo, portanto não é evidência suficiente para escolher parâmetros ou introduzir aprendizagem nesta resposta urgente.
* A busca Consensus não estava disponível: a cota mensal previamente reportada só reinicia em 01/11/2026. O resultado foi registrado como limitação, sem bloquear o trabalho.
* O skill Game Studio orienta preservar Vite/Canvas/DOM/Worker, manter simulação separada de renderização e reproduzir ameaça no browser quando a política alterar movimento visível.

## Benchmark antes de ajustar limiares

Fixtures determinísticas devem incluir: ameaça aproximando e recuando; fuga com obstáculo/parede e abrigo alcançável; rota sem saída; morte do trabalhador e substituto; cerco/destruição do projeto; ameaça aparecendo durante martelada; slot disputado; reentrada após a ameaça sair. Comparar comportamento atual de bloqueio com política de evacuação usando: tempo exposto ao alcance, dias sem progresso, custo de materiais, progresso preservado, dia de retomada, obras travadas e trocas fuga/retorno por incidente. Usar o mesmo estado inicial e replay pareado; a captura de browser valida legibilidade do movimento, enquanto as asserções headless validam custo e estado.

Os valores de alcance, cooldown e janela segura ficam sem ajuste até os cenários e métricas serem versionados e medidos. A pesquisa orienta o método de avaliação; o comportamento do jogo é a evidência de aceite.
