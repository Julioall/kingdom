# JUL-165 — ecologia mínima e estações visuais

## Decisão

Manter no simulador somente os fluxos que têm consumidores de gameplay demonstráveis: biomassa finita e regeneração para coleta/cultivo/alimentação de animais; água no solo e em superfície para consumo humano e disponibilidade; e o balanço básico do rebanho. O calendário continua determinando a estação mostrada pela interface e a paleta dos tiles. A estação não deve modificar temperatura, chuva, água, crescimento vegetal, reprodução ou sobrevivência.

Preservar variação espacial por altitude/solo e chuva local não sazonal, bem como choques explicitamente controlados de oferta usados em testes. Isso mantém fontes finitas, acesso e escassez observáveis sem criar biomas nem um sistema ecológico sazonal. Não remover ainda o balanço hídrico nem a regeneração de recursos: alimento, água e ração consomem esses estados diretamente.

## Dependências encontradas no código vigente

* `systems.js` executa clima, água do solo/superfície, plantas, animais, pessoas e fronteiras em cada passo. `individuals/actions.js`/`perception.js` usam biomassa colhível, terreno, água conhecida e água superficial para decidir coleta, sede, caça e movimento.
* `ecology/climate.js` usa `seasonIndex(day)` para escolher temperaturas médias `[19, 25, 21, 15]` e multiplicadores de chuva `[1.14, .72, .84, 1.26]`. Esses valores alteram umidade, chuva, evaporação, adequação vegetal e, por consequência, recursos e decisões. O mesmo módulo também fornece `calendarDate`/`seasonIndex` à UI; esse calendário é apresentação e permanece.
* `ecology/plants.js` multiplica a regeneração a cada sete dias por `seasonalGrowth`; `config/ecosystem.js` define fatores sazonais para raízes cultivadas e brotos de ovelha. `spreadWildPlants` também lê temperatura e umidade do tile.
* `ecology/hydrology.js` transforma precipitação, infiltração, capacidade do solo, cobertura vegetal e consumo em água acessível. Água é consumida por agentes; manter estoque finito e escoamento é necessário à sobrevivência.
* `ecology/animals.js` consome alimento e ração e afeta economia e sobrevivência do rebanho. A lógica usa recursos e necessidades, sem precisar de estação como calendário de reprodução.
* `ui/game.js` troca atlas/paleta de terreno e aparência de árvores conforme a estação e apresenta o calendário ao jogador. Esta é a representação sazonal aprovada.

## Alternativas

1. **Manter a sazonalidade ecológica existente:** rejeitada porque a diretriz de JUL-195 limita estação a apresentação e a variação de oferta torna a mortalidade e a economia dependentes de um sistema fora de escopo.
2. **Remover toda a ecologia dinâmica:** rejeitada porque coleta, cultivo, água, escassez, reservas e ração usam estoques e fluxos ecológicos reais.
3. **Remover somente o acoplamento ao calendário:** escolhida. Temperatura média e probabilidade/magnitude de chuva passam a ser independentes de estação; regeneração vegetal usa uma taxa constante por intervalo. Manter estoques finitos, água espacial, chuva não sazonal, regeneração condicionada a capacidade/uso e os choques controlados de validação.

## Evidência e fontes

* O repositório no SHA de código `7c67efe794cb5aae1b7be5d132f737b77fe806a0` confirma os acoplamentos acima. O replay anual antes da simplificação está em execução nesse SHA para formar comparação reproduzível; o resultado ainda não é evidência de pós-mudança.
* SciSpace encontrou Guerrin, [Agent-Based Modelling of a Simple Synthetic Rangeland Ecosystem](https://doi.org/10.1007/978-3-030-37421-1_10) (2020). O resumo descreve agentes herbívoros que se movem e consomem vegetação que cresce em parcelas, e avaliação por biomassa/população/mortalidade ao longo de vários anos. Isso apoia modelar somente estoques, crescimento e consumo necessários à hipótese testada; não prova que o balanço proposto para Kingdom é suficiente nem calibra parâmetros.
* A pesquisa também retornou modelos eco-hidrológicos mais completos, com clima, temperatura, solo, água, competição e diversas espécies. Não são adotados porque respondem a perguntas de ecologia/resiliência fora do objetivo de gameplay do Kingdom.
* Consensus está sem cota até 01/11/2026; o conector MCP Game Studio continua indisponível nesta sessão. A decisão prioriza a restrição explícita de JUL-195 e será confrontada com testes unitários, choque de oferta e replays econômicos multissemente. A alteração é reversível e não muda assets, UI, biomas ou observações da rede.

## Validação planejada

Antes da simplificação: guardar seed, estado/crônica, mortes, adulto-dias sob reserva baixa, estoques, produção e throughput em replays atuais. Depois: provar que `calendarDate` e a apresentação sazonal seguem intactos, que clima/regeneração não têm variação por estação com estado/RNG pareado, que stocks/transferências permanecem finitos, e que replays sob disponibilidade normal e choque controlado não têm saldo negativo ou regressão sem causa. Seed 42/253 dias é critério separado; mortalidade zero não será assumida para todos os horizontes.

JUL-165 permanece aberta até a comparação de baseline/pós-mudança e a validação de gameplay estarem versionadas.
