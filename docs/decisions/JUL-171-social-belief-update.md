# JUL-171 S1 — primeira interação social com procedência

Data: 26/10/2026  
Issue: [JUL-171](https://linear.app/julio-alves/issue/JUL-171)  
Base de contrato: JUL-170 S0, `social-evidence.js`  
Escopo desta fatia: transferência de alimento e leitura no inspetor

## Pergunta e evidência

Como registrar uma experiência social real sem transformar a crônica em conhecimento comum e sem aumentar a crença quando a mesma notícia é repetida? A busca SciSpace por revisão de crenças a partir de observações, relatos dependentes e evidência contraditória encontrou:

* Hunter, [Reports, Observations, and Belief Change](https://doi.org/10.1007/978-981-99-8391-9_5), propõe separar observações de relatos potencialmente não confiáveis e preservar o histórico de relatos. O resumo sustenta a distinção de procedência; não fornece coeficientes de jogo.
* Foster, Huthwaite e Yesberg, [Repetition, Not Number of Sources, Increases Both Susceptibility to Misinformation and Confidence in the Accuracy of Eyewitnesses](https://doi.org/10.2139/SSRN.1998302), relata experimentos em que repetir a mesma alegação influenciou crença/confiança independentemente do número de fontes. É um trabalho de 2012 indexado como SSRN; uso como alerta contra contar repetição como evidência independente, não como validação de uma fórmula de certeza.
* SciSpace também retornou Sanna, Mercier e Lagnado (2025), sobre dependência percebida entre testemunhos, mas o registro é um preprint/projeto OSF. Nesta fatia, eventos repetidos são deduplicados por `rootEventId`; dependência entre fontes distintas continua fora do escopo.
* Consensus continua sem cota até 01/11/2026; Game Studio já orientou a separação Worker/render e o uso do DOM para texto do inspetor. A indisponibilidade e alternativas estão registradas em JUL-170/JUL-195.

## Decisão e alternativas

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Usar `world.events`/crônica como memória social | Rejeitada | São projeções textuais, sem testemunha individual ou cadeia de relato. |
| Dar memória a todos os membros/comunidades próximas | Rejeitada nesta fatia | A percepção de terceiros não está demonstrada; só doador e destinatário são testemunhas do ato de ajuda. |
| Alterar confiança ou política de ação diretamente a partir do texto | Rejeitada | A transferência real é a consequência física. A crença fica observável e revisável, sem introduzir novo efeito comportamental sem replay de calibração. |
| Registrar fato do mundo, memórias dos participantes e crença do destinatário | Escolhida | Preserva a cadeia e mantém o estoque como fonte da verdade física. |

O fato `food_aid_transferred` é registrado **depois** de uma transferência não nula. A mesma raiz só pode aparecer uma vez nas evidências de uma crença; nova transferência com recurso movimentado é um novo fato. O doador e o destinatário recebem memória direta, e apenas o destinatário atualiza `food_aid_reliability` sobre o doador. Relatos futuros preservarão `rootEventId` e terão peso menor que experiência direta. Uma evidência de sinal contrário entra na lista contrária e reduz/reverte a avaliação calculada, sem apagar fatos ou memórias anteriores. A certeza cresce com a massa de evidência, em curva saturante `1 - exp(-peso/3)`. Pesos diretos/reportados (1/0,5) são escolhas experimentais e não resultados da literatura.

O inspetor apresenta as memórias em **Fatos e relatos conhecidos** com origem e dia e apresenta separadamente a crença em **Interpretações pessoais**, com avaliação, certeza e contagem de evidências favoráveis/contrárias. O estado do Worker continua sendo a fonte; o snapshot já transporta o estado de pessoa e de mundo para a camada visual.

## Validação desta fatia

Cobertura automatizada em `tests/social-evidence.test.mjs` e `tests/social-aid.test.mjs`: ajuda comunitária e voluntária registram apenas após mover alimento; o evento lista apenas doador/destinatário; falha sem estoque não gera fato; o registro de reserva voluntária e `sharedFood` usam o valor efetivamente movido; a pessoa que recebe forma crença dirigida; repetição da mesma raiz não aumenta certeza; evento independente contraditório altera a avaliação e preserva as duas memórias; a memória reportada permanece depois da morte da fonte.

Esta fatia **não** comprova o restante da S1: transmissão social em encontros reais, testemunhas por alcance sensorial, conhecimento individual de esgotamento de recursos, atualização de confiança na fonte entre relatos, consolidação de compromissos, temas de pagamento/competência militar/legitimidade, influência sobre seleção de ação e replays de longo prazo ainda precisam de entregas próprias. JUL-171 permanece aberta.

Nenhuma estação, biome, regra de ecologia sazonal ou recurso novo foi introduzido.
