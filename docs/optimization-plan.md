# Plano de otimização do Kingdom

Data: 24/10/2026. Status: baseline medido; pré-filtro territorial e descarte de snapshots diários intermediários no Worker implementados; primeira fatia do estoque ecológico e remoção dos traços animados de chuva entregues. A migração da água e a retirada da física ambiental, protocolo, trabalho repetido e validação final continuam pendentes.

## Objetivo

Reduzir processamento, memória, transferência de estado e complexidade de manutenção, concentrando a simulação em convivência, sobrevivência, economia, política e guerras. O mundo deve continuar produzindo escassez, cooperação, migração e disputas por recursos sem depender de uma simulação física detalhada do ambiente.

Regra de escopo: um detalhe deve justificar seu custo por uma decisão relevante de moradores, governantes ou soldados. Elementos que servem à aparência podem continuar como dados visuais estáticos.

## O que preservar

- Indivíduos com necessidades, identidade, relações, memória, iniciativa e decisões próprias.
- Fome, saúde, moradia, acesso à água, produção e transporte real de recursos.
- Estoques finitos, propriedade, preços, comércio, impostos e conservação nas transferências.
- Satisfação, legitimidade, medo, lealdade, migração e disputas políticas.
- Recrutamento, abastecimento, combate, controle territorial e consequências da guerra.
- Mapa com distâncias, obstáculos, passagens, recursos e locais estratégicos.
- Calendário, comandos, pausa, inspeção e execução reproduzível por semente.

## Referência existente e metas

`docs/baseline.md` registra, para 128 × 128, dois reinos, 50 moradores, 24 animais e 40 estruturas, medianas atuais de 17,09 dias/s no motor e 12,26 dias/s no caminho do Worker sem resumos diários intermediários. O primeiro snapshot serializado tem 2.736.694 bytes. O benchmark do Worker simula clone e hidratação em Node; não substitui medição no navegador.

O perfil interno instrumentado levou a um pré-filtro seguro de castelos/torres elegíveis e a um índice de reinos: testes confirmam as mesmas células e contagens, e o custo territorial por dia caiu cerca de 80%. Depois, pessoas e território responderam por aproximadamente 56,5% do tempo mediano diário; a atualização das pessoas ficou como maior etapa individual (cerca de 47%). O Worker agora evita criar o resumo retornado por `stepDay` nos dias intermediários de um lote; em três medições de 90 dias, a mediana total passou de 11,85 para 12,26 dias/s e runtime/projeção caiu 6,8%. A comparação é curta e variável, portanto não comprova a meta de redução total de 30%. A próxima entrega de produto segue sendo o modelo econômico simples com água acessível, validado antes de remover sistemas ambientais.

O perfil de 90 dias, seed 42, aponta também o custo do resumo diário do motor em cerca de 4,1 ms/dia (8,2% do intervalo instrumentado). A opção nova só o omite no Worker quando o retorno intermediário não é consumido; `stepDay` e `tick` mantêm o retorno completo por padrão. Uma tentativa de cachear cobertura vegetal na percepção foi mais lenta em A/B e foi descartada.

Primeira fatia da etapa 1: vegetação e roças usam estoques finitos com reposição semanal, cultivo exige sementes pagas, e a semente natural por célula foi removida. A seleção de alimento usa biomassa colhível e ignora a reserva mínima protegida da raiz; isso elimina repetidas tentativas em roças que só têm 1,2 de biomassa não comestível. O clima, a hidrologia e o solo ainda existem, então a etapa 1 não está concluída. A animação de traços de chuva foi removida da renderização; a chuva e o indicador de precipitação continuam na simulação.

Experimento de migração da água (24/10): substituir poças pelo destino estático AutoTile passou no cenário seed 42/dia 253, mas falhou nos quatro replays de 730 dias, com mortes adicionais por desidratação/fome e conflitos. O código experimental foi descartado. A hidratação continua a usar o comportamento atual até existir uma alternativa que preserve sobrevivência e esforço de coleta em replays longos. A água visual continua vinculada ao terreno AutoTile; a mudança pendente é no modelo ecológico.

Após descartar o experimento, a suíte atual passou com 105/105 testes e o build compilou 54 módulos. O Canvas foi conferido no navegador em dia chuvoso: não há traços animados; o indicador `CHUVA` continua ativo.

Validação atual dessa fatia: `npm test` passou com 89/89 e `npm run build` compilou 49 módulos. Nos replays de 730 dias, as sementes 987 e 2026 não tiveram mortes por fome; as sementes 1 e 42 tiveram uma morte cada, ambas de dependentes sem ação própria de coleta. Os diagnósticos históricos já documentavam falhas de cuidado semelhantes; não alteramos transferência de reserva, que havia piorado mortes nos experimentos anteriores. O throughput medido neste checkpoint (8,78 dias/s no motor e 6,61 no Worker) variou muito entre amostras e ocorreu com vários processos Node ativos. Não o aceitamos como comparação de desempenho; repetir em ambiente controlado antes de atribuir uma regressão.

Metas iniciais de engenharia, sujeitas à confirmação da linha de base:

| Indicador | Meta para encerrar o trabalho |
| --- | --- |
| Tempo por dia simulado | Redução de pelo menos 30% na mediana, na mesma carga e máquina |
| Snapshot inicial | Redução de pelo menos 30% em bytes serializados |
| Transferência recorrente | Redução de pelo menos 40% nos bytes por dia simulado |
| Memória retida do mundo | Redução de pelo menos 20%, medida após coleta de lixo |
| Interface | Alvo de 60 FPS na câmera padrão; registrar mediana e p95 do tempo de quadro |
| Resposta a pausa e comandos | Sem regressão no p95; pausa conclui no máximo o lote em andamento |

Ganhos são metas, não resultados medidos. Se não forem atingidos, usar o perfil para definir a próxima ação. Não ampliar o mapa para compensar ganhos antes de validar a configuração atual.

## Etapa 0 — Medir e preparar a comparação

1. Registrar revisão e estado local, configuração, máquina, semente, população, animais e estruturas.
2. Executar `npm test`, `npm run build`, `npm run baseline` e `npm run worker-baseline` no estado anterior às mudanças.
3. Separar tempos de clima, solo/água, vegetação, animais, pessoas, território, economia, consultas e criação de snapshots. O medidor atual agrupa runtime e projeção.
4. Medir bytes do primeiro snapshot e das atualizações recorrentes, memória retida e picos. No navegador, medir quadros e latência de comandos com câmera, zoom, velocidade e IA local fixos.
5. Usar três repetições após aquecimento. Comparar o cenário padrão e uma carga populacional maior explicitamente configurada; evitar comparações entre populações finais diferentes sem registrar essa diferença.

Aceite: tabela reproduzível de custo por sistema, tempo total, memória e transferência. Nenhum subsistema será declarado gargalo apenas por parecer complexo.

## Etapa 1 — Substituir a base ecológica

Prioridade de produto: alta. Arquivos principais: `ecology/climate.js`, `ecology/hydrology.js`, `ecology/plants.js`, `world/generation.js`, `systems.js` e `config/ecosystem.js`, dentro de `src/simulation/` e `src/config/` conforme o módulo atual.

Implementar primeiro o modelo substituto e migrar seus consumidores; retirar os cálculos antigos depois que as dependências tiverem sido resolvidas.

| Sistema | Mudança planejada | Regra substituta |
| --- | --- | --- |
| Temperatura, chuva e umidade locais | Retirar atualização física por região e célula | Calendário independente; efeitos visuais opcionais sem estado físico |
| Solo e água | Retirar infiltração, evaporação, transpiração, saturação e escoamento | Fontes de água identificáveis e acesso espacial preservado |
| Química do solo | Retirar nitrogênio, matéria orgânica e decomposição | Produtividade fixa por área produtiva, se necessária ao equilíbrio |
| Vegetação | Retirar competição fisiológica e biomassa de espécies sem função econômica | Pontos ou manchas finitas de alimento, pasto e madeira |
| Sementes naturais | Retirar banco, dormência e dispersão | Reposição por intervalo e capacidade máxima; cultivo exige investimento |
| Agricultura | Desacoplar produção de água, temperatura e nutrientes por célula | Área, trabalho, insumos e tempo até colheita; estoque produzido finito |
| Troncos abandonados | Retirar conversão em nutrientes | Expiração periódica de objetos antigos, com perda registrada |
| Trilhas | Retirar efeito fisiológico sobre vegetação | Benefício de deslocamento e efeito visual preservados |

Cuidados de implementação:

- Migrar escolha de assentamentos, roças, migração e pastagem, que hoje consultam solo e umidade.
- Preservar o trajeto de beber e a utilidade de rios e lagos. Resolver os consumidores de poças temporárias antes de retirar água superficial.
- Preservar árvores como obstáculos e fonte de madeira, com reposição espaçada e sem surgimento sobre construções ou rotas bloqueadas.
- Registrar geração, colheita, consumo e perda de recursos. Simplificar produção não autoriza criar saldo em transferências.
- Manter custos, transporte, trabalho e risco; evitar comida gratuita depositada diretamente nos estoques.
- Retirar dependências climáticas do calendário e adaptar o comando experimental de seca. Se mantido, ele passa a reduzir produção por região e prazo, com causa visível.
- Tratar crises de produção como opção posterior. Elas não são pré-requisito para eliminar o clima físico.

Aceite: necessidades, coleta, agricultura, construção, pastagem e migração funcionam sem campos físicos de clima ou solo; relatórios explicam entradas e saídas dos recursos. Comparar produção e fome em replays antes e depois.

## Etapa 2 — Limpar estado, protocolo e interface

Depende da etapa 1. Arquivos principais: `render-snapshot.js`, `protocol.ts`, `worker-runtime.js`, `world/queries.js`, `core/state.ts`, `src/ui/game.js` e `index.html`.

- Excluir campos ambientais sem consumidores do mundo, snapshots, consultas, relatórios e inspetores.
- Substituir painéis ambientais por alimento disponível, produção, consumo, reservas, água acessível e gargalos de abastecimento.
- Manter cores de solo e vegetação decorativa como dados visuais quando contribuírem para a leitura do mapa.
- Separar terreno e decoração estáticos dos recursos e entidades mutáveis. Enviar a base na inicialização ou no reset; enviar mudanças posteriores quando necessário.
- Adaptar testes de ida e volta e versionar o protocolo se o formato mudar, rejeitando versões incompatíveis de forma explícita.
- Não criar um sistema de migração de saves nesta etapa: salvamento versionado ainda consta como pendente na arquitetura atual.

Aceite: nenhuma referência inválida a campos removidos; reset, inspeção, comandos e reidratação continuam corretos. Bytes e memória são comparados com a etapa 0.

## Etapa 3 — Reduzir trabalho repetido

Priorizar os itens conforme o perfil da etapa 0 e medir novamente após os cortes ecológicos.

- Recalcular território quando estruturas, integridade, ocupação ou propriedade alterarem influência. Garantir invalidação antes de decisões que dependem da fronteira.
- Reutilizar índices espaciais nas buscas de alimento, água, pessoas e animais, atualizando-os quando entidades se movem ou recursos mudam.
- Atualizar reposição de recursos e limpeza de objetos por intervalos ou eventos, usando tempo transcorrido para não multiplicar produção.
- Armazenar resultados agregados de relatórios enquanto suas fontes não mudarem; manter inventários e transações atualizados imediatamente.
- Preservar a frequência de combate, fome, deslocamento, ordens e transações enquanto não houver evidência de que podem ser espaçados sem alterar a experiência.
- Para animais, avaliar regras simples de fome, sede, pastagem, fuga e reprodução no lugar da rede neural. Aplicar somente se o custo medido justificar e o rebanho conservar sua função econômica.

Aceite: ganhos isolados por alteração; fronteiras, buscas e relatórios sem dados obsoletos. Reduzir frequência não pode atrasar a reação a um ataque ou autorizar consumo de um estoque já esgotado.

## Etapa 4 — Renderização e carregamento

Executar conforme as medições no navegador. A arquitetura já documenta desenho da área visível e preparação de objetos estáticos; verificar o comportamento existente antes de acrescentar caches.

- Eliminar desenho, camadas e animações associados ao clima removido.
- Atualizar terreno estático apenas quando necessário; invalidar recursos visuais após colheita, corte, construção ou destruição.
- Reutilizar a separação entre objetos estáticos e entidades animadas, evitando ordenações e alocações repetidas quando aparecerem no perfil.
- Auditar assets realmente carregados, tamanho de download e duplicação no build. Apagar arquivos locais sem uso só reduz carregamento se eles estavam sendo distribuídos ou requisitados.
- Verificar pausa, avanço manual, velocidades altas, câmera e inspeção com a IA local desligada e ligada, registrando as configurações separadamente.

Aceite: mapa legível, obstáculos coerentes com o movimento e ausência de objetos desatualizados. Comparar tempo de quadro, carregamento e memória no navegador.

## Etapa 5 — Validar sobrevivência, economia e conflitos

1. Rodar `npm test` e `npm run build` após cada alteração relevante. Adaptar testes ecológicos ao contrato substituto, preservando cobertura de sobrevivência, inventários, movimento, território e Worker.
2. Executar replays de 730 dias nas sementes 1, 42, 987 e 2026. Registrar população, causas de morte separadas entre pessoas e animais, produção, estoques, obras e migração.
3. Verificar cenário pacífico com acesso viável a recursos: fome persistente deve ter causa rastreável e não surgir de produção ou trabalho quebrados.
4. Verificar cenário de escassez: falta real de alimento deve continuar provocando consequências e decisões; abundância artificial não serve como correção de sobrevivência.
5. Verificar comércio e impostos com conservação dos saldos; nenhuma quantidade negativa ou não finita, nem fluxo econômico sem explicação.
6. Exercitar recrutamento, campanha, abastecimento, confronto e mudança de controle territorial. Confirmar que as otimizações não apagam os custos da guerra.
7. Executar novamente as medições da etapa 0 e documentar ganhos e regressões no mesmo formato.

Replays novos precisam ser determinísticos entre execuções da mesma versão. A simplificação altera regras e consumo de aleatoriedade; não se exige que o mundo final seja idêntico ao da versão anterior.

## Ordem de entrega

| Entrega | Resultado revisável | Dependência |
| --- | --- | --- |
| A | Linha de base e perfil por sistema | Nenhuma |
| B | Produção simples, água acessível e consumidores migrados | A |
| C | Clima físico, hidrologia e química removidos; calendário preservado | B |
| D | Estado, snapshots e interface enxutos | C |
| E | Custos repetidos reduzidos conforme perfil atualizado | D |
| F | Ajustes visuais e de carregamento que as medições justificarem | D; pode ser independente de E |
| G | Replays, equilíbrio e comparação final documentados | E e F |

Cada entrega deve poder ser revertida separadamente. Não acumular mudanças de regra, transporte e desenho em uma única alteração difícil de avaliar.

## Conclusão do plano

O trabalho estará concluído quando as entregas estiverem validadas, as metas tiverem seus resultados registrados e os cinco pilares continuarem observáveis. Ampliar para quatro reinos ou mapas maiores fica para uma rodada posterior, com medições próprias. Melhorar desempenho no cenário atual não comprova suporte a uma escala maior.
