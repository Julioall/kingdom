# Combate por contato — implementação inicial

Implementado em 25/10/2026, sem integração de áudio.

## Comportamento

- `kingdoms/combat-contact.js` define corpos, volumes de armas, guarda frontal, trajetória de flecha e marcadores de tempo em coordenadas da simulação. Esses volumes são separados dos contornos de navegação.
- Guerreiro varre a lâmina; lanceiro acerta com a ponta; arqueiro libera a flecha aos 500 ms e verifica o segmento percorrido. A mira é fixada ao preparar a ação. Flechas não seguem automaticamente um alvo que esquiva.
- A guarda do guerreiro usa um volume frontal deslocado do corpo; a do lanceiro intercepta golpes corpo a corpo. Armas cruzadas fora de guarda não geram aparo. A defesa conserva 30% do dano como configuração inicial de balanceamento.
- A decisão de tentar esquivar ainda usa os atributos e o RNG da simulação. O deslocamento ocorre durante a preparação, por um caminho curto aprovado pela navegação; só a geometria decide se houve contato. A decisão de entrar em guarda também continua probabilística, limitada pela direção e pela classe.
- Somente inimigos vivos e fora de abrigos entram na consulta. O primeiro contato encerra o golpe. Não há dano em área nem fogo amigo. Espada e lança no chão não acertam ocupantes montados na torre. Flechas verificam também a altura interpolada de voo.
- As ações têm IDs próprios, alvo pretendido, vítima efetiva, marcadores, ponto, normal, dano aplicado e morte. O histórico limita-se às últimas 128 ações e não consome IDs econômicos nem sorteios de apresentação.
- O dano confirmado incrementa a sequência da vítima uma única vez. Erros não registram impacto. Resolver novamente a mesma ação não repete dano.
- Cerco passa pelo mesmo resolvedor, preservando dano por classe, limite de captura, destruição e saque. A cadência mínima de dois dias e o gasto de estamina continuam valendo.
- Animações usam o ID da ação. Lanceiros preparam com guarda; arqueiros completam o disparo. Flechas e partículas aguardam seus marcadores. A apresentação pausa e acompanha as velocidades 1×/2×/3×. Reset limpa efeitos agendados; avanço de vários dias descarta a apresentação de dias antigos.

## Limite arquitetural desta entrega

A resolução é síncrona por ação, com consultas em subpassos de 1/30 s e varredura adicional da espada. A esquiva pode se mover nesses subpassos. Campanhas ainda recebem o resultado completo dentro da rodada diária, mantendo sua contabilidade de baixas e abastecimento.

Isso **não implementa ainda o relógio contínuo compartilhado** proposto em `combat-collision-research.md`. Ataques dos dois lados continuam sendo processados pela ordem tática existente. Não existe interrupção por um golpe concorrente no meio da preparação de outra ação. A regra de morte após o disparo foi validada no resolvedor, mas a campanha não intercala dois atacantes em uma mesma linha de tempo.

O estado de vida, morte e as barras de dano chegam no snapshot diário, antes da reprodução visual do contato. Somente animação, flecha e partícula têm apresentação temporizada nesta etapa. Corpos e estruturas destruídas ainda não têm apresentação de morte retardada. Portanto, esta entrega não deve ser declarada como conclusão de todos os pré-requisitos do áudio.

Os perfis iniciais de corpo/arma/guarda e o raio de construção precisam de calibração artística e balanceamento. A consulta de projéteis considera os candidatos inimigos da rodada; árvores e construções intermediárias ainda não obstruem o voo. Não há nova mecânica de mineração nesta alteração.

## Arena de diagnóstico

Com o Vite em execução, abrir `/combat-lab.html`. A arena usa os mesmos módulos de contato e catálogo de animações do jogo, com sprites reais. Permite escolher espada, lança ou arco e testar frente, costas, corpo, guarda com lança, esquiva, plataforma de torre e alcance. O controle de tempo mostra preparação, arma e ponto de impacto.

## Verificação

- Testes de `combat-contact.test.mjs`: frente/costas, guarda ativa, varredura, esquiva dinâmica, altura, interceptação, alcance, cancelamento, flecha após morte, deduplicação, histórico limitado e apresentação por marcadores.
- Teste de apoio ao aliado atualizado: um impacto confirmado; um inimigo mais próximo fica fora da trajetória inicial, permitindo verificar a seleção do agressor do aliado sem atravessar outro corpo.
- Build de produção e testes de cerco, captura, cura, animações e formações.
- Resultado final direcionado: 48 testes aprovados (43 de contatos/cura/cerco/captura/animações/formações e 5 de recursos de combate). A suíte geral anterior à atualização da expectativa de apoio teve 319/324 aprovados; a falha de apoio foi corrigida e revalidada, restando as quatro falhas independentes descritas abaixo.
- Conferência visual da arena com espada e arco e inicialização do jogo com Worker.
- A suíte geral apresentou quatro falhas independentes desta mudança: duas expectativas de entrada de torre usam coordenadas anteriores ao deslocamento do perfil; duas de retirada/descanso de campanha falham sem nenhuma ação do novo combate ter sido executada. Diagnóstico destas últimas em `reports/combat-campaign-diagnostics.txt`.
