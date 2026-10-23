# Reinos Vivos: poder, economia e expansão

## Visão geral

Transformar o Genesis em uma simulação de reinos em disputa, inspirada por histórias de estratégia e unificação como *Kingdom*. O mundo começa com quatro reinos, cada um com um castelo, uma vila e uma população de indivíduos autônomos. Ao longo do tempo, decisões políticas, escassez, comércio, migração e conflitos podem fortalecer, dividir ou derrubar esses reinos.

O objetivo da simulação não é garantir que um reino vença. É deixar que os resultados surjam das condições do mundo e das decisões de seus governantes, moradores e soldados.

## O mundo e seus assentamentos

- Ampliar o mapa para comportar quatro reinos e áreas disputadas. Triplicar largura e altura multiplica por nove o número de células; por isso, a simulação deve atualizar regiões distantes com menor frequência ou carregá-las conforme a atividade.
- Cada reino começa com um castelo e uma vila organizada ao redor dele, incluindo casas, currais e um mercado.
- Cada indivíduo pode buscar ou receber um lote para construir uma casa e, quando tiver condições, um curral. Moradia, alimento, materiais e espaço têm custos e disponibilidade reais.
- Espalhar pelo mapa jazidas de ouro e outros locais de coleta. As jazidas de ouro são pontos estratégicos, capazes de atrair comércio, disputas e campanhas militares.
- As fronteiras e os assentamentos podem mudar: uma comunidade pode crescer, migrar, separar-se ou fundar um novo reino.

## Economia e sobrevivência

- Moradores produzem, coletam, criam animais e negociam recursos no mercado. Preços variam conforme oferta, demanda, estoques e acesso às rotas.
- A arrecadação do rei vem de impostos definidos pelo governo. Parte da receita pode ser guardada para períodos de seca e outras crises; o restante pode financiar o castelo, as obras públicas, as defesas e o exército.
- Impostos altos podem aumentar a reserva do reino, mas também reduzir o bem-estar, a satisfação e a disposição dos moradores para permanecer nele. Impostos baixos aliviam a população, mas limitam os recursos disponíveis ao governo.
- Pessoas que passam fome podem pedir ajuda ao governo. O efeito político depende da resposta: atender ao pedido consome estoques e pode recuperar confiança; ignorá-lo ou não ter recursos pode reduzir o prestígio e aumentar a insatisfação.
- Um reino pode acolher migrantes oferecendo condições ou contratos, como a entrega de uma quantidade de madeira. O migrante decide como cumprir o pedido; pode trabalhar, negociar ou tentar roubar, enfrentando as consequências dentro do mundo simulado.

## Papéis e decisões

### O rei

Uma IA estratégica controla cada rei. Com base em relatórios, pedidos, estoques e informações disponíveis, o rei decide impostos, prioridades de gasto, construções, recrutamento, acolhimento de migrantes, objetivos militares e ordens para o exército. O rei não conhece automaticamente os pensamentos ou a situação exata de cada indivíduo.

### Moradores

Cada indivíduo toma decisões com sua própria rede neural e memória. Pode aceitar ou recusar tarefas, pedir ajuda, negociar, cumprir contratos, migrar para outro reino ou tentar obter recursos por conta própria. A população continua tendo iniciativa, mesmo quando o rei estabelece prioridades para o reino.

### Soldados

O rei pode recrutar moradores para formar arqueiros, lanceiros e outros tipos de tropa. Soldados recebem ordens militares, mas sua capacidade e disposição para cumpri-las dependem de fatores como treinamento, lealdade, abastecimento, distância e risco. O exército precisa de recursos para ser recrutado, equipado e mantido.

## Poder, legitimidade e sucessão

Manter satisfação, prestígio, medo e lealdade militar como indicadores diferentes. Um rei pode governar pelo medo e ainda assim perder apoio; obediência não significa legitimidade.

Se a insatisfação crescer, podem surgir protestos, deserções, conspirações ou uma tentativa de substituir o rei. Um pretendente com carisma pode atrair apoiadores, mas a tomada do poder também depende de recursos, aliados, apoio militar e controle de lugares importantes. Golpes e sucessões devem refletir as tensões já existentes no reino, não ocorrer como eventos sem causa.

O rei pode ordenar a execução de alvos que estejam ao alcance de sua força militar, inclusive cidadãos, rivais, traidores ou outros governantes. A ordem não garante o resultado: o alvo pode estar longe, protegido ou escapar, e os soldados precisam alcançar e cumprir a missão. Cada tentativa tem custos e efeitos que emergem da simulação, como perdas militares, medo, retaliação, deserção, queda de arrecadação ou aumento da insatisfação. Não há um bloqueio moral automático; há consequências causadas pelas escolhas e pelas condições do mundo.

## Guerras e território

Os reinos disputam terras, rotas e jazidas. O rei escolhe onde reforçar defesas e quando mobilizar tropas. Campanhas dependem de distância, abastecimento, tamanho e composição do exército, fortificações e lealdade dos soldados.

Conquistar um território pode ampliar a população e o acesso a recursos, mas também aumenta os custos de defesa e administração. Uma guerra prolongada pode enfraquecer o próprio reino que a iniciou. Os conflitos devem decorrer de objetivos e condições observáveis, como disputa por uma jazida, fronteiras pressionadas ou falta de recursos.

## Migração, separação e novos reinos

Moradores insatisfeitos podem tentar migrar. A saída de indivíduos reduz a população e pode enfraquecer a economia e a arrecadação; a chegada pode beneficiar o reino que os aceitar, desde que consiga sustentá-los.

Um reino grande também pode se dividir. Um líder local com apoio, recursos, seguidores e território viável pode declarar independência. Carisma ajuda a reunir pessoas, mas não basta por si só: a nova comunidade precisa de alimento, trabalho, defesa e acesso a recursos.

Um indivíduo que reúna condições pode fundar um assentamento e construir um castelo. Se o castelo se tornar funcional, o fundador deixa um legado estratégico para o novo reino. O sistema registra uma cópia versionada das lições da fundação — por exemplo, escolha do local, reunião de recursos, organização do trabalho e resposta a problemas. O indivíduo conserva sua própria memória e identidade; o modelo estratégico do reino pode consultar as experiências registradas. Se houver vários fundadores, as estratégias ficam como legados distintos, em vez de misturar diretamente os pesos das redes neurais. O legado pode continuar influenciando o reino após a morte do fundador e deve ser registrado como evento reproduzível da simulação.

## Indicadores para observar

Além dos indicadores ecológicos já existentes, acompanhar por reino:

- população, migração e pedidos de ajuda;
- satisfação, prestígio do rei, medo e lealdade militar;
- estoques, arrecadação, impostos, produção e preços;
- moradias, currais, construções e capacidade de armazenamento;
- composição, custo, localização e abastecimento do exército;
- controle de território, rotas e jazidas;
- conflitos, perdas, deserções, separações e sucessões;
- decisões estratégicas do rei e suas justificativas, com as informações que estavam disponíveis no momento.

## Desenvolvimento por etapas

1. **Assentamentos e economia básica:** quatro castelos e vilas, casas e currais, produção de alimento, mercado com oferta e demanda e impostos com reserva para secas.
2. **Política e migração:** pedidos de ajuda, satisfação e prestígio separados, migração entre reinos e acolhimento por contrato.
3. **Exércitos e conflitos:** recrutamento, abastecimento, fortificações, controle de jazidas e campanhas com objetivos claros.
4. **Sucessão e fragmentação:** conspirações, substituição de reis, deserções, independência e fundação de novos reinos.
5. **Legado estratégico:** memória de fundadores, registro versionado de experiências e uso dessas lições nas decisões futuras dos reinos.

As redes neurais devem entrar como controladores substituíveis, comparáveis inicialmente a políticas simples. Isso permite verificar se uma decisão veio do estado do mundo, da memória individual ou da estratégia do rei, além de manter os experimentos reproduzíveis.
