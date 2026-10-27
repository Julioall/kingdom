# JUL-198 — capacidade dos currais

## Decisão

Cada curral ativo tem capacidade explícita de 35 ovelhas. Captura, compra e nascimento reservam a vaga do curral escolhido. O sistema preserva vínculos válidos já gravados, distribui rebanhos antigos sem vínculo pelo curral com vaga mais próximo e deixa excedentes fora dos currais, sem aumentar a capacidade de nenhum deles.

Quando todos os currais ativos estiverem cheios, a IA comunitária pode propor outro curral. Essa expansão continua sujeita a madeira, pedra, intervalo entre obras e validação do local. A exceção ao limite geral de construções só libera uma obra de curral quando a capacidade pecuária existente foi preenchida; não concede materiais.

A escolha do local reutiliza as regras existentes: território do reino, terreno navegável, inclinação e água, pegada plana, espaço contra outras construções, obstáculos e recursos, distância da comunidade e acesso dos trabalhadores aos pontos de trabalho. A obra só reserva materiais depois de encontrar um local válido. Sem local válido, não há estrutura parcial, gasto ou tarefa de trabalhador presa.

O painel de cada curral mostra sua própria lotação `ovelhas / 35`. A ração continua no estoque compartilhado da comunidade; exibi-la em cada curral é identificada como reserva compartilhada.

## Alternativas consideradas

- **Limite único por comunidade:** rejeitado porque não representava a lotação de cada curral e impedia o segundo curral de resolver a necessidade.
- **Capacidade derivada do raio visual:** rejeitada; o raio de renderização não é uma regra legível de gameplay e produzia um limite próximo de cinco.
- **Deixar toda a IA de captura no máximo de quatro ovelhas:** rejeitado; bloqueava a expansão antes de ocupar o primeiro curral.
- **Permitir captura sem vaga e associar depois:** rejeitado para novas capturas; quando não existe vaga, a ovelha continua selvagem até uma nova estrutura ficar disponível. Animais domésticos já existentes ou nascidos durante uma expansão podem ficar fora temporariamente, sem ocupar uma vaga fictícia.
- **Adicionar uma ecologia ou um limite global de ovelhas nesta issue:** rejeitado; o teto separado de ovelhas selvagens pertence à dependência JUL-199. Esta mudança não introduz biomas nem sazonalidade.

## Evidência e validação

- JUL-198 define 35 por curral e exige cenários de 34/35/36, dois currais, rejeição de terreno inválido e conservação de materiais.
- O código anterior derivava a lotação de `(raio do curral × 1,6)` e a governança parava novas capturas em quatro animais. A IA também contava todo o rebanho como se estivesse no primeiro curral.
- Testes desta issue cobrem 34/35/36, transbordo lógico para segundo curral, reserva de vaga durante condução, compra/captura com capacidade, nascimentos no segundo curral, nova construção ao atingir a capacidade, ausência de gasto em território inválido e conclusão de curral em local válido.
- Playtest do navegador, com a simulação pausada, confirmou o painel do curral com `Ovelhas neste curral · 2 / 35`, ração compartilhada e consumo diário; a construção completa é validada na simulação automatizada. A captura visual foi exibida nesta sessão, mas a ferramenta de navegador não oferece um caminho de arquivo para anexá-la ao Linear.
- Validação local final: testes direcionados `node --test tests/corral-capacity.test.mjs tests/livestock-food.test.mjs` passaram 16/16; suíte completa `npm test` passou 213/213; `npm run typecheck`, `npm run build` e `git diff --check` passaram.
- A `main` remota foi buscada antes da implementação; ela já era ancestral da branch de trabalho, que estava 129 commits à frente. Nenhum commit ou alteração local foi descartado.

## Fontes e limites

- **Game Studio — `game-playtest`**: aplicado para conferir a tela jogável, o painel de construção e a legibilidade do novo dado.
- **SciSpace**, consulta “How do livestock simulation models represent enclosure-specific capacity, animal stocking limits, and overflow when multiple pens are available?”: encontrou literatura de dimensionamento de instalações e de simulação como apoio à decisão, incluindo [A Stochastic Model for Planning Swine Facilities](https://doi.org/10.5555/1162708.1163123) e [Modeling and Simulation for Decision Support in Precision Livestock Farming](https://doi.org/10.1109/WSC48552.2020.9383975). Esses trabalhos apoiam testar capacidade e utilização de recursos por cenários; não estabelecem que 35 seja um limite biológico para ovinos. O valor de 35 vem do critério do produto JUL-198.
- **Consensus**: indisponível por limite mensal de pesquisa até 2026-11-01, conforme a tentativa registrada no trabalho anterior. Não usei essa fonte para definir capacidade.
- **Notas de contexto do Linear**: a ferramenta `get_agent_context` respondeu `Tool get_agent_context not found`; segui a issue JUL-198 e confirmei as regras diretamente no código.

## Próximos limites

JUL-199 deve validar que o limite separado de ovelhas selvagens coexiste com as lotações domésticas por curral. JUL-178/JUL-201 continuam responsáveis pelo novo ciclo da roça: compra de sementes no mercado, entrega, plantio, crescimento e colheita.
