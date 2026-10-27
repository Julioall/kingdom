# JUL-178 — piso civil para ração militar

Data: 27/10/2026

## Decisão

A guarnição e o orçamento e reabastecimento das campanhas preservam no estoque comunitário o equivalente a dois dias de consumo dos membros civis vivos do reino. Adultos e dependentes usam as necessidades diárias existentes; pontos de reserva pessoal são convertidos em unidades de alimento antes de comparar com o estoque. Carne entra pelo equivalente nutricional existente. O tesouro continua seguindo sua própria regra de ração.

Antes, a guarnição podia esgotar o estoque comunitário e a campanha comparava pontos de reserva com unidades de alimento, além de contar militares como civis. Um teste da guarnição com um adulto, uma criança e apenas uma unidade excedente falhou antes da correção. Foram consideradas a manutenção da regra anterior e uma proibição total de acesso militar ao estoque comum; a primeira não preservava o piso, enquanto a segunda impediria o uso do excedente disponível.

## Evidência e limites

Os testes cobrem débito de apenas uma unidade excedente, piso sem excedente, equivalência nutricional da carne e reabastecimento de campanha que preserva o piso e registra quatro unidades transferidas. A suíte completa, build e replays de integração devem ser registrados na issue com o SHA verificado. O piso não reserva uma porção individual, não garante acesso físico ou transporte e não protege o saldo contra todos os outros usos civis; portanto não demonstra segurança alimentar. Os efeitos sobre guerras e fome exigem a matriz de replays da JUL-178. A escolha de dois dias é um critério do projeto, não uma afirmação da literatura.

Consensus estava sem cota até 01/11/2026; o código, os critérios da issue e os testes são as fontes desta decisão. Consultas anteriores ao Game Studio e SciSpace sobre a simulação estão registradas em `JUL-178-returned-troops-rations.md`.

Replay anual da seed 42 no código `0373633f5fd86a48d4858c1c335ec4a33c4341a6`, repetido: estado `4c734e826355e2376fac0d93d4a414474bcc8c1d71f183f3a25cca6a524d15a1` e crônica `be9062eea7d24aa4cf582caa35ca5f95041ace51b8061b71abac067f6a0a5e57` coincidiram nas duas execuções e com o replay anterior. Não houve mortes humanas ou animais; os quatro lados de campanha tiveram ledger de campo balanceado. Restaram 13 e 12 pessoas com reserva pessoal abaixo de 20 nas duas comunidades. Relatório: `docs/verification/JUL-178-civilian-food-floor-365-seed42-20261027.json`. O resultado de uma seed não demonstra a matriz, nem acesso individual ou reconciliação integral por proprietário.
