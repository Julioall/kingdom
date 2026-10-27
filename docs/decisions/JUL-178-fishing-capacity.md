# JUL-178 — capacidade antes da pesca

Data: 27/10/2026

A pesca podia matar o peixe e contabilizar toda a captura mesmo quando a reserva pessoal e a carga já estavam cheias. O alimento excedente não era creditado a ninguém. Um teste controlado reproduziu a divergência: quatro unidades anunciadas e zero recebidas.

Antes de tentar a captura, a pessoa verifica se a produção inteira cabe na reserva pessoal até o alvo existente, na carga de alimento ou no estoque comunitário próximo. Sem capacidade, o peixe permanece vivo e a pessoa recebe um estado explicativo. A função de recebimento também recusa um lote que não cabe e retorna apenas o que foi armazenado; o alimento não é criado nem perdido para compensar capacidade insuficiente. Foram consideradas a perda explícita do excedente e a captura parcial: a primeira produziria desperdício e a segunda exigiria modelar o restante de um peixe morto. A recusa preserva a fonte finita e permite voltar quando existir capacidade.

Os testes reproduzem a falha anterior, verificam que peixe, saldos e gerador aleatório permanecem intactos sem espaço e conferem um lote dividido entre alimentação pessoal e carga. A avaliação cobre somente a pesca e sua capacidade, não substitui a conciliação por dono e dia exigida na JUL-178. A decisão se apoia na inspeção do código e testes; Consensus indisponível por cota até 01/11/2026; consultas anteriores ao Game Studio e SciSpace estão registradas nas demais decisões da issue.
