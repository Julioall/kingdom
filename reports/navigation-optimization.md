# Navegação: congestionamentos e rotas comuns

Data: 25/10/2026.

## Comportamento implementado

- A rota principal de uma pessoa considera terreno, rampas, árvores, cercas e permissões territoriais. Ocupantes são tratados durante a execução do passo.
- Um ocupante recebe o pedido de passagem existente. Se permanecer no lugar, uma busca local visita no máximo 81 células, em até seis passos, para reencontrar um dos oito próximos pontos da rota. O desvio mantém o restante do percurso.
- Quando o desvio local não resolve, a pessoa aguarda. Após três dias de bloqueio pode buscar um caminho maior considerando ocupantes. Novas buscas desse tipo respeitam intervalo de quatro ou cinco dias por pessoa. Uma falha nessa busca preserva a rota de terreno e não marca o destino como geograficamente inacessível.
- Buscas sem caminho pelo terreno são memorizadas por dois ou três dias, por pessoa, posição, destino, preferência de estrada, raio de chegada e permissões. Mudanças nas saídas próximas, no modo de chegada, no contexto de cercas ou na revisão do mapa permitem uma nova tentativa imediata.
- A revisão é atualizada após corte de árvores, regeneração vegetal e alterações efetivas de território. Alterações externas de terreno ou rampas podem chamar `invalidateNavigation(world)`; as saídas imediatas também são conferidas durante o intervalo de falha.
- Rotas comuns são mantidas em um cache de execução por mundo, fora dos snapshots: até 64 destinos/contextos, três caminhos por entrada e 256 células por caminho. Expiram em 14 dias. Quem começa sobre o percurso ou numa célula vizinha pode adotar seu trecho restante, após validar todas as arestas com suas próprias regras de movimento. Cada pessoa recebe uma cópia independente.
- Predicados personalizados de movimento desabilitam o compartilhamento e a memória de falhas, pois podem mudar sem um identificador estável. Preferências por estradas e raios de chegada diferentes usam entradas distintas.

## Perfil curto

Comando: `PROFILE_DAYS=20 PROFILE_REPEATS=1 PROFILE_WARMUP_DAYS=2 node scripts/measure-simulation-phases.mjs`.
As variáveis foram definidas no ambiente PowerShell; as duas sementes padrão são 42 e 2026. Contadores excluem os dois dias de aquecimento.

| Contador em 20 dias | Semente 42 | Semente 2026 |
| --- | ---: | ---: |
| Buscas completas de pessoas | 278 | 278 |
| Reaproveitamentos de rotas comuns | 79 | 78 |
| Buscas sem saída evitadas pela memória | 25 | 0 |
| Desvios locais executados | 99 | 112 |
| Esperas por congestionamento | 143 | 139 |
| Buscas maiores por congestionamento persistente | 12 | 19 |
| Mediana da fase de pessoas, ms/dia | 88,47 | 67,95 |
| Mediana das buscas de rota, ms/dia | 13,21 | 13,28 |

Os contadores de buscas maiores são parte das buscas completas, não uma categoria adicional. Os tempos detalhados são aninhados nas fases principais. Arquivo bruto: `navigation-optimization-profile.json`.

Esta amostra tem uma repetição e não possui uma linha de base executada nas mesmas condições. Os contadores comprovam o uso dos mecanismos; os tempos não estabelecem um percentual de ganho, FPS ou equilíbrio da simulação a longo prazo.

## Validação

Suítes focadas: `navigation-performance`, `road-navigation`, `island-terrain`, `kingdom-campaigns`, `combat-resources` e `military-formations`.

Resultado final: 83 testes passaram, sem falhas. `npm run build` passou, com o aviso de tamanho do bundle principal acima de 500 kB.

Os casos novos cobrem desvio sem uma segunda busca completa, espera e retomada, desvio maior após bloqueio persistente, intervalo entre buscas de ocupação, expiração e invalidação de falhas, compartilhamento independente, mudança de obstáculos, permissões territoriais, predicados personalizados, cercas, preferências de estrada, raios de chegada e expiração de rotas comuns.
