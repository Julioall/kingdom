# JUL-178 — Unidades de alimento em pessoa-dias

Data: 27/10/2026

## Decisão

Uma unidade de comida vegetal representa **um pessoa-dia**: alimento suficiente para uma pessoa por um dia. O consumo diário é 1 para adultos, dependentes e soldados, em paz ou campanha. `foodReserve` passa a ser lido diretamente como dias restantes; por exemplo, 30 significa 30 dias e o teto atual de 100 significa 100 dias. Uma unidade física de carne rende 10 pessoa-dias, como um produto concentrado separado; o estoque e o transporte continuam registrados em unidades físicas.

Carne continua como item de estoque separado para manejo, transporte e venda. Sementes, ração animal e biomassa em pé continuam em suas próprias unidades. O potencial da roça é uma estimativa de colheita futura; a comida só entra no estoque quando colhida e entregue. O registro de frutos/carne em abrigo continua sendo subregistro/localização do estoque compartilhado, nunca um saldo adicional.

No mercado, quantidade de comida e preço passam a ser lidos em dias de alimento; o preço atual em ouro por unidade permanece, portanto passa a ser ouro por pessoa-dia. O ciclo de sementes, o rendimento físico da roça e o limite de carga não mudam nesta decisão.

## Por que essa escala

No código anterior, 1 unidade de comida adicionava 0,72 ponto à reserva. Adultos gastavam 0,78 ponto/dia (1,083 unidade física/dia), dependentes 0,42 (0,583 unidade/dia) e soldados em paz 0,351 (0,488 unidade/dia). Assim, 1.000 unidades não podiam ser interpretadas diretamente como 1.000 dias de alimentação. Agora, o estoque, a reserva pessoal, os buffers civis e as rações militares compartilham a mesma conta pessoa-dia.

Para 50 pessoas por 180 dias, o alvo passa a ser 9.000 unidades. Um lote de 10.000 unidades integralmente colhido equivale a 200 dias para 50 pessoas, antes das sementes retidas e de qualquer perda logística. O rendimento da roça segue limitado pela quantidade de sementes e pela área plantada; não foi fixado em 10.000.

O baseline repetido de 253 dias, seed 42, no SHA `bf9ad54ab371ec972a15de442955e623ffb9e92c` teve hash de estado `b357ddd9e9b11b31852e54ab24cf9e39ffe5c6d447455260bb70277b6475b28a` nas duas execuções, sem mortes humanas por fome. A demanda diária estimada ao fim era 48,75 e 47,08 unidades para populações de 51 e 49, respectivamente. Com a unidade normalizada, as mesmas populações requerem 51 e 49 pessoa-dias/dia. Isso é um aumento de 2,25 e 1,92 unidades na métrica de demanda usada pelo buffer; o replay após a mudança verificará impacto na produção, reservas e campanhas. Evidência baseline: `docs/verification/JUL-178-food-unit-baseline-253-seed42-20261027.json`.

## Alternativas avaliadas

- **Manter “pontos” e só renomear a interface:** preservaria as fórmulas, mas 1.000 unidades continuariam sem significar 1.000 dias; não atende à escala solicitada.
- **Manter descontos de crianças e soldados:** exigiria exceções para estimar reservas, mercado e rações. A regra comum de 1 pessoa-dia elimina essas conversões sem dar comida gratuita; cada pessoa continua podendo ficar sem acesso e morrer de fome.
- **Manter 2,5 pessoa-dias por unidade de carne:** rejeitado na revisão de 27/10/2026 por subestimar o rendimento do abate adulto no jogo.
- **Usar 5 pessoa-dias por unidade:** alternativa inteira e mais conservadora; deixaria o abate potencial de 33 ovelhas adultas padrão em cerca de 76 dias para 50 pessoas, menos de metade do buffer alvo de 180 dias.
- **Usar 10 pessoa-dias por unidade:** escolhido. Para a massa média adulta e a fração de carcaça já implementadas, o abate potencial de 33 ovelhas equivale a cerca de 152 dias para 50 pessoas, ainda abaixo de um buffer de 180 dias e de um lote de roça de 10.000 unidades. É uma reserva forte para escassez, mantendo alimento vegetal como fonte regular.

## Reavaliação puxada pelo replay

O primeiro replay pós-normalização, em 253 dias e seeds 1/42/987/2026 no SHA `79516a9cf88d2b3f32eac12c4edace5244c6581c`, não foi aprovado: houve 1, 2 e 7 mortes humanas por fome nas seeds 42, 987 e 2026. Na seed 1, Valedouro terminou sem estoque, com média de 4,06 dias de reserva pessoal; sua roça tinha 9.945,75 unidades maduras em pé, mas só 54,25 haviam sido colhidas. Corvânia, com colheita contínua, terminou com 22.414,32 unidades. O relatório reprodutível está em `docs/verification/JUL-178-food-unit-post-253-20261027.json`.

A causa confirmada no código tinha duas travas: o piso de 14 dias tornava moradores famintos inelegíveis para tarefas urgentes, e a ação só depositava diretamente a colheita madura no estoque comunitário quando a reserva pessoal passava de 35 dias. Ambas foram removidas apenas do caminho de colheita comunal urgente/designada. Saúde, energia, água, acessibilidade do campo e a reserva civil protegida de campanhas continuam verificadas. Testes cobrem a atribuição com reserva zero e a entrega real de uma roça madura ao estoque comum. A aprovação depende do novo replay das mesmas seeds.

A nova matriz de 253 dias no SHA `1a2a8d6ff8b7c96afa08ae8486c70d1a61cea310` repetiu a seed 42 de forma determinística. A seed 1 recuperou a roça de Valedouro: colheu 20.015,8, entregou 19.794,41 ao estoque e terminou com 14.708,05 unidades; a outra roça colheu 27.660,1 e entregou 27.286,67. O pior mínimo de reserva combinada entre os oito reinos-seed foi 25,47 dias, sem morte humana por fome na seed 1. Na seed 42 houve uma morte humana por fome, ainda a classificar entre civil e militar; as mortes por fome nas seeds 987 e 2026 foram de animais selvagens. Os estoques finais por comunidade ficaram entre 4.662,36 e 36.307,62 unidades. Relatório: `docs/verification/JUL-178-food-unit-final-253-20261027.json`.

A matriz de 365 dias no mesmo SHA manteve a produção das duas comunidades, com estoques finais de 10.374,79 a 31.039,85 unidades e mínimos combinados de 25,47 a 76,2 dias. A seed 42 e sua repetição tiveram o mesmo hash (`0426ad4235a78e73ba8359a285789af4468bb309e3bd0df3700b70d5299fb056`). Nessa seed ocorreram duas mortes humanas por fome; a inspeção dos registros confirmou que ambas eram soldados, uma durante a campanha 246. Não houve morte civil por fome na matriz. A seed 2026 teve 22 mortes de animais selvagens por fome; rebanhos domesticados não tiveram mortes por fome. Valedouro passou 41 dias abaixo de 300 unidades na seed 1 e 10 dias na seed 42, mas terminou acima desse nível; Corvânia não caiu abaixo de 300. Portanto, o estoque recupera e termina com folga, mas ainda há quedas temporárias e risco de ração em campanhas prolongadas. Relatório: `docs/verification/JUL-178-food-unit-final-365-20261027.json`.

A matriz de 730 dias também concluiu no mesmo SHA. Os estoques comunitários finais variaram de 10.260 a 18.254,8 unidades, e o menor mínimo de reserva combinada foi 25,47 dias. Todas as oito combinações de reino/seed recuperaram acima de 300 unidades e nenhuma ficou abaixo de 14 dias de reserva combinada. A seed 42 repetiu com os mesmos hashes de estado (`27d8a8e4b03aa94761851da6ea95b68df2b9e365750437ab54828ba1a4809acf`) e crônica (`5e361ac9adc2aea76d38a95ce9c9da55d87e351774f403c26afc0e16c7de2c82`). A seed 42 teve duas mortes humanas por fome (as mesmas duas já identificadas no replay de 365 dias como soldados), sem mortes civis por fome; seeds 1, 987 e 2026 não tiveram fome humana. O ledger conciliou as oito frentes de campanha em cada seed, com zero lados sem ledger, zero saldos não conciliados e zero divergências de origem da reposição. Fauna selvagem continuou sujeita à fome; os rebanhos domesticados não tiveram mortes por fome. Relatório: `docs/verification/JUL-178-food-unit-final-730-20261027.json`.

## Pesquisa e orientação de jogo

- O SciSpace localizou Giedelmann-L, Guerrero e Solano-Charris, *System dynamics approach for food inventory policy assessment in a humanitarian supply chain* (2022), [DOI 10.1016/j.ijdrr.2022.103286](https://doi.org/10.1016/j.ijdrr.2022.103286). O estudo compara políticas centralizadas e descentralizadas de estoque, considerando falta, excesso e distribuição de perecíveis. Ele apoia acompanhar estoque e acesso por localização; não prescreve pessoa-dia como unidade de gameplay.
- O Consensus foi consultado, mas recusou nova busca porque o limite mensal de 30 consultas só reinicia em 1/11/2026. Essa indisponibilidade não bloqueia a mudança; a decisão se apoia na aritmética do código e nos replays determinísticos do projeto.
- O Game Studio está disponível nesta sessão como skill de fluxo, sem uma ferramenta de design separada. A revisão de interface seguirá `game-playtest`: conferir o jogo no navegador, rótulos do HUD/inspeção e captura de tela.

## Validação

Suite completa: **284/284**. A matriz direcionada de estresse passou **67/67**, cobrindo falta de comida, mercado vazio/oferta incompleta, fronteira/rota bloqueada, carga cheia, ausência de trabalhador/seed e guerra sem ração; os nomes e limites de cada cenário estão em `docs/verification/JUL-178-food-stress-matrix-20261027.md`. `npm run build` também passou no SHA de código `1a2a8d6ff8b7c96afa08ae8486c70d1a61cea310`. Esses replays e resultados são do contrato anterior, com carne a 2,5 dias/unidade, e não validam o ajuste atual. A matriz de estresse usa fixtures unitárias/de integração, não replays longos de mundo inteiro sob cada choque. Ainda falta demonstrar transporte físico da colheita e acesso individual quando o estoque comunitário é alto; a auditoria JUL-178 não deve ser concluída enquanto esses pontos permanecerem sem evidência. Não há salvamento persistente do mundo para migrar; as únicas referências a `localStorage` neste checkout são preferências de IA e áudio.

## Revisão de valor da carne — 27/10/2026

A necessidade permanece simples: **1 unidade de comida por pessoa por dia** para adultos, dependentes e soldados. A carne é item físico próprio, e sua conversão de gameplay passa a ser `MEAT_NUTRITIONAL_VALUE = 10` pessoa-dias por unidade. O rei, o mercado, os abrigos, os totais comunitários, a distribuição e o consumo usam esse mesmo fator.

### Custo e escala no código

- `attemptHumanHunt` produz `clamp(massKg × 0,48, 1,2, 28)` unidades de carne e só permite abater ovelha adulta em emergência, preservando duas adultas para reprodução.
- Uma ovelha de massa adulta média (48 kg no modelo) rende 23,04 unidades físicas; com o fator 10, são **230,4 pessoa-dias**, ou **4,6 dias para 50 moradores**. Uma ovelha de 67 kg atinge o limite de 28 unidades, equivalendo a 280 pessoa-dias.
- Um curral comporta 35 animais; preservando duas reprodutoras, o limite teórico de 33 ovelhas adultas médias rende 7.603,2 pessoa-dias, cerca de **152 dias para 50 pessoas**. É um teto de abate, não uma produção contínua: elimina quase todo o plantel disponível.
- O cordeiro cresce até a idade adulta em 180 dias e consome até 0,12 de ração por dia no modelo: **21,6 unidades de ração por cordeiro** até a maturidade, além da manutenção diária dos reprodutores. Um curral lotado consome 4,2 de ração por dia. Ração e comida têm unidades próprias e não se supõe que sejam nutricionalmente equivalentes.
- Como referência observável, um lote de 10.000 unidades de roça representa 200 dias para 50 pessoas. O teto do curral com fator 10 fica em 76% desse lote; com fator 5 ficaria em 38%. Assim, 10 dá relevância ao rebanho em escassez sem superar sozinho o lote de referência da roça.

O fator 10 é uma regra de balanceamento do jogo, não uma conversão nutricional científica. SciSpace encontrou Corazzin et al., *Carcass Characteristics and Meat Quality of Sheep and Goat* (2019, [DOI 10.1007/978-3-030-05484-7_6](https://doi.org/10.1007/978-3-030-05484-7_6)); o resumo apresenta rendimento de carcaça de aproximadamente 40–60%, compatível com os 48% usados pelo código, mas não define pessoa-dias por unidade. Também encontrou Sultana et al., *Effects of age on intake, growth, nutrient utilization and carcass characteristics of castrated native sheep* (2011, [DOI 10.3329/BVET.V27I2.7556](https://doi.org/10.3329/BVET.V27I2.7556)): nesse manejo experimental, a conversão alimentar piora com a idade, enquanto rendimento de carcaça aumenta; isso apoia limitar a comparação ao abate maduro e não envelhecer ovelhas indefinidamente, mas os valores físicos não são mapeáveis diretamente às unidades abstratas de ração do jogo.

SciSpace informa o que os resumos dos estudos cobrem, não valida o balanceamento de Kingdom. O Consensus foi consultado e recusou a busca por limite mensal de 30 pesquisas, com reinício em 1/11/2026. A skill Game Studio foi aplicada como orientação de manter a regra determinística na simulação/configuração, refletir a equivalência claramente na interface e validar o loop no jogo.

A validação do fator 10 será registrada no SHA de integração; os replays históricos de 253/365/730 dias acima foram executados com fator 2,5 e não validam esta revisão. JUL-178 continua sem aceite final até repetir os cenários alimentares no valor atual e fechar os critérios restantes da auditoria.
