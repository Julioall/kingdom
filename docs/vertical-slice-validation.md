# Replays autônomos e validação causal — 24/10/2026

## Escopo e correção de integridade

Os dados deste documento foram gerados depois da correção em `resolveBorderIncursions`: o callback agora recebe a pessoa detectada e a causa na assinatura esperada. Antes, o adaptador recebia um objeto extra, não removia a pessoa nem contabilizava a morte, embora a crônica anunciasse o óbito. Os replays anteriores à correção foram substituídos.

O teste de regressão comprova que uma incursão letal remove a pessoa do reino e incrementa `deathsByCause.invasion`. A execução completa passou em `npm test` (138/138) e `npm run build` (59 módulos). O mapa padrão é 128×128.

Quatro seeds (`1`, `42`, `987`, `2026`) foram simuladas por 365 e 730 dias sem comandos humanos. Para o horizonte de 730 dias, cada seed foi repetida e comparada em profundidade: o estado completo e todos os eventos causais foram idênticos nas quatro repetições. Os JSONs completos estão em [replay-multiseed-365.json](../reports/replay-multiseed-365.json) e [replay-multiseed-730.json](../reports/replay-multiseed-730.json).

## Resultado após 365 dias

| Seed | Pessoas vivas | Mortes por invasão | Nascimentos | Guerras/campanhas | Anexações | Trocas | Incidentes de fronteira |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 26 | 24 | 4 | 6 | 3 | 18 | 118 |
| 42 | 42 | 8 | 5 | 5 | 2 | 26 | 57 |
| 987 | 48 | 3 | 6 | 3 | 2 | 10 | 23 |
| 2026 | 46 | 4 | 5 | 1 | 1 | 9 | 9 |

Não houve mortes por fome, sede, idade, ferimento, combate, predação ou colheita. As 39 mortes humanas foram por invasão territorial. Nenhuma campanha chegou a batalha nesse primeiro ano.

## Resultado após 730 dias

| Seed | Pessoas vivas | Mortes por invasão | Nascimentos | População Valedouro/Corvânia | Campanhas | Anexações | Batalhas | Trocas |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20 | 30 | 11 | 4 / 16 | 14 | 3 | 0 | 18 |
| 42 | 40 | 10 | 12 | 15 / 25 | 10 | 2 | 0 | 26 |
| 987 | 48 | 3 | 12 | 23 / 25 | 4 | 2 | 0 | 10 |
| 2026 | 43 | 7 | 12 | 21 / 22 | 4 | 1 | 3 | 9 |

O total foi de 50 mortes por invasão, sem mortes por fome ou combate. O seed 1 teve a crise demográfica mais forte: Valedouro terminou com quatro membros, após 30 invasões letais e 14 campanhas; três campanhas anexaram território e 11 terminaram negociadas. Houve 170 incidentes de fronteira nessa seed. É uma crise do reino, não a dissolução de toda a sociedade: Corvânia ainda tinha 16 membros.

Na seed 2026, três batalhas foram registradas nos dias 480, 486 e 492. Não houve mortes militares; quatro soldados recuaram feridos ao longo dos confrontos. A campanha terminou em armistício e preservou a fronteira. As outras três seeds não tiveram batalhas. As campanhas mantiveram causas, relatos locais, objetivos, resultados e alterações territoriais na crônica.

Nenhuma seed terminou com população civil independente. Os 15 eventos de saída capturados foram soldados liberados de retiradas sem ração diária. Portanto, a amostra explica campanhas e crises por invasão, mas não demonstra migração civil bem-sucedida.

## Diagnóstico inicial das entradas — regra anterior (supersedido)

O script [diagnose-frontier.mjs](../scripts/diagnose-frontier.mjs) usa o gravador diagnóstico já disponível no movimento territorial para associar cada entrada estrangeira à condição do morador naquele momento. Depois de 365 dias nas quatro seeds, registrou 312 entradas: 164 sem aviso ativo, 135 liberadas pela necessidade crítica de alimento, 3 pela necessidade crítica de água e 10 durante campanha. As mortes por invasão ficaram associadas a 20 entradas sem aviso, 17 entradas por comida crítica e 2 por água crítica. Houve 157 expulsões registradas.

Seed 1 concentrou 24 dessas 39 mortes: 12 após entrada por comida crítica, 11 após entrada sem aviso e 1 por água crítica. Na seed 42, foram 5 por comida crítica e 3 sem aviso. Seed 987 teve 2 sem aviso e 1 por água crítica; seed 2026 teve 4 sem aviso. Não houve morte associada às entradas classificadas como campanha. Em seed 1 por 730 dias, o diagnóstico observou 234 entradas (140 críticas por alimento), 130 expulsões e 30 mortes por invasão; 17 das mortes estavam associadas a entradas por comida crítica, 12 sem aviso e 1 por água crítica. Na seed 2026 por 730 dias, foram 44 entradas, 10 expulsões e 7 mortes (6 sem aviso, 1 por comida crítica).

Esse primeiro diagnóstico mostrou entradas sem observador local e foi substituído pela regra de patrulha abaixo. Ele ainda indicava que a necessidade crítica de comida levava civis a cruzar territórios para buscar sustento, enquanto a regra anterior permitia detecção e letalidade mesmo sem guarnição ou posto.

## Patrulha territorial exige observador local

A revisão da incursão agora segue o estado militar que a crônica relata: sem soldado próximo, a patrulha não pode matar; sem soldado nem posto próximo, ninguém detecta a entrada e nenhum incidente é registrado. Um posto sem soldado pode detectar e expulsar, mas não aplica força letal. Os dois novos testes de fronteira cobrem esses casos, além do caso letal com soldado presente.

Depois da regra, as quatro seeds foram repetidas por 365 e 730 dias e cada par foi comparado em estado completo e crônica causal. As oito comparações foram idênticas.

| Seed | Vivos / 365d | Mortes / 365d | Vivos / 730d | Mortes / 730d | Independentes / 730d | Incidentes / 730d |
|---:|---:|---|---:|---|---:|---:|
| 1 | 50 | 0 | 47 | 3 ferimentos | 17 | 420 |
| 42 | 50 | 0 | 50 | 0 | 7 | 215 |
| 987 | 51 | 0 | 50 | 1 fome | 0 | 55 |
| 2026 | 50 | 0 | 48 | 2 invasões | 0 | 24 |

No primeiro ano ocorreram 14 campanhas e 8 anexações, com 444 incidentes de fronteira no total e nenhuma morte. Em 730 dias foram 33 campanhas, 8 anexações e 714 incidentes; 32 campanhas concluíram e uma ainda marchava na seed 2026. Nenhuma campanha registrou batalha nesse conjunto. Houve 25 eventos civis de saída por baixa satisfação após ausência prolongada; 24 pessoas independentes ainda viviam no fim (17 na seed 1 e 7 na seed 42). As outras saídas foram soldados liberados de retiradas sem ração diária. Os replays agora demonstram migração civil e sobrevivência de população independente.

A mortalidade por invasão caiu de 50 para 2 no horizonte de 730 dias; os três óbitos por ferimento e o óbito por fome são efeitos novos que precisam de diagnóstico de causa. A seed 1 manteve 47 pessoas, contra 20 sob a regra anterior. O custo visível dessa política é o aumento das expulsões e deslocamentos: 714 incidentes registrados em quatro seeds durante dois anos. Não se alteraram outras probabilidades de combate.

## Fluxo de alimento compartilhado — auditoria anterior, repetir no estado atual

No checkpoint anterior, o diagnóstico instrumentado da seed 42 por 365 dias fechou o fluxo sem perdas não atribuídas. Valedouro recebeu 118 unidades do tesouro e 105,50 da coleta; consumiu 192,24 por moradores e 31,25 por dependentes. O saldo fecha dentro de 0,01 unidade. Corvânia recebeu 118 do tesouro e 546,58 da coleta; consumiu 571,84 por moradores, 91,74 por dependentes e 1 em construção; o saldo fecha exatamente. Os dois estoques começaram e terminaram em zero. Esses números são anteriores às regras finais de patrulha e precisam ser revalidados.

O estoque compartilhado zerado representa fluxo de entrada e consumo, não sumiço de inventário. Grande parte da colheita é creditada diretamente na reserva pessoal de quem coleta. Ainda falta auditar as reservas em várias seeds durante os dois anos; a ausência de mortes por fome não prova prosperidade econômica.

## Limites e próximos passos

* As quatro seeds reproduzem estado e crônica nos horizontes de 365 e 730 dias. A regra final eliminou mortes por invasão no primeiro ano; no horizonte de dois anos sobraram 2 mortes por invasão, 3 por ferimento e 1 por fome.
* O fluxo de alimento compartilhado foi fechado apenas em um checkpoint anterior. Repetir a reconciliação financeira e pessoal em várias seeds continua pendente.
* Os replays atualizados não tiveram batalha em nenhuma seed. O custo logístico por campanha ainda precisa de consolidação própria.
* Civis agora migram após ausência e satisfação baixa; ainda falta explicar as 3 mortes por ferimento e 1 por fome no conjunto de 730 dias.
* As quatro seeds registraram 714 incidentes em 730 dias; revisar frequência de expulsões, reentradas em necessidade crítica e recuperação de ferimentos.
* Benchmarks de throughput e memória estão em [baseline.md](baseline.md); não se deve inferir FPS do navegador ou capacidade de mapas maiores a partir dos replays.

Depois das regras finais de observação e força letal, `npm test` passou em 140/140 (30,8 s) e `npm run build` passou com 59 módulos. A suíte cobre posto sem soldado, ausência de observador e morte com soldado próximo.

M3, M4 e M5 permanecem em andamento. A evidência confirma determinismo, autonomia, migração civil e consequências territoriais e populacionais; as lacunas acima impedem declarar os marcos concluídos.

## Revalidação de cuidado de dependentes — 24/10/2026

### Causa e correção

Na seed 987, Dara Júnior morreu por fome no dia 485 com 455 dias de idade. O registro dos 45 dias anteriores mostra a reserva cair de 12 para 0,42 pontos e então zero; hidratação permaneceu em 100 e saúde em 97,92. O estoque comum do reino estava zerado. O guardião familiar tinha reserva pessoal zero, enquanto um adulto do mesmo reino a distância local tinha 48,27 pontos. `updateDependent` preferia o guardião familiar mesmo sem reserva, deixando a criança gastar a própria reserva.

O cuidado continua priorizando o guardião familiar quando ele pode cobrir os 0,42 pontos do dia. Se não puder, um adulto local com reserva suficiente assume o cuidado. A transferência usa consumo e adição de inventário, sem criar alimento; a crônica registra o nome do adulto e os pontos debitados. A regressão valida que 0,42 ponto sai do adulto e chega à criança, e que, sem adulto ou estoque comunitário disponível, a reserva da própria criança continua cobrindo a necessidade.

### Replay anual no código atual

Quatro seeds foram executadas por 365 dias e cada uma repetida por inteiro. Estado completo e crônica causal foram idênticos em todas.

| Seed | Pessoas vivas | Mortes | Campanhas | Anexações | Incidentes de fronteira |
|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 0 | 6 | 4 | 297 |
| 42 | 50 | 0 | 4 | 3 | 170 |
| 987 | 51 | 0 | 1 | 1 | 20 |
| 2026 | 50 | 0 | 1 | 1 | 5 |

### Replay de dois anos no código atual

As quatro seeds também foram repetidas integralmente por 730 dias, com igualdade do estado completo e da crônica em cada par. Os replays registraram 112 apoios alimentares de cuidadores locais. Não houve morte por fome, sede, invasão ou combate. As seis mortes observadas foram por ferimentos na seed 1.

| Seed | Pessoas vivas | Mortes | Independentes | Apoios registrados | Disputas | Incidentes de fronteira |
|---:|---:|---|---:|---:|---:|---:|
| 1 | 44 | 6 por ferimentos | 15 | 33 | 23 | 456 |
| 42 | 50 | 0 | 0 | 17 | 0 | 264 |
| 987 | 51 | 0 | 0 | 60 | 0 | 30 |
| 2026 | 50 | 0 | 0 | 2 | 0 | 21 |

As quatro sementes somaram 30 campanhas, 11 anexações, 55 trocas, 771 incidentes de fronteira e nenhuma batalha. No total, houve 33 eventos de saída e 15 pessoas independentes no fim, todas na seed 1. A seed 1 teve 6 mortes por ferimentos, ante 3 no checkpoint anterior; as outras duas mortes daquele checkpoint (uma por fome na seed 987 e duas por invasão na seed 2026) não reapareceram. O total agregado continuou em seis mortes. Eventos recentes da seed 1 associam algumas mortes a disputas repetidas por alimento e incursões em território rival.

O resultado demonstra transferência de cuidado rastreável e zero fome nas quatro seeds nesse horizonte. Ele não prova sustentabilidade econômica: os estoques comuns permanecem frequentemente zerados, e o cuidado local redireciona recursos finitos. A mudança de trajetória também aumentou disputas e ferimentos na seed 1. Auditar o orçamento de alimento pessoal e investigar a pressão de conflitos seguem necessários antes de fechar M3/M4. Não houve batalhas nos replays atuais, portanto logística de combate também continua sem validação suficiente.

Os relatórios pareados completos do código atual estão em [replay-final-365.json](../reports/replay-final-365.json) e [replay-final-730.json](../reports/replay-final-730.json). Testes e build após a auditoria financeira: 141/141 testes aprovados; produção compilada com 60 módulos.

## Reconciliação final do mercado — 24/10/2026

A auditoria de 730 dias em quatro seeds encontrou uma omissão no livro-razão: as refeições compradas pelos soldados debitavam alimento e creditavam ouro no estoque do mercado, mas não geravam um registro `market`. Por isso, o saldo inicial de alimento (42 unidades por mercado) e parte do ouro pareciam desaparecer, embora as transferências ocorressem.

Agora, cada compra de ração militar grava no mesmo livro-razão os deltas reais de alimento e ouro do mercado, junto ao soldado, reino e dia. A compra é compartilhada com os livros do mercado, reino e comunidade. O simulador não altera a quantidade nem o momento das refeições; o ajuste corrige somente o registro financeiro. O teste de serviço militar valida o delta de alimento e ouro e a presença da mesma transação nos registros vinculados.

| Seed | Transações em Valedouro | Transações em Corvânia | Maior saldo de mercado não explicado (5 recursos × 2 reinos) |
|---:|---:|---:|---:|
| 1 | 41 | 46 | 0,00 |
| 42 | 52 | 43 | 0,00 |
| 987 | 47 | 42 | 0,00 |
| 2026 | 42 | 41 | 0,00 |

Em cada um dos oito mercados, o alimento fechou como 42 de abertura, −42 de transações e zero no encerramento. Ouro e demais recursos também fecharam em todos os oito livros, sem resíduo não explicado a duas casas decimais. Os relatórios completos estão em [seed 1](../reports/economy-audited-seed1-730.jsonl), [seed 42](../reports/economy-audited-seed42-730.jsonl), [seed 987](../reports/economy-audited-seed987-730.jsonl) e [seed 2026](../reports/economy-audited-seed2026-730.jsonl).

`npm test` passou com 141/141 testes; `npm run build` passou com 60 módulos (bundle principal 425,63 kB, Worker 238,17 kB). A reconciliação confirma que os livros de estoque do mercado fecham. Ela não fecha o orçamento de alimento pessoal e ecológico, nem a sustentabilidade de longo prazo; as lacunas de mortes por ferimentos, conflitos e campanhas sem batalha permanecem em M3/M4.

## Reconciliação das reservas pessoais — 24/10/2026

O observador opcional das operações de reserva confirma, em cada dia, os pontos adicionados, consumidos e transferidos por categoria. Ele fica desativado no jogo normal. A regressão específica confirma os deltas de colheita, consumo e transferência, e a suíte passou com 142/142 testes.

Nas quatro seeds do layout diagnóstico de fronteira, foram conciliados 2.920 fechamentos diários sem resíduo. Valores abaixo são pontos de reserva pessoal; as refeições comunitárias e militares são conversões para esses pontos.

| Seed | Abertura | Colheita pessoal | Refeições comunitárias | Refeições militares | Consumo de pessoas e dependentes | Construção | Encerramento | Resíduo diário |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3.791,43 | 23.261,57 | 931,75 | 60,48 | 26.135,69 | 45,20 | 1.864,34 | 0 |
| 42 | 3.705,97 | 22.719,96 | 1.062,81 | 60,48 | 25.269,80 | 56,80 | 2.222,61 | 0 |
| 987 | 3.720,05 | 22.896,89 | 1.009,87 | 60,48 | 25.398,74 | 64,00 | 2.224,55 | 0 |
| 2026 | 3.669,97 | 22.825,73 | 945,41 | 60,48 | 25.886,51 | 41,60 | 1.573,49 | 0 |

As transferências de cuidado e nascimento foram registradas nos dois lados e tiveram saldo líquido zero; construções consomem reserva diretamente. Não houve morte por fome ou desidratação nesse conjunto. O layout diagnóstico produziu duas mortes por invasão na seed 42; esses dados servem para auditoria de inventário e não substituem os replays de gameplay padrão. Os relatórios completos estão em [seed 1](../reports/food-reserves-audited-seed1-730.json), [seed 42](../reports/food-reserves-audited-seed42-730.json), [seed 987](../reports/food-reserves-audited-seed987-730.json) e [seed 2026](../reports/food-reserves-audited-seed2026-730.json).

Isso fecha as reservas pessoais observadas, mas não mede sozinho a sustentabilidade ecológica: a colheita é retirada de alimento vegetal e animal finito, e as pessoas ainda podem terminar com reservas baixas. Permanecem em M3/M4 o equilíbrio de longo prazo da produção, a recuperação dos estoques naturais, as mortes por ferimentos e a pressão de conflitos. O build atual passou com 60 módulos (bundle principal 426,33 kB; Worker 238,86 kB).

## Auditoria logística preliminar das campanhas — supersedida pela revalidação abaixo

Corrigimos dois desvios do fluxo de guerra: soldados em campanha não podem comprar refeições remotamente no mercado do reino, e uma guerra sem tropa atacante aguarda recrutamento antes de criar campanha. A campanha agora registra as rações consumidas das reservas pessoais, além de mantimentos de campo e perdas de equipamento. O resumo identifica também o efetivo mobilizado no início, mesmo quando há baixas ou deserções depois.

Quatro replays de 730 dias foram executados e repetidos integralmente; estado completo e crônica causal coincidiram nas quatro seeds. Houve 14 campanhas, 11 anexações e nenhuma batalha no conjunto.

| Seed | Pessoas vivas | Mortes | Campanhas | Anexações | Pontos de reserva pessoal usados em campanha |
|---:|---:|---|---:|---:|---:|
| 1 | 44 | 5 ferimentos, 1 fome | 5 | 4 | 335,88 |
| 42 | 49 | 1 ferimento | 4 | 3 | 302,89 |
| 987 | 51 | 0 | 3 | 3 | 165,36 |
| 2026 | 50 | 0 | 2 | 1 | 312,44 |
| **Total** | — | **6 ferimentos, 1 fome** | **14** | **11** | **1.116,57** |

As 14 campanhas mobilizaram 39 soldados ao todo. Nenhuma recebeu alimento do tesouro para ração de campo: o consumo registrado veio das reservas pessoais dos soldados. O custo de equipamento também foi zero, pois não ocorreram batalhas. Os balanços de alimento, madeira e ouro fecharam sem saldo inexplicado em cada lado e campanha. Três guerras continuavam aguardando força atacante no fim do horizonte; nenhuma delas criou uma campanha vazia.

A auditoria fecha o registro dos custos observados, mas a simulação ainda não exercitou ração de campo nem custo de equipamento em combate. Também permanece uma morte por fome na seed 1; investigar sua causa junto das outras seis mortes por ferimento continua necessário para M3/M4. Relatório: [replay-campaign-final-730.json](../reports/replay-campaign-final-730.json). A regressão de rações pessoais passou; `npm test` passou com 144/144 testes e `npm run build` com 60 módulos.

## Reforços e combates no objetivo — resultado preliminar supersedido abaixo

O prazo fixo de oito dias para ocupar um objetivo declarava vitória antes que tropas defensoras distantes pudessem chegar. A campanha agora mantém o conflito enquanto a defesa avança; uma defesa sem abastecimento só cede se já chegou à frente ou se sua rota ficou bloqueada por quatro dias. O teste de regressão confirma que uma força defensora viva e em marcha não perde o território prematuramente.

As quatro seeds completaram 730 dias e foram repetidas integralmente. Estado completo e crônica causal coincidiram em todas. O novo conjunto registrou 6 campanhas, 11 batalhas e 4 anexações. As baixas foram 6 por combate. As mortes totais também incluíram 5 por ferimentos, 2 por fome e 1 por invasão.

| Seed | Pessoas vivas | Mortes | Campanhas | Batalhas | Anexações | Reserva pessoal usada | Equipamento perdido (madeira/ouro) |
|---:|---:|---|---:|---:|---:|---:|---:|
| 1 | 45 | 4 ferimentos, 1 combate | 3 | 3 | 3 | 275,34 | 4 / 2 |
| 42 | 45 | 1 ferimento, 2 combate, 2 fome | 1 | 3 | 1 | 320,58 | 3 / 1,5 |
| 987 | 49 | 1 combate, 1 invasão | 1 | 3 | 0 | 216,09 | 4 / 2 |
| 2026 | 48 | 2 combate | 1 | 2 | 0 | 121,68 | 2 / 0 |
| **Total** | — | **5 ferimentos, 6 combate, 2 fome, 1 invasão** | **6** | **11** | **4** | **933,69** | **13 / 5,5** |

As 6 campanhas mobilizaram 18 soldados. Nenhuma recebeu ração do estoque de campo; 933,69 pontos vieram das reservas pessoais. As batalhas consumiram 13 unidades de madeira e 5,5 de ouro. Todos os saldos de alimento, madeira e ouro fecharam sem resíduo inexplicado. Quatro guerras aguardavam força atacante no fim do horizonte, sem criar campanhas vazias.

O replay agora cobre combate e perda de equipamento em simulação autônoma; ainda não cobre ração fornecida pelo estoque de campo. As duas mortes por fome na seed 42 e as mortes por ferimentos continuam sob investigação, e M3/M4 seguem abertos. Relatório pareado: [replay-campaign-final-730.json](../reports/replay-campaign-final-730.json). `npm test`: 145/145; `npm run build`: 60 módulos.

## Revalidação de cuidado após baixas de campanha — 24/10/2026

Na seed 42, dois dependentes ficaram sem cuidador após a morte do guardião, o soldado Bela Z, em combate no dia 178. Como o sistema só buscava adultos num raio de seis tiles, Ravi Y e Tainá K permaneceram no local e morreram por fome nos dias 477 e 480, embora adultos do reino com reservas estivessem a aproximadamente 29 tiles.

Agora um dependente órfão pode caminhar até o adulto mais próximo do mesmo reino/comunidade com reserva alimentar. A regra exclui soldados que ainda estão em campanha e transfere alimento da reserva real do cuidador. Não cria recursos. A regressão confirma o deslocamento, a troca de guardião e o débito da reserva. No replay atualizado, Ema T apoiou ambos no dia 290; nenhum dos dois morreu por fome.

As quatro seeds de 730 dias foram repetidas integralmente e reproduziram estado completo e crônica causal. Esse resultado substitui o replay M4 imediatamente anterior.

| Seed | Pessoas vivas | Mortes | Campanhas | Batalhas | Anexações | Reserva pessoal usada | Equipamento perdido (madeira/ouro) |
|---:|---:|---|---:|---:|---:|---:|---:|
| 1 | 45 | 4 ferimentos, 1 combate | 3 | 3 | 3 | 275,34 | 4 / 2 |
| 42 | 49 | 1 combate | 2 | 3 | 2 | 304,98 | 3 / 1 |
| 987 | 48 | 2 ferimentos, 1 invasão | 1 | 0 | 0 | 822,42 | 0 / 0 |
| 2026 | 48 | 2 combate | 1 | 2 | 0 | 121,68 | 2 / 0 |
| **Total** | — | **6 ferimentos, 4 combate, 1 invasão, 0 fome** | **7** | **8** | **5** | **1.524,42** | **9 / 3** |

As campanhas mobilizaram 21 soldados. A ração de campo continuou zerada; soldados usaram 1.524,42 pontos das reservas pessoais. Os combates consumiram 9 unidades de madeira e 3 de ouro. Todos os saldos de alimento, madeira e ouro fecharam sem resíduo inexplicado. Quatro guerras ainda aguardavam força atacante no fim dos dois anos.

M3/M4 permanecem abertos: o resgate eliminou as mortes por fome dessa amostra, mas ainda não há estoque de ração de campo nas campanhas, quatro guerras não mobilizaram força e resta uma morte por invasão. O replay está em [replay-campaign-final-730.json](../reports/replay-campaign-final-730.json). `npm test`: 146/146; `npm run build`: 60 módulos.

## Revalidação autônoma anual — M5, 24/10/2026

Quatro seeds executaram 365 dias sem comandos humanos para unidades ou decisões estratégicas. Cada execução foi repetida e comparada em profundidade; estado completo e crônica causal coincidiram nas quatro. Os cenários produziram populações, conflitos e resultados diferentes.

| Seed | Pessoas vivas | Mortes | Campanhas | Batalhas | Anexações | Trocas |
|---:|---:|---|---:|---:|---:|---:|
| 1 | 49 | 1 combate | 3 | 3 | 3 | 98 |
| 42 | 49 | 1 combate | 2 | 3 | 2 | 103 |
| 987 | 50 | 1 invasão | 1 | 0 | 0 | 88 |
| 2026 | 48 | 2 combate | 1 | 2 | 0 | 94 |
| **Total** | **196** | **4 combate, 1 invasão, 0 fome** | **7** | **8** | **5** | **383** |

A crônica registra custos de equipamento nas batalhas, evidências locais, resultados de campanha e mudanças territoriais. O ano autônomo e a inspeção visual estão verificados; M5 permanece aberto enquanto faltam o ciclo de recrutamento e o reabastecimento em campo. Relatório: [replay-campaign-final-365.json](../reports/replay-campaign-final-365.json). M3/M4 continuam em andamento pelas lacunas registradas acima.

## QA visual da interface de observação — 24/10/2026

No desktop (viewport de 1440 × 900), foram verificados pausar/retomar, avanço manual de dias, camadas, crônica e seleção de reino/célula. No viewport estreito (388 × 695), a seleção do reino abriu o card rolável. O card de reino exibe população, moradias, território, soldados, tesouro, mercado, estratégia, campanhas, manutenção e construções; a célula apresenta terreno, domínio, solo, água retida, nutrientes, recursos geológicos, caça e biomassa. A crônica mostra os registros causais recentes.

A revisão visual encontrou o minimapa cobrindo parte do card no desktop. Em telas com pelo menos 1101 px, o card agora se abre no campo central, entre os painéis laterais e o minimapa; o screenshot atualizado confirmou que as áreas não se sobrepõem. Em celular, o inspetor permanece rolável acima da navegação inferior e o minimapa é ocultado para preservar espaço.

O QA confirmou leitura e navegação, mas não valida ainda todas as interações de unidades/estruturas nem o recrutamento seguido do reabastecimento de campanha. Esses pontos seguem pendentes em M5/M4.

## Recrutamento autônomo e reabastecimento de campanha — 24/10/2026

Uma campanha que não encontra soldados disponíveis agora registra um pedido de efetivo no relatório local do reino. A estratégia determinística só abre treinamento se não houver soldado livre ou outro treinamento em andamento, se o tesouro cobrir o custo e se a reserva comunitária, depois do repasse normal, mantiver pelo menos um dia de consumo. A decisão registra guerra observada, recruta, custo e previsão de conclusão. Ao mobilizar a campanha, o pedido local passa a `mobilized`.

O teste de integração manteve o tesouro e a reserva civil abastecidos para isolar o ciclo: o reino treinou um soldado por 10 alimento, 8 madeira e 3 ouro; a formação começou no dia 7 e foi mobilizada no dia 8. A campanha debitou 25 unidades de alimento do tesouro na mobilização e mais 7,6 após sete dias em território amigo. O livro fechou deployment + resupply = ração consumida + saldo de campo, sem recurso criado. Outro teste confirma que um tesouro curto primeiro repõe a reserva comunitária e não inicia treinamento.

As quatro seeds anuais (1, 42, 987 e 2026) foram repetidas integralmente após a mudança; estado completo e crônica causal coincidiram em todos os pares. No mundo padrão, nenhuma recrutou ou usou ração de campo: os oito tesouros terminaram com alimento zero, e duas guerras ainda aguardavam efetivo. Portanto, o ciclo está implementado e provado em cenário finito controlado, mas a economia normal ainda não sustenta ração militar em campanha. Isso mantém M4/M5 abertos.

Validação: `npm test` 148/148; `npm run build` com 60 módulos. Replay anual: [replay-campaign-final-365.json](../reports/replay-campaign-final-365.json).

## Reabastecimento com excedente comunitário protegido — 24/10/2026

A demanda diária alimentar do reino agora usa uma única regra para estratégia, reserva, mercado e tributos: adultos consomem 0,78 unidade e dependentes 0,42. Durante uma campanha, o tesouro continua sendo a primeira fonte de ração. Se faltar alimento e os soldados estiverem em território amigo, o reino pode transferir excedente do estoque comunitário, mantendo dois dias de demanda civil protegidos. O ledger separa as fontes e a transferência reduz o estoque comunitário pelo mesmo valor.

Um teste finito confirmou que a campanha recebeu 5 unidades comunitárias acima da reserva de dois dias e foi impedida de consumir essa reserva em nova tentativa. Quatro replays pareados de 365 dias reproduziram estado completo e crônica causal:

Um ensaio anterior com proteção de apenas um dia transferiu 52,99 unidades comunitárias no replay anual. O valor não foi mantido: a política atual conserva o buffer de dois dias já usado pelo assentamento. O relatório do ensaio está em [replay-community-resupply-1day-experiment-365.json](../reports/replay-community-resupply-1day-experiment-365.json).

| Seed | Pessoas vivas | Adultos com reserva < 20 no dia 365 | Reserva adulta média no dia 365 | Dias-adulto < 20 durante o ano | Campanhas | Batalhas | Ração comunitária de campanha |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 26 | 21,14 | 34,47% | 1 | 3 | 0 |
| 42 | 48 | 14 | 33,21 | 29,83% | 4 | 3 | 10,53 |
| 987 | 49 | 6 | 41,65 | 6,49% | 1 | 2 | 0 |
| 2026 | 51 | 4 | 51,76 | 7,78% | 1 | 0 | 0 |
| **Total** | **198** | **50 de 154 adultos** | — | — | **7** | **8** | **10,53** |

O replay consumiu 92,96 unidades de ração de campo, não registrou morte por fome e fechou os saldos de campanha sem resíduo. Todos os tesouros e estoques comunitários de alimento terminaram zerados; três guerras ainda aguardavam efetivo atacante. A métrica de dias-adulto mostra que, nas seeds 1 e 42, a reserva ficou abaixo de 20 em aproximadamente um terço dos dias de exposição. Isso é pressão persistente, não apenas uma foto baixa no último dia. O buffer de dois dias foi preservado nos repasses, mas o ciclo de recrutamento não apareceu no replay normal. M4/M5 permanecem **In Progress**; a regra de ressuprimento é uma melhora parcial, não uma evidência de sustentabilidade alimentar.

Relatório: [replay-community-resupply-2day-365.json](../reports/replay-community-resupply-2day-365.json). `npm test`: 150/150; `npm run build`: 61 módulos.

## Coleta com alvo persistente e revalidação anual — 24/10/2026

O indivíduo com pouca reserva agora mantém o alvo de alimento enquanto a mancha continua visível e o retorno esperado ainda paga o custo da viagem. A continuidade perde prioridade quando o alvo deixa de ser rentável; a coleta, a disputa ou o desaparecimento do alvo limpam a referência. Na auditoria da seed 1, as trocas de alvo antes da colheita caíram de 492 para 200, e trocas apesar de ainda existir um alvo colhível caíram de 220 para 24. Colheitas abaixo da necessidade diária caíram de 309 para 218; o alimento vegetal colhido aumentou 569 unidades, de 14.623,66 para 15.192,66. Isso melhora o aproveitamento das viagens, mas não resolve a escassez anual.

As quatro seeds executaram 365 dias e foram repetidas com comparação do estado integral e da crônica causal. As quatro verificações passaram.

| Seed | Pessoas vivas | Adultos | Reserva média adulta no dia 365 | Média durante dias-adulto | Dias-adulto abaixo de 20 | Campanhas | Batalhas | Ração comunitária em campanha |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 42 | 30,72 | 38,67 | 32,99% | 3 | 2 | 0 |
| 42 | 48 | 37 | 29,04 | 41,53 | 30,90% | 4 | 3 | 10,53 |
| 987 | 49 | 35 | 47,65 | 49,58 | 9,86% | 1 | 3 | 0 |
| 2026 | 51 | 40 | 49,14 | 53,52 | 8,83% | 0 | 0 | 0 |
| **Total** | **198** | **154** | — | — | **44 adultos abaixo de 20 no dia 365** | **8** | **8** | **10,53** |

O replay consumiu 92,96 unidades de alimento em campo; 10,53 vieram do estoque comunitário protegido. Não houve mortes por fome e os saldos de campanha fecharam sem diferença inexplicada. Ainda assim, os adultos das seeds 1 e 42 passaram cerca de 31–33% dos dias-adulto com reserva abaixo de 20, e todos os estoques finais de alimento do tesouro e das comunidades ficaram zerados. Há sete anexações e uma guerra aguardando força. A sustentabilidade alimentar continua pendente e M4/M5 permanecem **In Progress**.

Replay: [replay-forage-persistence-2day-365.json](../reports/replay-forage-persistence-2day-365.json). Auditoria de coleta: [diagnose-food-target-persistence-seed1-365.json](../reports/diagnose-food-target-persistence-seed1-365.json). Comparação anterior: [replay-community-resupply-2day-365.json](../reports/replay-community-resupply-2day-365.json). Validação após as alterações: `npm test` 151/151; `npm run build` com 61 módulos.

## Ajustes de reserva alimentar descartados — 24/10/2026

Depois da revalidação anual, foram comparadas intervenções para reduzir a exposição prolongada a reservas baixas. A regra de coleta urgente com mais trabalhadores elevou as mortes por invasão para 6 na seed 1 e 11 na seed 42. Reservar o líder como construtor também piorou os resultados anuais. Aumentar de cinco para seis a capacidade de coleta teve efeito misto entre sementes. Essas mudanças foram revertidas.

Também foi testada a conversão de alimento de `0,72` para `0,83` ponto de reserva por unidade. A reserva final aumentou em três das quatro seeds, caiu na seed 1 e vieram mais mortes por invasão nas seeds 1 e 42; a colheita total também diminuiu. A conversão canônica `0,72` foi restaurada. Nenhum desses ensaios demonstra uma melhora segura para o mundo padrão.

Após a restauração, `npm test` passou com 151/151 testes e `npm run build` compilou 61 módulos. A revalidação não altera os resultados do replay anual já documentado: não houve morte por fome, mas as reservas ficaram abaixo de 20 em 32,99% e 30,90% dos dias-adulto nas seeds 1 e 42. A causa não é perda sem contabilização; o fechamento observado das reservas tem resíduo zero. M3/M5 continuam abertos para uma política que sustente reservas sem aumentar a mortalidade de fronteira.

## Elegibilidade de trabalhador para obra — replays após correção — 24/10/2026

O diagnóstico da seed 1 localizou uma inconsistência entre a delegação estratégica e a ação individual. A obra podia ser delegada com energia a partir de 22, embora construir exigisse mais de 27. No dia 70, Valedouro designou um coletor com 23,6 de energia; ele continuou na coleta, perdeu energia e a roça ficou sem progresso. A delegação de obra agora exige energia acima do mesmo limite da ação individual, evitando reservar um trabalhador para uma tarefa que ele não pode executar.

Quatro replays de 365 dias foram comparados ao checkpoint anterior, com a conversão de alimento em `0,72` mantida. A coluna de exposição mede a porcentagem dos dias-adulto abaixo de 20; a média é a reserva média dos adultos no dia 365.

| Seed | Adultos no fim | Média final | Dias-adulto <20 | Mortes | Batalhas |
|---:|---:|---:|---:|---|---:|
| 1 | 42 | 35,86 (antes 30,72) | 32,53% (antes 32,99%) | 0 | 2 |
| 42 | 37 | 29,46 (antes 29,04) | 31,05% (antes 30,90%) | 2 combate, 1 invasão | 3 |
| 987 | 35 | 47,65 (igual) | 9,86% (igual) | 1 combate, 1 invasão | 3 |
| 2026 | 39 | 53,75 (antes 49,14) | 5,17% (antes 8,83%) | 1 combate (antes 0) | 3 (antes 0) |

Não houve morte por fome. As reservas melhoraram em duas seeds, quase não mudaram em uma e permaneceram iguais na outra; portanto, o ajuste corrige a delegação inviável, mas não resolve a sustentabilidade alimentar. A trajetória de 2026 passou a incluir três batalhas e uma baixa de combate. As sementes 42 e 2026 foram repetidas por inteiro no novo código; estado e crônica causal coincidiram nos dois pares. O replay completo está em [replay-food-builder-energy-alignment-365.json](../reports/replay-food-builder-energy-alignment-365.json).

Validação atual: `npm test` 152/152; `npm run build` com 61 módulos. M3 e M5 permanecem **In Progress** pela exposição prolongada a reservas baixas. M4 também permanece **In Progress**; a nova baixa e as batalhas de 2026 ampliam a cobertura de combate, mas ainda precisam ser avaliadas junto dos custos logísticos e das demais sementes.

## Filtro estrito de construtores — experimento rejeitado — 24/10/2026

Depois da correção do limite de energia, foi testada uma triagem que também exigia reserva de 50, ausência de carga/atribuição ativa e exclusão do governante. A suíte e o build passaram nesse experimento, mas o replay anual teve regressão grave: a seed 1 terminou com 43 pessoas, 7 mortes por invasão, nenhuma colheita cultivada e nenhuma das duas roças concluída (o checkpoint anterior terminou com 50 pessoas). Na seed 42, o replay terminou com 45 pessoas, incluindo 3 mortes por invasão, 1 em combate e 1 por ferimentos. O filtro foi revertido.

O código atual mantém apenas o alinhamento entre o limite de energia da delegação (`>27`) e o da ação individual. O resultado estrito foi preservado para comparação em [replay-food-safe-builder-365.json](../reports/replay-food-safe-builder-365.json); ele não representa a validação atual.

## Replay de 730 dias após correção da elegibilidade de obra — 24/10/2026

Repeti o replay atual nas quatro sementes depois de alinhar o limite de energia de construção. O replay usa o layout padrão do mapa 128 × 128; a auditoria de seed 42 também foi executada com `DIAGNOSE_LAYOUT=default`, portanto os valores não misturam a disposição `frontier`. As sementes 42 e 2026 foram repetidas integralmente: estado do mundo e crônica causal coincidiram. Não houve mortes por fome nem mortes de animais. Houve seis mortes humanas — quatro em combate e duas por invasão — e 11 batalhas registradas. As contas de suprimento de todas as campanhas fecharam com resíduo inexplicado zero.

| Seed | Pessoas vivas (residentes/independentes) / animais | Mortes humanas | Reserva adulta média final | Dias-adulto abaixo de 20 | Reserva zero | Alimento vegetal colhido / regenerado | Cultivo colhido / regenerado | Roças no fim |
|---:|---:|---|---:|---:|---:|---:|---:|---|
| 1 | 50 (33/17) / 34 | — | 29,84 | 41,18% | 3,23% | 32.289,73 / 55.011,19 | 6.151,91 / 8.157,37 | 1 concluída; outra 9/34 |
| 42 | 48 (37/11) / 35 | 2 combate, 1 invasão | 22,32 | 42,30% | 3,14% | 30.154,87 / 51.170,70 | 224,70 / 4.036,86 | 1 concluída; outra 20/34 |
| 987 | 49 (49/0) / 39 | 1 combate, 1 invasão | 47,89 | 13,34% | 0,38% | 32.081,44 / 54.609,90 | 6.301,35 / 8.716,41 | 1 concluída |
| 2026 | 50 (50/0) / 35 | 1 combate | 61,75 | 4,31% | 0% | 35.019,45 / 63.380,78 | 11.313,93 / 16.862,42 | 2 concluídas |

Os estoques comunitários de alimento terminaram zerados nas quatro seeds; a produção vegetal e a regeneração continuaram positivas. Houve 11 campanhas, 11 batalhas e três guerras ainda ativas no fim do horizonte. Campanhas consumiram 82,43 unidades de ração mobilizada e 10,53 de ressuprimento comunitário; o consumo total foi 92,96 e os saldos fecharam sem resíduo. As reservas pessoais forneceram outras 1.324,11 unidades de ração, e os combates perderam 13 de madeira e 4,5 de ouro em equipamento.

A trilha causal registrou 17 saídas civis de Valedouro na seed 1 e 11 na seed 42; em ambas, as pessoas deixaram a comunidade após satisfação abaixo de 0,400, com estoque compartilhado zerado. No dia 726 da seed 42, por exemplo, Tainá F saiu após 46 dias de ausência, com satisfação 0,370 e reserva pessoal 7,9. Esses moradores continuavam vivos, por isso a tabela separa residentes de pessoas independentes. A seed 42 também registrou duas liberações de soldados durante a retirada por falta de ração diária. Estado e crônica reproduziram para seeds 42 e 2026, mas a segurança de reserva e a retenção civil variam bastante entre sementes.

O diagnóstico da seed 42 não encontrou seleções de alimento sem alvo nem colheitas zeradas entre 8.150 seleções de baixa reserva e 4.182 colheitas observadas. Ainda assim, 865 colheitas renderam menos que a necessidade diária, e em 86 casos a pessoa mudou de alvo enquanto o anterior ainda tinha biomassa colhível. Isso não sustenta uma regra geral de alvo ausente como causa do déficit.

As duas obras de roça incompletas da seed 42 avançaram pela última vez nos dias 352 e 425. Na auditoria do dia 720, havia três e seis trabalhadores disponíveis em até 14 células dos canteiros, mas nenhum atendia ao limite de energia/reserva mesmo usando o corte de reserva 40. Os trabalhadores próximos mais fortes tinham energia 0,4 em Valedouro e 2,3 em Corvânia. O bloqueio atual observado é a exaustão dos trabalhadores próximos sob estoques compartilhados vazios; afrouxar o filtro de segurança sem recuperar a energia não resolve a causa.

Replay completo: [replay-energy-alignment-730.json](../reports/replay-energy-alignment-730.json). Auditoria detalhada de alimento e elegibilidade de construtores em seed 42: [diagnose-energy-alignment-seed42-730.json](../reports/diagnose-energy-alignment-seed42-730.json). `npm test` passou com 152/152 e `npm run build` compilou 61 módulos. M3 continua em andamento para recuperar reservas e fluxo comunitário sem reduzir sobrevivência; M4 segue aberto apesar da validação de ração, combate e custo de equipamento, pois ainda há guerras e baixas no horizonte; M5 permanece aberto enquanto a exposição prolongada a reservas baixas e as saídas civis se concentram em Valedouro nas seeds 1 e 42.

## Fechamento do razão de reservas pessoais — layout padrão — 24/10/2026

O diagnóstico `diagnose-food-reserves.mjs` agora aceita `FOOD_RESERVE_LAYOUT=default|frontier` e informa layout e posicionamentos no relatório. Antes, o script sempre reposicionava os reinos no layout `frontier`, o que tornava sua contagem de mortes não comparável ao replay padrão. A versão corrigida foi repetida na seed 42 por 730 dias com layout `default`; as causas de morte coincidem com o replay correspondente: duas em combate e uma por invasão.

As 58.485 operações de reserva fecharam sem resíduo em cada um dos 730 dias. O saldo passou de 3.705,97 para 1.637,41 pontos (variação líquida −2.068,56), com 24.653,38 pontos adicionados e 26.721,95 removidos. Colheitas pessoais acrescentaram 21.178,15; consumo de adultos removeu 20.769,63 e de dependentes 3.156,92. Transferências de cuidado fecharam nos dois lados sem variação líquida. Refeições comunitárias, refeições de mercado militar e rações de campanha creditaram 724,24 pontos às reservas pessoais; esforço de construção consumiu 44,40.

Relatórios: [auditoria default](../reports/food-reserves-default-seed42-730.json) e [auditoria frontier anterior](../reports/food-reserves-frontier-seed42-730.json). O relatório `frontier` fica preservado para comparação, mas não representa o replay do mapa padrão.

## Diagnóstico de energia, retorno da coleta e repouso seguro — 24/10/2026

O novo diagnóstico por adulto-dia mediu, na seed 42 padrão, energia média de 10,44 em 27.675 dias-adulto. Em 20.536 dias de busca por alimento, a energia variou em média −0,30 por dia. Energia ficou abaixo de 27 em 87,5% dos dias-adulto; nos dias com reserva ≤8 e energia ≤2, a ação ainda foi `forage` em 6.469 ocasiões. Isso confirma uma tensão entre recuperação e busca urgente, mas não basta para justificar aumentar o ganho energético da coleta.

Aumentei temporariamente o ganho por alimento coletado de 0,18 para 0,40 e rodei quatro replays de 730 dias, com estado e crônica repetidos integralmente para as seeds 42 e 2026. O resultado variou por semente: a seed 42 melhorou (51 pessoas, sem mortes, reserva média 37,99 e duas roças concluídas), enquanto a seed 1 regrediu para 41 pessoas e dez mortes humanas (seis por ferimentos, três por invasão e uma em combate); a seed 2026 terminou com uma morte adicional por invasão e maior exposição a reservas baixas; a 987 teve mais dias-adulto abaixo de 20. A alteração foi revertida.

O diagnóstico de energia é reproduzível por `npm run diagnose-energy-budget`; o relatório de seed 42 no checkpoint original está em [diagnose-energy-budget-seed42-default-730.json](../reports/diagnose-energy-budget-seed42-default-730.json). O replay do coeficiente rejeitado está preservado em [replay-forage-energy-730.json](../reports/replay-forage-energy-730.json). Nenhum novo coeficiente de energia foi mantido.

Testei também aplicar o ganho de 0,40 somente quando a pessoa tinha reserva acima de 16 e energia até 27, para focar quem poderia voltar a construir. A regra terminou a seed 1 com 47 pessoas e duas mortes por ferimento mais uma em combate; a seed 42 teve 42 pessoas, oito mortes por invasão e uma por ferimento; a 2026 teve uma morte por invasão e maior exposição a reservas baixas. A seed 987 melhorou, com reserva média 49,77 e 8,38% dos dias-adulto abaixo de 20. Como as outras sementes regrediram, a regra também foi revertida. Estado e crônica foram reproduzidos para 42 e 2026. Resultado preservado em [replay-builder-energy-recovery-730.json](../reports/replay-builder-energy-recovery-730.json).

### Repouso seguro para recuperar trabalhadores de obra — experimento rejeitado no horizonte longo

Na matriz inicial de 730 dias, a regra que forçava repouso de civis sem ordem de campanha quando energia <27 e a reserva calculada bastava para permanecer acima de 16 completou as roças pendentes nas seeds 1 e 42. A colheita cultivada subiu 44,5%, não houve mortes por fome nesse horizonte e o estado/crônica reproduziu para 42 e 2026. Porém, a exposição a reservas baixas aumentou em todas as seeds e os estoques comunitários continuaram zerados.

Estendi a comparação para 1.460 dias, com quatro seeds e repetição integral de estado e crônica na seed 42. A regra de repouso terminou com 174 pessoas vivas e 15 mortes por fome; o replay sem essa regra terminou com 179 pessoas vivas e também 15 mortes por fome. A sobrevivência agregada foi pior com repouso: 31 mortes humanas contra 26. As reservas médias finais foram maiores sem a regra em todas as seeds, e a exposição abaixo de 20 também foi menor sem ela em todas as seeds. Em contrapartida, o repouso concluiu mais cultivo: 66.407,60 unidades colhidas contra 55.940,78. Os estoques comunitários terminaram zerados nos dois regimes.

| Seed | Pessoas vivas (repouso / sem repouso) | Mortes por fome (repouso / sem repouso) | Reserva adulta média (repouso / sem repouso) | Dias-adulto abaixo de 20% (repouso / sem repouso) |
|---:|---:|---:|---:|---:|
| 1 | 38 / 43 | 6 / 5 | 22,13 / 35,61 | 60,74% / 37,40% |
| 42 | 39 / 37 | 5 / 10 | 24,14 / 32,59 | 57,59% / 43,19% |
| 987 | 47 / 49 | 4 / 0 | 37,38 / 45,64 | 29,98% / 15,71% |
| 2026 | 50 / 50 | 0 / 0 | 42,63 / 52,43 | 19,34% / 7,07% |

Rejeitei a regra de repouso: o aumento de cultivo não compensa mais mortes totais e reservas piores após quatro anos. O código atual voltou à prioridade anterior. O experimento de 730 dias está em [replay-builder-energy-rest-730.json](../reports/replay-builder-energy-rest-730.json); a comparação longa sem repouso, com determinismo da seed 42, está em [replay-no-builder-energy-rest-1460.json](../reports/replay-no-builder-energy-rest-1460.json), e a variante de repouso em [replay-builder-energy-rest-1460.json](../reports/replay-builder-energy-rest-1460.json). O buffer de 20 e os ajustes de retorno energético também foram rejeitados; seus relatórios permanecem preservados.

### Diagnóstico de energia no horizonte de quatro anos — seed 42

O diagnóstico estendido contou 51.963 dias-adulto: energia média 9,40, reserva média 32,59, energia abaixo de 27 em 87,4% dos dias e reserva abaixo de 20 em 43,19%. Em 13.308 dias-adulto, a reserva estava ≤8 e a energia ≤2. A ação `forage` ocupou 39.982 dias-adulto e perdeu em média 0,32 energia/dia; `rest` recuperou 1,92 energia/dia em 7.171 dias-adulto. A fazenda que ficou em 31/34 teve progresso pela última vez no dia 763; no dia 1.460 já não havia adultos a até 14 células dela. Isso aponta para um ciclo de exaustão e falta de trabalhadores acessíveis, não para perda contábil de reservas. O diagnóstico não demonstra que aumentar o repouso ou o retorno da coleta resolva a mortalidade; as duas variantes foram rejeitadas no horizonte longo.

Relatório: [diagnose-energy-budget-seed42-default-1460.json](../reports/diagnose-energy-budget-seed42-default-1460.json). Gerado com `ENERGY_BUDGET_DAYS=1460` e o layout padrão.

Testei reduzir de 35 para 28 pontos o limite de reserva pessoal antes de direcionar uma coleta estratégica ao estoque comum. O resultado foi idêntico ao baseline nas seeds 1 e 42; o estoque comum continuou zerado nas quatro. A seed 987 teve menos exposição a reservas baixas, mas colheu menos alimento cultivado (4.479,60 contra 6.301,35) e registrou uma batalha adicional; a seed 2026 também colheu um pouco menos e teve exposição ligeiramente maior. Rejeitei e reverti o limite 28. Relatório: [replay-community-forage-threshold28-730.json](../reports/replay-community-forage-threshold28-730.json).

Também alinhei temporariamente o raio de elegibilidade da delegação comunitária de cinco para oito células, igual ao raio usado pela ação de forragear. No replay de 730 dias, população e mortes ficaram iguais ao baseline, mas o alimento cultivado caiu de 23.991,89 para 21.144,40 e os estoques comunitários continuaram zerados. A reserva abaixo de 20 melhorou nas seeds 1 e 987, piorou em 42 e 2026; 987 teve uma campanha adicional. Reverti o ajuste por não trazer ganho consistente. Relatório: [replay-community-forage-radius8-730.json](../reports/replay-community-forage-radius8-730.json).

## Ração emergencial de alimento carregado — experimento em quatro anos — 24/10/2026

O diagnóstico da trajetória dos óbitos não encontrou um travamento geral de movimento: os adultos que morreram de fome ainda mudavam de posição e coletavam em parte dos últimos 60 dias. A falha observável era mais direta: 7 dos 12 adultos mortos por fome carregavam de 2,8 a 3,62 unidades de alimento no dia da morte, enquanto o estoque comunitário estava vazio. A carga era comida já colhida, mas só podia alimentar a comunidade depois da entrega.

Adicionei uma regra emergencial depois da tentativa de refeição comunitária e antes do consumo diário. Se a reserva pessoal não cobre a ração daquele dia, a pessoa consome apenas a quantidade necessária de `carriedFood`, convertida pela taxa canônica de 0,72. A operação registra a baixa do inventário e a entrada na reserva pessoal. As cargas permanecem destinadas ao estoque comum quando a reserva diária já está coberta.

Comparei o controle sem essa regra e a variante em 1.460 dias nas quatro seeds. A regra reduziu as mortes por fome de 15 para 4 e elevou a população viva agregada de 179 para 189. Não alterou as mortes nem a população nas seeds 987 e 2026, que não tinham mortes por fome no controle. Os quatro replays consumiram 364,32 unidades carregadas como ração emergencial.

| Seed | Pessoas vivas (controle → variante) | Mortes por fome (controle → variante) | Mortes totais (controle → variante) | Alimento carregado consumido |
|---:|---:|---:|---:|---:|
| 1 | 43 → 46 | 5 → 2 | 9 → 4 | 116,50 |
| 42 | 37 → 44 | 10 → 2 | 14 → 7 | 165,09 |
| 987 | 49 → 49 | 0 → 0 | 2 → 2 | 47,12 |
| 2026 | 50 → 50 | 0 → 0 | 1 → 1 | 35,61 |
| **Total** | **179 → 189** | **15 → 4** | **26 → 14** | **364,32** |

A regra fica mantida no código após esse resultado pareado. A seed 42 foi repetida por 1.460 dias e reproduziu o estado completo do mundo e a trilha causal. O replay atual registrou 215 episódios de ração emergencial nas quatro seeds. O inspetor individual agora mostra alimento carregado destinado ao estoque comum; a crônica registra o início de cada episódio sem repetir o evento diariamente, e `lastLesson` explica a conversão para a ração.

| Seed | Estoque comum (controle → variante) | Colheita vegetal (controle → variante) | Colheita cultivada (controle → variante) | Dias-adulto com reserva abaixo de 20 (controle → variante) |
|---:|---:|---:|---:|---:|
| 1 | 3,06 → 0,00 | 65.006,51 → 68.355,76 | 15.216,34 → 9.746,09 | 37,40% → 31,06% |
| 42 | 0,00 → 1,21 | 58.397,10 → 62.984,37 | 2.467,19 → 4.848,53 | 43,19% → 40,78% |
| 987 | 0,00 → 9,68 | 66.071,91 → 67.278,95 | 14.915,50 → 15.014,66 | 15,71% → 10,03% |
| 2026 | 0,00 → 0,00 | 70.817,52 → 70.883,58 | 23.341,75 → 22.656,51 | 7,07% → 7,16% |
| **Total / comparação** | **3,06 → 10,89** | **260.293,04 → 269.502,66** | **55.940,78 → 52.265,79** | **queda em três seeds; leve alta em 2026** |

O efeito econômico tem uma troca clara: a colheita vegetal subiu 9.209,62 unidades, enquanto a colheita cultivada caiu 3.674,99 (6,57%). A biomassa vegetal humana no fim caiu de 520.767,57 para 513.943,57 (−6.824,00); o estoque comunitário agregado aumentou 7,83, mas segue baixo e terminou zerado nas seeds 1 e 2026. A exposição a reservas abaixo de 20 melhorou em três seeds e piorou ligeiramente na 2026. Portanto, a ração reduz mortes sem provar uma economia sustentável de longo prazo; M3 continua aberto para recuperar a produção cultivada e alimentar estoques comunitários estáveis.

A regressão cobre débito limitado da carga, registro no razão e observabilidade da decisão. `npm test` passou com 154/154 e `npm run build` compilou 61 módulos. Relatório canônico pareado: [replay-carried-food-emergency-1460.json](../reports/replay-carried-food-emergency-1460.json). Implementação: `src/simulation/individuals/actions.js`, `src/simulation/economy/inventories.js` e `src/ui/game.js`. Relatórios diagnósticos complementares: [trajetórias do controle](../reports/diagnose-starvation-causes-trajectories-seeds1-42-1460.json), [variante seeds 1 e 42](../reports/diagnose-starvation-carried-food-policy-seeds1-42-1460.json), [variante seeds 987 e 2026](../reports/diagnose-starvation-carried-food-policy-seeds987-2026-1460.json) e [replay determinístico da seed 42](../reports/diagnose-starvation-carried-food-policy-seed42-replay-1460.json).

## Elegibilidade de construtores com deslocamento pendente — 24/10/2026

A governança do reino roda depois das decisões individuais. Ao se deslocar para uma obra, a pessoa recebe `buildCooldown = 2`; o valor cai antes de cada próxima decisão diária. O filtro de delegação estratégica exigia cooldown zero e, por isso, registrava “nenhum trabalhador disponível” mesmo quando havia um adulto seguro a caminho. Alinhei a elegibilidade com o caminho de reserva de obras financiadas, que já tolerava cooldown até 2, e cobri esse estado com uma regressão.

No cenário padrão seed 42, Valedouro delegou a obra no dia 720, manteve o trabalhador em aproximação no dia 728 e concluiu a roça após o deslocamento; a crônica estratégica registrou a conclusão no dia 730 e o estado já não tinha roça pendente no dia 736. O diagnóstico que termina exatamente em 730 dias ainda mostra 33/34, então esse limite curto não comprova a conclusão por si só.

O replay de quatro anos, comparado ao replay com a ração emergencial antes desta correção, não mostrou ganho consistente de sustentabilidade: o estoque comunitário agregado continuou em 10,89. Só a seed 1 mudou. Nela, a população viva caiu de 46 para 44, as mortes por fome caíram de 2 para 1, as mortes por ferimentos subiram de 2 para 5 e a colheita cultivada aumentou de 9.746,09 para 10.882,48. As outras três seeds permaneceram iguais. No total, a população viva passou de 189 para 187, mortes humanas de 14 para 16 e colheita cultivada de 52.265,79 para 53.402,18. O replay não fornece evidência causal para atribuir os óbitos por ferimentos à delegação; o resultado é uma regressão correlacionada que requer investigação.

A repetição da seed 1 e a da seed 42 reproduziram estado integral e eventos causais. `npm test` passou com 154/154; `npm run build` compilou 61 módulos. M3 permanece aberto: a atribuição agora permite que a obra prossiga, mas o fluxo alimentar comunitário continua sem estoque estável e o efeito populacional multissemente não melhorou. Relatórios: [matriz de quatro seeds](../reports/replay-build-cooldown2-1460.json), [repetição verificável da seed 1](../reports/replay-build-cooldown2-seed1-repeat-1460.json), [diagnóstico com filtro antigo, cooldown 1](../reports/diagnose-economy-default-seed42-730-cooldown1.jsonl), [diagnóstico com filtro corrigido, cooldown 2](../reports/diagnose-economy-default-seed42-730-cooldown2.jsonl) e [orçamento de energia antes da correção](../reports/diagnose-energy-budget-default-seed42-730-cooldown1.json).

## Causas concorrentes nos óbitos classificados como ferimento — seed 1

O diagnóstico de 1.460 dias encontrou cinco óbitos classificados como `injury` na seed 1. Pelo menos um trajeto mostra perdas sucessivas em disputas por alimento: Jaci Y recuou ferido nos dias 1275 e 1276 e morreu no dia 1280 com lesão 86,4. Outro, Nilo H, morreu com reserva 0, hidratação 7,68 e lesão 5,88. O código escolhe `injury` quando a lesão passa de 4 e a saúde fica abaixo de 15 antes de verificar desidratação ou fome. Portanto, a contagem de mortes por ferimento também pode incluir pessoas em crise alimentar/hídrica; a causa única não separa contribuições concorrentes.

As reivindicações de manchas de alimento são limpas diariamente em `updatePeople`, e a prevenção `contestedResources` bloqueia apenas uma segunda resolução na mesma célula durante aquele dia. Isso permite disputas em dias sucessivos enquanto os grupos continuam sobrepondo suas buscas. Esse mecanismo e a classificação exclusiva dos óbitos precisam de avaliação conjunta; não atribuo os três óbitos adicionais por ferimento da seed 1 à correção de construção. Diagnóstico completo: [trajetórias das mortes na seed 1](../reports/diagnose-society-deaths-cooldown2-seed1-1460.json).

## Trégua local após disputa por recursos — replays de quatro anos — 24/10/2026

Após um confronto, o mesmo par de comunidades agora tem uma trégua de 14 dias no mesmo tipo de recurso e na mesma mancha. O prazo não cobre outros locais e a disputa pode voltar quando ele termina. A regressão confirma que uma nova tentativa no dia seguinte não aumenta lesões, outra mancha continua contestável e a área original volta a gerar confronto após a expiração.

Comparado ao replay de 1.460 dias com cooldown 2 para construção e sem trégua, o efeito se concentrou nas seeds 1 e 42. Na seed 1, as disputas caíram de 67 para 47; as mortes humanas, de 6 para 2; os rótulos `injury`, de 5 para 1; a população viva subiu de 44 para 48 e a colheita cultivada aumentou 665,37. As mortes por fome permaneceram em 1. Na seed 42, conflitos caíram de 5 para 4, com mortalidade igual; a colheita cultivada subiu de 4.848,53 para 5.123,99. Seeds 987 e 2026 ficaram iguais.

| Medida | Sem trégua | Com trégua |
|---|---:|---:|
| Pessoas vivas, agregado | 187 | 191 |
| Mortes humanas | 16 | 12 |
| Mortes classificadas como ferimento | 7 | 3 |
| Mortes por fome | 3 | 3 |
| Disputas/conflitos | 78 | 57 |
| Colheita cultivada | 53.402,18 | 54.343,01 |
| Estoque comunitário final | 10,89 | 12,88 |

O resultado reduz conflitos e mortes por ferimento sem mudar as mortes por fome, mas o estoque comum continua quase vazio. A seed 1 também terminou com reserva média menor (34,26 → 29,36) e exposição abaixo de 20 ligeiramente maior (29,50% → 29,87%); M3 continua aberto para estabilizar o alimento e investigar causas concorrentes. Seeds 1 e 42 repetiram estado integral e eventos causais. `npm test` passou com 155/155; `npm run build` compilou 61 módulos. Relatórios: [replay multissemente](../reports/replay-resource-truce14-1460.json), [repetição da seed 42](../reports/replay-resource-truce14-seed42-repeat-1460.json). Regressão: `tests/integration/resource-conflicts.test.mjs`.

Os resultados políticos não mudaram: as quatro seeds mantiveram o mesmo número de guerras, campanhas, tratados e reivindicações territoriais. Na seed 1, os incidentes de fronteira caíram de 444 para 418 e os relatos de disputas por recursos de 62 para 39, mas o reino continuou em guerra no fim. As tentativas de saque subiram de 3 para 6 sem mudar o único sucesso. A trégua reduz dano local, mas não desescalou a guerra já ativa; M4 continua aberto para logística, custo e resolução militar de longo prazo.

## Armistício de guerra sem efetivo — replay de quatro anos — 24/10/2026

O replay anterior terminava com uma guerra ativa aguardando mobilização em cada seed. Os dois reinos haviam ficado sem soldados, e o recrutamento autônomo também não podia começar enquanto o estoque comunitário não cobrisse um dia de alimento. Agora uma guerra sem força disponível termina em armistício de status quo após 180 dias. O pedido de tropas expira junto com a guerra. Só guerras ainda ativas podem iniciar uma campanha; uma guerra já encerrada não volta a ser mobilizada quando um incidente posterior começa outra.

No replay pareado de 1.460 dias, os armistícios sem campanha resolveram 13 guerras ao longo das quatro seeds; três relações terminaram em paz e a seed 1 ainda aguardava força desde o dia 1.385. A mudança não criou batalhas nem reivindicações novas nas guerras encerradas sem efetivo, mas as disputas locais ainda provocaram novas declarações: o total passou de 16 para 26 guerras e de 12 para 25 tratados. Por isso, M4 continua aberto para reduzir a recorrência e resolver o impasse de mobilização.

| Medida agregada | Replay anterior | Com armistício após 180 dias |
|---|---:|---:|
| Pessoas vivas | 191 | 193 |
| Mortes humanas | 12 | 12 |
| Colheita cultivada | 54.343,01 | 55.045,65 |
| Estoque comunitário de alimento no fim | 12,88 | 0,00 |
| Guerras / tratados | 16 / 12 | 26 / 25 |
| Guerras ativas no fim | 4 | 1 |

O efeito variou por seed. A seed 1 terminou com três pessoas a mais, nenhuma morte humana em vez de duas e +283,54 de colheita cultivada. A seed 42 terminou com duas pessoas a menos, duas mortes adicionais classificadas como ferimento e −1.289,18 de colheita cultivada; a fome permaneceu em duas mortes. Seeds 987 e 2026 tiveram mortalidade igual ao replay anterior. Não atribuo essas diferenças populacionais exclusivamente à regra de armistício: o estado político altera as decisões posteriores, e o resultado é uma comparação pareada de trajetórias. O estoque comum agregado terminou vazio, então M3 segue aberto.

A repetição integral da seed 42 e da crônica causal foi idêntica. O teste de campanhas passou com 31/31, a suíte completa com 157/157 e `npm run build` compilou 61 módulos. Relatório: [replay de armistício sem efetivo](../reports/replay-force-wait-armistice-1460.json); regressão: `tests/integration/kingdom-campaigns.test.mjs`.

## Diagnóstico de perdas de saúde antes do óbito — 24/10/2026

Cada mudança de saúde agora registra o delta realmente aplicado e sua origem. A janela móvel mantém 30 dias de perdas por falta de alimento, desidratação, ferimentos acumulados, disputa por recurso, assalto, batalha ou cuidado dependente, além das recuperações. O evento e `person.deathDetails` guardam o resumo no óbito. A causa principal exclusiva e os valores de saúde continuam iguais; o registro mostra mecanismos concorrentes sem declarar que um deles, sozinho, causou a morte.

No replay de 1.460 dias da seed 42, foram registradas nove mortes humanas, com repetição integral de estado e crônica aprovada. Entre as quatro mortes rotuladas `injury`, duas tiveram dano de saúde por falta de alimento nos 30 dias anteriores (1,52 e 4,83 pontos); uma dessas também teve 0,62 por desidratação. Uma terceira registrou 0,54 ponto por disputa por recurso e 0,90 por ferimentos acumulados; a quarta, com reservas e água adequadas no óbito, teve 2,28 pontos por ferimentos e nenhuma outra perda registrada na janela. Assim, os quatro trajetos não justificam a mesma correção.

As duas mortes rotuladas `starvation` também tiveram mais de um fator no período: uma acumulou 1,78 ponto de perda por falta de alimento e 3,05 por desidratação; a outra, 1,81 e 1,14 por alimento e ferimentos, respectivamente. O inventário de perdas localiza fatores próximos ao óbito, mas ainda não mede toda a vida nem prova contrafactuais. Nenhum ajuste de equilíbrio foi feito com base apenas nessa associação.

A cobertura valida limites de saúde, soma de perdas, recuperação e descarte de registros após 30 dias. Teste focado de campanhas: 34/34; `npm test`: 160/160; `npm run build`: 61 módulos. Replays: [matriz vital de quatro seeds](../reports/replay-death-conditions-1460.json) e [histórico de dano da seed 42 com repetição determinística](../reports/replay-health-damage-seed42-1460.json).

## Prioridade de água em saúde crítica — 24/10/2026

Quando a saúde cai para 5 ou menos e a hidratação para 14 ou menos, a política de sobrevivência agora sobrepõe a decisão neural e escolhe beber ou migrar para uma fonte conhecida/percebida. A emergência anterior de hidratação ≤9 continua ativa mesmo sem essa condição de saúde. A regressão em `tests/integration/migration.test.mjs` confirma que um indivíduo debilitado junto a água doce escolhe beber e que a ação crítica não passa pela pontuação neural.

O traço da seed 42 encontrou Zuri O no dia 884 com saúde 3,58 e hidratação 14,02, ainda buscando alimento. No dia 885 a prioridade ativou, a pessoa bebeu de um ponto de água percebido e a hidratação passou para 32,06. No replay anterior, Zuri O morreu de fome no dia 896 com água a 8%; na matriz atual está viva e independente ao final do dia 1.460, com hidratação 75,2 e reserva alimentar 53,7. O diagnóstico focado de 1.000 dias registra a sequência em [diagnose-zuri-water-seed42-1000.json](../reports/diagnose-zuri-water-seed42-1000.json).

O replay pareado de 1.460 dias repetiu integralmente o estado e a crônica da seed 42. No conjunto das quatro seeds, mortes humanas passaram de 12 para 13 e pessoas vivas de 193 para 192; toda a diferença observada ficou na seed 42 (9→10 mortes, com ferimentos 4→5 e fome permanecendo em 2). A reserva média adulta na seed 42 caiu de 28,33 para 25,49, e o estoque comunitário terminou em zero nos dois regimes. Como a mudança de decisões individuais desloca a trajetória subsequente, não atribuo a morte adicional à política de água. O resultado sustenta o resgate deste caso, mas não demonstra melhoria agregada nem resolve a escassez alimentar de M3. M3 continua aberto; M4 também segue aberto para acompanhar as consequências de sobrevivência nas campanhas.

O teste focado e a suíte completa passaram com 161/161; `npm run build` compilou 61 módulos. Arquivos: [replay da prioridade de água, quatro seeds](../reports/replay-critical-hydration-1460.json) e [diagnóstico individual de Zuri O](../reports/diagnose-zuri-water-seed42-1000.json).

## Delegação urgente abaixo do limite de energia — experimento rejeitado — 24/10/2026

O relatório de bloqueio identificou adultos que percebiam alimento a até cinco células, mas não recebiam a coleta urgente por estarem abaixo do limite estratégico de energia 14. Experimentei delegar nessas condições somente quando nenhum trabalhador com energia suficiente estava disponível, aceitando energia acima de 8 e preservando os limites de hidratação, saúde e reserva alimentar já usados pela política individual. Uma regressão cobriu a precedência do trabalhador seguro e a elegibilidade do último recurso.

No replay pareado de 1.460 dias nas seeds 1/42/987/2026, o último recurso foi acionado 1.421 vezes. O total de pessoas vivas subiu de 192 para 194, as mortes humanas ficaram em 13, a colheita cultivada aumentou de 55.110,28 para 59.355,39 e os estoques comunitários finais de alimento passaram de zero para 257,76. Porém, a exposição adulta a reservas abaixo de 20 aumentou em todas as seeds; ponderada pelos dias-adulto, passou de 22,60% para 25,92%. A reserva média final também caiu nas quatro seeds, e as mortes por fome na seed 42 passaram de duas para três. A mudança desloca trabalho para coleta comum, mas cobra uma deterioração consistente da margem alimentar pessoal; por isso, removi a delegação abaixo de 14 e mantive somente o diagnóstico do bloqueio.

A seed 42 repetiu estado completo e eventos causais dentro do experimento. Após restaurar o limite, o resumo de gameplay coincidiu com o replay de controle; a crônica difere apenas porque agora explica quando `8 < energia < 14` e há alimento percebido. Teste focado: 19/19; suíte: 163/163; `npm run build`: 61 módulos. Artefatos: [replay do experimento rejeitado](../reports/replay-urgent-community-forage-energy8-1460.json), [replay da seed 42 após restaurar a política](../reports/replay-forage-cutoff-restored-seed42-1460.json) e [replay de controle](../reports/replay-critical-hydration-1460.json). M3 continua aberto: o próximo ajuste deve melhorar o abastecimento comum sem piorar a exposição às reservas pessoais.

## Última opção de coleta protegida — experimento rejeitado — 24/10/2026

Refinei a exceção anterior para permitir, no máximo, uma delegação de energia baixa por ciclo e somente quando a pessoa já tinha reserva acima de 35, hidratação de pelo menos 28 e saúde de pelo menos 45. O estoque comum só recebe a carga inteira para o reino quando a reserva pessoal supera 35; a condição evitava designar quem ainda precisava recompor a própria reserva.

No replay de 1.460 dias nas quatro seeds, ainda houve regressão: pessoas vivas 192→190, mortes humanas 13→15 e mortes por fome 2→3. A exposição ponderada abaixo de 20 melhorou ligeiramente, 22,60%→21,99%, mas a colheita cultivada caiu de 55.110,28 para 54.560,46 e o estoque comunitário terminou com apenas 8,62 unidades. A política foi removida; continuam somente o limite original e o diagnóstico de alimento percebido abaixo da energia 14. A seed 42 repetiu estado e crônica causal. Relatório: [replay da exceção protegida](../reports/replay-urgent-forage-protected-energy8-1460.json). M3 permanece aberto.

## Fatores sazonais de crescimento — replays de quatro anos — 24/10/2026

`PLANTS` já definia multiplicadores por estação para raízes cultivadas e brotos, mas a regeneração semanal os ignorava. Agora o ciclo de plantas aplica o multiplicador da estação corrente quando a espécie o declara; frutos sem dado sazonal mantêm a taxa existente. Isso conecta o calendário do mundo à produção agrícola e à pastagem, sem alterar a política de trabalho ou a seleção dos indivíduos. O teste compara primavera e inverno e confirma os fatores de raízes/brotos e a neutralidade das berries.

| Medida agregada | Código anterior | Com fatores sazonais |
| -- | --: | --: |
| Pessoas vivas no fim | 192 | 190 |
| Mortes humanas | 13 | 13 |
| Mortes por fome | 2 | 4 |
| Colheita cultivada | 55.110,28 | 54.469,19 |
| Regeneração cultivada | 74.329,16 | 71.292,29 |
| Estoque comunitário final | 0,00 | 9,70 |
| Dias-adulto abaixo de 20, ponderados | 22,60% | 22,74% |

O efeito variou por semente: a seed 42 terminou com seis mortes a menos e nenhuma por fome; a seed 1 terminou com sete mortes humanas contra zero no controle, quatro por fome. A seed 2026 também aumentou a exposição abaixo de 20 de 6,27% para 12,31%. O agregado não demonstra melhoria de sobrevivência nem de sustentabilidade, mas confirma que os multiplicadores sazonais agora alteram a trajetória. Mantive o uso dos dados de domínio configurados e registrei o custo para a validação futura de reservas de inverno; não atribuo causalidade direta às diferenças de mortes entre trajetórias.

A seed 42 reproduziu estado completo e eventos causais. O teste de ecologia passou com 44/44 antes da suíte final. Relatório: [replay sazonal de quatro anos](../reports/replay-seasonal-regrowth-1460.json). M3 continua aberto: o estoque comum não se estabilizou e a nova pressão de fome precisa entrar na avaliação de armazenamento e produção.

## Área das roças — configuração de 200 habitantes e 35 soldados por reino — 24/10/2026

No início desta comparação, a geração usava 200 habitantes (100 em cada reino) e 35 soldados por reino. Replays anteriores com 50 habitantes são de outro checkpoint. Comparei a primeira roça com raio de seleção 2,9 e 3,35 células por 730 dias nas seeds 1, 42, 987 e 2026; a seed 42 repetiu o estado completo e os eventos causais nos dois lados. Depois, a guarnição inicial foi ampliada para 43 soldados por reino, com oito arqueiros; essa mudança posterior não está isolada nestes dois replays.

| Medida agregada | Raio 2,9 | Raio 3,35 |
| -- | --: | --: |
| Pessoas vivas no fim | 549 | 789 |
| Mortes humanas | 262 | 22 |
| Mortes por fome | 223 | 1 |
| Colheita vegetal total | 359.764,91 | 376.975,17 |
| Colheita cultivada | 48.806,20 | 48.987,36 |
| Estoque comunitário final | 0 | 0 |
| Dias-adulto abaixo de reserva 20, ponderados | 47,95% | 54,27% |

Com raio 3,35, os campos construídos tiveram de 25 a 32 células, contra 17 a 23 com 2,9. As quatro seeds tiveram menos mortes por fome, mas a colheita cultivada agregada cresceu só 181,16 e o estoque comum continuou zerado. A exposição ponderada abaixo de reserva 20 piorou 6,32 pontos percentuais. A escolha do terreno também muda a localização da roça e desloca disputas, construção e decisões militares; por isso, a redução da mortalidade é uma associação observada no replay pareado, não uma prova de que a área maior, isoladamente, a causou.

Mantive o raio 3,35 provisoriamente, pois a redução de mortes por fome apareceu nas quatro seeds e não exigiu liberar trabalhadores abaixo dos limites de sobrevivência. A variante de 43 soldados por reino ainda precisa de replays pareados. M3 continua aberto: é preciso recuperar as reservas pessoais e formar estoque comunitário persistente. Relatórios: [controle com raio 2,9](../reports/replay-pop200-field29-730.json) e [variante com raio 3,35](../reports/replay-pop200-field335-730.json).

## Dano, destruição e saque de estruturas — 24/10/2026

Torres fortificadas começam com 6.000 pontos de vida; postos avançados, com 4.000, e uma obra de torre inicia com 25% da vida máxima. A campanha usa alcance e dano por classe: guerreiros 24 a 3,8 células, lanceiros 18 a 4,5 e arqueiros 12 a 9; ataques respeitam vida mínima e intervalo de dois dias. O objetivo passa a ser danificado durante o cerco, e a destruição remove cobertura territorial, guarnição e vínculos de moradia. A obra destruída não reinicia sem um novo projeto pago.

O estoque elegível da estrutura destruída vira um monte público uma única vez. Pessoas próximas podem recolher até 24 unidades carregadas, com comida priorizada quando a reserva pessoal está baixa. O teste focado cobriu vida inicial, alcance/dano, objetivo intacto sob cerco, remoção territorial, bloqueio de reconstrução, defesa dos soldados e saque sem duplicação: 8/8 aprovados. Na primeira validação desta mecânica, a suíte passou com 194/194 e o build compilou 68 módulos; a validação posterior do sistema de captura está registrada na seção mais recente abaixo.

Os relatórios de área agrícola e baseline anteriores não incluem vida de estruturas e saque. O replay de quatro seeds descrito a seguir começou no checkpoint de 18:47, antes das atualizações de captura e construção das 18:53–18:57; a leitura mais recente está na seção final.

## Replay de quatro seeds no checkpoint pré-captura de 18:47 — 24/10/2026

Rodei quatro replays de 730 dias com a geração de 200 habitantes e a guarnição atual, nas seeds 1, 42, 987 e 2026. Foram 59 campanhas e cinco destruições de torre registradas: uma nas seeds 1, 42 e 987, e duas na 2026. A seed 42 repetiu o estado completo e os eventos causais. O total foi de 18 mortes em combate e uma por fome; a colheita cultivada somou 101.232,01, mas todas as comunidades terminaram com estoque de alimento zero. A exposição adulta ponderada abaixo de reserva 20 ficou em 54,65% dos dias-adulto. O relatório não registra a quantidade de saque efetivamente recolhida ao longo do replay, então os testes controlados sustentam a transferência única e o limite de carga, enquanto a frequência de coleta em partida continua aberta.

O baseline atual do seed 42, no mapa 128×128 com 202 entidades residentes e 44 estruturas, mediu mediana de 4,55 dias/s no motor síncrono e 3,64 dias/s no caminho Worker simulado. O snapshot Worker serializado foi de 3.580.324 bytes. As amostras medem runtime Node, clonagem/transferência e hidratação; não incluem renderização ou FPS. Relatórios: [replay atual de 730 dias](../reports/replay-structure-siege-730-20261024.json), [baseline síncrono](../reports/baseline-pop200-siege.json) e [baseline Worker](../reports/worker-baseline-pop200-siege.json).

M4 continua In Progress: os cercos já destroem torres em partidas longas, mas a consequente mudança territorial e a coleta do saque precisam de análise mais detalhada. M3 permanece aberto porque os estoques comuns acabaram zerados e as reservas pessoais passaram grande parte do replay abaixo de 20.

## Captura territorial — replay da revisão mais recente — 24/10/2026

Após as mudanças de construção e ordens de captura, `npm test` passou com 212/212 e `npm run build` compilou 72 módulos. No seed 42, o replay de 730 dias repetiu estado completo e eventos causais. Terminou com 194 pessoas vivas e 9 mortes (8 em combate, 1 por ferimento), após 15 campanhas: 13 vitórias defensoras e 2 negociações. Não houve destruição de torre nem transferência territorial nessa seed. Estoque de alimento comunitário: 0; colheita cultivada: 2.220,83; reserva pessoal média: 20,97; exposição abaixo de 20: 54,26%. Esse resultado de uma seed não estima a taxa geral de conquista, mas mostra que a captura não ocorre automaticamente em toda guerra; M4 segue aberto para verificar campanhas que realmente transferem território.

O par de desempenho foi medido no mesmo checkpoint, em 128×128 com 202 residentes e 43 estruturas: motor síncrono, mediana 6,10 dias/s (5,95 / 6,31 / 6,10); caminho Worker simulado, mediana 4,50 (4,42 / 4,50 / 4,52). O snapshot serializado Worker foi de 3.580.324 bytes. São amostras Node sem renderização/FPS e sem comparação causal com medições antigas. M3 continua aberto pela falta de alimento comunitário e pela exposição prolongada a reservas baixas. Relatórios: [seed 42 atual](../reports/replay-current-siege-capture-seed42-730-20261024.json), [baseline síncrono](../reports/baseline-capture-current-20261024.json) e [baseline Worker](../reports/worker-baseline-capture-current-20261024.json).

## Intervalo de recuperação entre conflitos — 24/10/2026

A pressão territorial respeita `nextTowerRaidDay`; cada armistício agenda a próxima campanha autônoma para pelo menos 90 dias depois da resolução. Antes, a tensão das torres ignorava esse intervalo e reiniciava campanhas logo após os 30 dias de cessar-fogo. O teste de regressão cobre o bloqueio até a data e o retorno da mobilização quando ela chega.

O seed 42, em replay pareado e determinístico de 730 dias, registrou 6 campanhas contra 15 no replay anterior deste checkpoint, incluindo 4 ordens de captura. Nenhuma campanha mudou o território. O resultado permaneceu limitado por suprimentos: uma captura começou com 45 soldados, 0 alimento no tesouro/comunidade e reserva média de 4,6; recuou antes de chegar à torre. A seed terminou com 189 pessoas vivas, 4 mortes por fome, 8 em combate, 1 por ferimento, estoque comunitário zero e exposição abaixo de 20 pontos em 56,25% dos dias-adulto. Como é uma seed e M3 ainda tem déficit alimentar, isso não demonstra melhoria geral nem uma taxa de conquista.

Validação: teste focado 8/8; suíte `npm test` 213/213; `npm run build` compilou 72 módulos. M4 continua aberto para preparar campanhas com logística suficiente e observar transferência territorial real; M3 continua aberto pela escassez. Relatório: [replay pareado com intervalo de recuperação](../reports/replay-frontier-cooldown-seed42-730-20261024.json).

## Orçamento de ração antes da campanha autônoma — 24/10/2026

Antes de mobilizar, campanhas autônomas agora verificam se as reservas pessoais da tropa, a comida do tesouro e o excedente comunitário acima de dois dias de demanda civil cobrem 18 dias de ração. Sem orçamento, a guerra fica em `awaiting-supplies`: soldados não são retirados dos postos e nenhum recurso é debitado. A tentativa é reavaliada enquanto a economia produz alimento; após 180 dias sem provisões, o conflito termina em armistício sem mudança territorial. A ordem real de captura define `forceMobilization` e pode ultrapassar essa trava.

No replay pareado determinístico de 730 dias da seed 42 houve 3 guerras registradas, mas apenas 1 campanha mobilizada: a incursão de construção da torre durou até o dia 179, teve 57 batalhas e terminou em vitória defensora. Duas ordens posteriores de captura permaneceram sem ração e encerraram em armistício após 180 dias. Não houve transferência territorial. A população terminou em 193: 8 mortes em combate, 1 por ferimento e nenhuma por fome. O estoque comunitário terminou zerado, a colheita cultivada foi 9.442,40, e a exposição adulta abaixo de 20 pontos foi 59,15%. Uma seed não estima taxa geral de conquista; ela demonstra que a mobilização sem logística foi bloqueada, enquanto a escassez alimentar ainda impede capturas autônomas nesta trajetória.

Validação final: `npm test` 216/216; `npm run build` compilou 72 módulos. M4 segue aberto para dar suporte alimentar à logística e validar uma transferência territorial em replay; M3 segue aberto por estoque compartilhado nulo e exposição alta a reservas baixas. Relatório: [replay de logística e captura](../reports/replay-frontier-logistics-seed42-730-20261024.json).

## Replay econômico após serviço militar em paz — 24/10/2026

Quatro seeds (1, 42, 987 e 2026) foram executadas por 730 dias no workspace após a regra que mantém soldados em serviço e os envia ao centro militar para recuperação. A comparação integral de estado e crônica causal da seed 42 passou. Não houve mortes por fome nem desidratação. As mortes foram 18 em combate e uma por ferimento; a população viva ao final ficou entre 195 e 203.

A sobrevivência não representa reservas estáveis: a média individual adulta ao fim variou entre 9,09 e 14,99 pontos, com mínimo zero em todas as seeds. Entre 49,17% e 55,16% dos dias-adulto tiveram reserva abaixo de 20; entre 36,03% e 42,86% ficaram zerados. Duas roças foram concluídas em cada seed, mas os estoques comunitários de comida e os tesouros terminaram zerados. Os reinos priorizaram `secure-shared-food`; não houve saques. M3 segue aberto por reserva baixa recorrente e fluxo compartilhado sem estoque acumulado.

O mesmo replay confirma a regra salarial atual: `MILITARY_PAY` paga 15 ouros a cada 30 dias (0,5 ouro/dia por soldado). Com 43 soldados por reino, isso equivale a 645 ouros por reino a cada 30 dias, antes de recrutas e variação de efetivo. A sugestão de 1 ouro por dia equivaleria a 30 por mês por soldado, dobrando o custo atual; a redução desejada precisa ser definida na mesma unidade. O salário não foi alterado neste checkpoint; a tela de inspeção agora mostra também o equivalente de 0,5 ouro por dia.

Relatório integral: [replay econômico e serviço militar, 730 dias](../reports/current-replay-military-peace-730-20261024.json). Resultado pareado verificado apenas na seed 42.
