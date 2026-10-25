# Serviço militar e animações

Ao concluir o treinamento (ou no recrutamento imediato da população inicial), o morador assume a classe selecionada: infantaria, lanceiro, arqueiro ou clérigo. Arquearia e monastério completos são pré-requisitos para os especialistas. Cada centro militar comporta 60 militares. A promoção remove a atribuição civil e a amostra de aprendizado pendente, devolve os recursos carregados ao estoque comunitário e libera a ovelha conduzida. Soldados não escolhem trabalhos civis pela política neural: cumprem campanha, patrulha ou guarda e recuperam água, energia e saúde. A busca emergencial por alimento continua possível quando a sobrevivência está ameaçada.

O rei paga 15 ouro a cada 30 dias de serviço, começando na promoção. O débito sai do tesouro e entra na carteira pessoal; o soldado compra sua ração diária no mercado ao preço vigente. Rações de campanha continuam sendo usadas primeiro. Falta de ouro gera atraso, quitado conforme o tesouro recupera saldo, sem criar moeda. Falta de saldo ou alimento pode comprometer a manutenção do soldado. A inspeção individual mostra saldo, atraso e próxima data.

## Mapeamento Tiny Swords

O manifesto executável está em `src/ui/military-sprites.js`. As imagens são copiadas do pacote local para `public/assets/tiny-swords/military/{palette}/{unit}/`, nas cinco cores: blue, red, purple, yellow e black. Quadros são horizontais, uma linha, a 100 ms por quadro. Espelhamento cobre o lado esquerdo e a última direção de movimento é preservada ao parar.

| Classe | Unidade | Quadros | Ações disponíveis |
| --- | --- | --- | --- |
| Lanceiro | Lancer | 320 × 320 | Idle (12), Run (6), Attack (3) e Defence (6) em Up, UpRight, Right, DownRight e Down |
| Guerreiro | Warrior | 192 × 192 | Idle (8), Run (6), Attack1 (4), Attack2 (4), Guard (6) |
| Arqueiro | Archer | 192 × 192 | Idle (6), Run (4), Shoot (8) |
| Monge | Monk | 192 × 192 | Idle (6), Run (4), Heal (11) |

Movimento usa Run; repouso usa Idle; guarda usa Defence/Guard quando disponível. Batalhas registram ataques, defesas, esquivas e curas por indivíduo, com alcance e alvo observados. A variante direcional do lanceiro segue o deslocamento. Classes sem defesa específica usam Idle. Attack2 e Heal são usados em combate e na cura de aliados. Arrow e Heal_Effect são recursos auxiliares do pacote, sem emissão de projéteis ou efeitos adicionais nesta mudança.


## População, comando e fronteiras

Cada reino começa com 50 habitantes: 10 infantes, 5 lanceiros, 4 arqueiros, 2 clérigos e os demais civis/rei. Os castelos ficam nas extremidades oeste e leste da ilha. As moradias iniciais acomodam até 104 pessoas por reino. O tesouro inicial foi ampliado para equipar, abastecer e pagar esse efetivo; todos os gastos continuam sendo debitados.

Um general organiza cada grupo de até 50 militares em unidades persistentes de até 10, com um comandante por unidade. O general e os comandantes mantêm seus cargos enquanto vivos; vagas são preenchidas por mérito (experiência de combate/cura, treinamento, prestígio e lealdade), com desempate por ID. Os seguidores acompanham seus comandantes na marcha. Baixas reorganizam a cadeia e geram eventos na crônica.

Os primeiros 45 dias protegem os reinos de guerras autônomas e abordagens de fronteira. Tropas patrulham as torres voltadas ao adversário. No dia 31 o rei pode financiar obras em solo neutro. Três trabalhadores e uma unidade de escolta seguem à torre; só há progresso com trabalhador no local e sem força inimiga próxima.

Depois da paz inicial, obras de torre podem provocar uma incursão. Torres completas também provocam campanhas recorrentes (primeira oportunidade no dia 100, intervalo de 90 dias e respeito ao armistício de 30 dias). Disputas repetidas por recursos continuam sendo outro gatilho. Campanhas existentes impedem mobilizações simultâneas dos mesmos reinos.

As trocas de ataques ocorrem a cada dois dias simulados, depois que ambos os lados reúnem suas formações: coesão mínima de 55% e pelo menos 60% das posições de frente esperadas ocupadas por soldados que não estão recuando para se recuperar. Cerco, captura e ocupação também aguardam a formação atacante. Posições de marcha e combate têm pelo menos duas células de espaçamento, com infantaria na linha de frente, lanceiros logo atrás, arqueiros na retaguarda e clérigos protegidos mais ao fundo. Enquanto se reagrupam, as tropas permanecem em marcha e não iniciam outro confronto. Infantaria avança e bloqueia; lanceiros apoiam com alcance maior; arqueiros mantêm distância e clérigos evitam contato e curam aliados. Personagens não entram em células ocupadas: podem pedir passagem a um civil livre, que se desloca para uma célula vizinha; militares em campanha, pessoas em serviço, feridas ou sem energia suficiente podem recusar. Vitalidade: 360/300/220/240 pontos, respectivamente, convertidos para a escala de saúde de 0–100 usada pela simulação. Não há sorteio de morte instantânea nos confrontos de campanha. Saúde abaixo de 28% leva ao recuo, com retorno ao combate após 60%. Ataques mostram uma barra durante cinco segundos reais; outro ataque renova esse prazo.

O encerramento depende de perdas/coesão, oito dias de desabastecimento, rota bloqueada, ocupação sem defesa durante doze dias ou resistência defensiva por 150 dias. O objetivo pode ser uma torre capturada ou uma obra interrompida definitivamente. A retirada preserva a profissão e a classe dos sobreviventes; deserção por lealdade/coerção permanece distinta. A cada doze dias, a partir do dia 24, o rei pode pagar treinamento/reposição até 10 infantes, 5 lanceiros, 4 arqueiros e 2 clérigos, usando adultos civis, vagas e recursos reais.


Clérigos priorizam a menor porcentagem de saúde entre aliados vivos, aproximam-se dos feridos e também curam fora de combate. O feitiço tem alcance de 6 células, área de 3 células centrada no ferido prioritário e intervalo de 6 dias: recupera até 24 pontos de vitalidade no alvo principal e 16 em cada outro aliado ferido na área. A saúde não ultrapassa 100%; mortos e inimigos não são curados. Cada destinatário recebe um evento de cura que aciona `Monk/Heal_Effect.png`, na própria posição visual, acompanhando seu movimento. Redesenhar a tela não repete as partículas e reiniciar o mundo limpa os efeitos.


## Torres como objetivos de cerco

Torres fortificadas possuem 6.000 pontos de vida e postos de fronteira 4.000. Canteiros começam com 25% dessa vida; cada dia de trabalho protegido reforça a estrutura. A manutenção mensal paga recupera 2% da vida máxima quando a torre passou mais de sete dias sem ataques.

As campanhas de fronteira elegem a torre como objetivo principal. Infantes e lanceiros se aproximam para golpear a estrutura; arqueiros podem atacá-la a até nove células. Clérigos mantêm seu papel de cura. Parte da força atacante concentra golpes na torre e o restante enfrenta a guarnição. Defensores priorizam interceptar os soldados que atacam a torre, e arqueiros defensivos mantêm distância.

A falta de guarnição ou de coesão não transfere uma torre intacta automaticamente. O cerco precisa esgotar sua vida ou terminar por derrota/retirada dos atacantes e pelas regras de abastecimento/tempo. A destruição deixa ruínas, remove a área de influência, libera a guarnição designada e encerra a missão em favor dos atacantes. Canteiros destruídos não recomeçam gratuitamente. A barra da torre fica visível no mapa e o inspetor exibe vida atual/máxima e o objetivo de proteger ou destruir.


## Vida das construções, saque e currais

O castelo do reino tem 10.000 pontos de vida, cada casa tem 2.000 e o curral tem 3.000. Outras construções também participam do sistema de cerco; as torres continuam prioritárias nas campanhas de fronteira. Ao serem destruídas, ficam em ruínas e deixam de fornecer seus benefícios e sua influência.

Os recursos realmente armazenados caem em uma pilha pública no local da destruição. O castelo guarda o tesouro, o mercado guarda seu estoque, a vila representa as reservas compartilhadas e o curral guarda a ração comunitária. Inventários locais de casas e outras estruturas também são esvaziados. Os registros de comida dos abrigos são debitados do estoque compartilhado, evitando duplicação. Não há reembolso automático dos materiais usados na construção.

Qualquer pessoa, de qualquer reino, pode recolher os recursos, carregando até 24 unidades por viagem. Necessidades urgentes e a missão militar continuam influenciando suas escolhas. Soldados preservam o saque carregado até a entrega. As pilhas desaparecem quando vazias e o inspetor mostra os recursos restantes.

Currais iniciais e novos canteiros de curral ficam na retaguarda, no lado oposto ao reino adversário. A seleção considera espaço livre, terreno seco em toda a área cercada e acesso sem atravessar desníveis. Ruínas podem dar lugar a uma nova obra paga, mas nunca voltam a funcionar gratuitamente.
