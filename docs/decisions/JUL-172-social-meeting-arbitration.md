# JUL-172 S2 — arbitragem de encontros sociais

Data: 26/10/2026
Pergunta: como impedir que uma pessoa participe de dois encontros incompatíveis no mesmo dia, sem esconder emergências físicas ou transformar a simulação em um serviço global de matchmaking?

## Decisão

Reservar os dois participantes apenas quando um encontro presencial realmente se completa. A reserva existe durante a atualização diária, na ordem determinística por ID, e impede um segundo encontro no mesmo dia. Aproximação à distância não prende o alvo: se alguém se mover antes do contato, a distância é medida de novo quando a conversa for resolvida.

O encontro exige uma pessoa viva, visível para quem iniciou, a até 2,1 tiles, sem reserva anterior e sem emergência física observável. A emergência é representada por um sinal qualitativo de percepção; o resolvedor também revalida os estados reais e a distância imediatamente antes de aplicar o efeito. Se houver bloqueio, não gasta energia, não reduz necessidade social e não cria fato. Se completar, gasta a energia já usada pelo encontro, registra `social_meeting`, reduz a necessidade do iniciador e aumenta apenas a familiaridade dirigida de cada participante. A confiança não sobe por mera conversa.

Durante o mesmo encontro, o iniciador pode transmitir uma referência de água quando a outra pessoa mostra sede sem estar em emergência. O lugar vem do `knownWater` do iniciador e o tile precisa continuar contendo água; sem referência válida, não se criam coordenadas nem fato. O fato guarda a origem física, o último dia observado e o ponto real. O receptor ganha uma memória sensorial com procedência relatada, pessoa fonte e evento-raiz, utilizável pela busca de água no dia seguinte. A interface mostra o relato e sua posição.

Ajuda alimentar já debita um estoque comunitário ou a reserva do doador e credita o valor efetivamente transferido. Quando alguém com reserva baixa percebe um vizinho com excedente e escolhe socializar, pode pedir ajuda a até 1,6 tiles. O resolvedor revalida as reservas atuais, aplica o débito/crédito de uma fonte real ou registra recusa sem transferência. O par fica reservado naquele dia e o mesmo pedido não pode mover alimento duas vezes. A confiança nova é dirigida (receptor sobre doador), a familiaridade continua separada; a relação agregada anterior permanece para os indicadores comunitários.

## Fontes e limites

- A skill Game Studio `web-game-foundations` orienta manter regras e estado no Worker/simulação e separar a UI de apresentação. A arbitragem é determinística no código de simulação; o inspetor só lê o fato registrado.
- SciSpace foi consultado com a pergunta: “In spatial agent based simulations, how does local information sharing between agents affect decisions about finding scarce resources and providing help, and what design safeguards preserve the provenance and uncertainty of reported information?” A busca retornou Roberts e Goldstone, [EPICURE: Spatial and Knowledge Limitations in Group Foraging](https://doi.org/10.1177/1059712306072336). O resumo relata decisões baseadas em percepção atual e histórico e limitações de amostragem por espaço. A página editorial da [SAGE](https://journals.sagepub.com/doi/10.1177/1059712306072336) confirma título, autores e resumo. Isso motiva alcance local e observação repetível; é um modelo de forrageio, não valida os limiares de 2,1 tiles nem os efeitos sociais do Kingdom.
- O conector SciSpace desta sessão não expõe a operação `fetch` exigida por sua própria documentação para recuperar o registro completo. Por isso a busca serviu para localizar o estudo, e a fonte editorial primária foi consultada antes de citá-lo. O texto acadêmico não substitui os testes da simulação.
- A cota mensal do Consensus segue esgotada até 01/11/2026, conforme a resposta anterior do app. Nenhuma conclusão depende de Consensus.

## Alternativas

| Alternativa | Justificativa | Decisão |
| --- | --- | --- |
| Permitir conversas somente por co-localização | Mudança menor, mas não distingue presença de encontro nem impede múltiplas interações incompatíveis | Rejeitada |
| Criar agenda global de encontros antes de resolver ações | Pode otimizar pares, mas adiciona fase global e pode mudar ordem/decisão de todos os moradores | Rejeitada |
| Usar coordenadas calculadas a partir de um sinal genérico de sede | Dá uma indicação sem evidência de que o informante conheça o recurso | Rejeitada |
| Transmitir só um ponto conhecido, confirmar que ainda há água e preservar a origem do relato | Evita coordenadas inventadas e mantém a cadeia de observação no receptor | Escolhida |

## Validação desta fatia

O conjunto focal de encontros, ajuda, evidência social, inspetor e água passou **32/32**. A suíte completa passou **123/123** (`npm test`, 60,97 s); `npm run build` passou com `tsc --noEmit`, Vite e a otimização de 489 PNGs (8,03 MiB → 5,27 MiB). `git diff --check` não encontrou erros de whitespace.

Playtest manual em `http://127.0.0.1:5174/?seed=42`: mapa carregado no dia 34; foi possível selecionar Noa Z no mapa e abrir o inspetor individual. O perfil exibiu necessidades, estado, reino e memória recente. Esse residente não tinha fato social novo visível, portanto a captura demonstra a navegação e o layout do inspetor, não a apresentação de um resultado S2 específico. Os templates de conversa, indicação de água e resultado de pedido aceito/recusado são cobertos por testes de UI.

O replay orgânico de 30 dias no seed 42 foi repetido sem intervenção de estado e resultou em hashes idênticos (`stateSha256=29416dc9…f4a8`; `chronicleSha256=c6a551b9…7086`). Registrou **3 encontros** e **11 transferências de ajuda alimentar**. Não ocorreu indicação de água nem pedido alimentar nessa janela (`0` pedidos aceitos ou recusados); por isso o replay não demonstra esses ramos. Os testes direcionados cobrem a indicação com origem, pedido aceito, recusa após mudança real do estoque e idempotência. O relatório completo está em `docs/verification/JUL-172-social-meeting-replay-30-20261026.json`; é evidência exploratória de um único seed repetido, não avaliação geral nem prova de frequência.

O teste do Worker normaliza referências de execução apenas ao comparar estados equivalentes entre épocas; a identidade de memória continua protegida em `social-evidence.test.mjs`. JUL-172 permanece em andamento até uma reprodução de integração mostrar no inspetor um fato social específico e evidenciar indicação/pedido e resposta no fluxo do jogo. Não converter casos de teste isolados em alegação de que esses eventos ocorreram organicamente.
