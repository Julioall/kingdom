# JUL-178 — capacidade da carga em saque

Data: 27/10/2026

O saque retirava alimento do estoque rival antes de limitar a carne e os frutos à capacidade de carga do atacante. Com ambas as cargas cheias, um teste reproduziu uma retirada registrada como sucesso sem crédito à pessoa. Com carga parcial, o excedente também podia desaparecer.

A retirada agora respeita capacidades separadas para carne e alimento vegetal; quando nenhum produto disponível cabe, a tentativa não debita o estoque. A função comunitária de retirada mantém os limites ilimitados como padrão para os demais consumidores, e a variante usada pelo saque limita ambos os tipos na origem. As quantidades efetivamente retiradas continuam sincronizando os subregistros do abrigo. Não se cria comida nem se transforma perda silenciosa em saque bem-sucedido. Alternativas de descarte ou limitar apenas pelo total nutricional foram rejeitadas, pois a capacidade restante pode pertencer ao tipo errado de alimento.

O teste de carga cheia falhou antes da alteração; o teste de carga parcial confere separadamente os débitos do estoque, créditos pessoais e subregistros do abrigo. Esta mudança é limitada à conservação do saque; não demonstra a cadeia integral nem o comportamento visual de uma incursão. Replays, ledger por dono/dia e playtest de cenário de incursão continuam pendentes. Fontes: código, critérios da JUL-178 e testes; Consensus sem cota até 01/11/2026; consultas anteriores ao Game Studio e SciSpace nas decisões correlatas.
