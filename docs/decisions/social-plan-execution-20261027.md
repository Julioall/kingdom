# Execução de planos e uso de conhecimento social — 27/10/2026

## Problema e comportamento resultante

Um NPC podia criar uma intenção de ajuda e uma proposta sem nunca selecionar a ação que executaria seus passos. Obras tinham precedência, soldados não escolhiam `socialize`, e o ID textual do alvo não resolvia o mapa de pessoas com chaves numéricas. A expiração recriava a mesma tentativa a cada quatro dias. O diagnóstico está em `docs/verification/social-plan-investigation-20261027.md`.

O novo executor determinístico escolhe o próximo passo executável entre ajuda alimentar e migração, ordenado pela prioridade registrada e pela antiguidade. Reutiliza `socialize` e `migrate`; não adiciona entradas, ações ou recompensas neurais. A decisão forçada descarta amostras pendentes das redes individual e militar, evitando atribuir o resultado do plano a uma ação aprendida diferente.

Um trabalhador pode pausar a obra para se aproximar do ajudante. Um soldado pode pedir ajuda fora de campanha/posto prioritário, desde que não precise primeiro de abastecimento ou recuperação. Campanha, posto militar, necessidades urgentes, recuperação e carga em transporte registram impedimentos explícitos. A manutenção retoma a mesma intenção quando o impedimento desaparece; não cria um controlador de movimento paralelo. Planos de migração existentes também continuam seu destino em decisões posteriores. Avaliações de serviço mantêm seu executor já existente e sua evidência de soldo, sem pagamentos adicionais.

## Prazos, compromissos e retomada

Uma proposta nova só nasce quando o NPC pode iniciar a execução naquele dia; recuperação, carga e dever militar não geram uma fila de promessas impossíveis de iniciar.

- A proposta e o plano de ajuda compartilham prazo `dia atual + max(3, ceil(distância) × 2 + 1)`: margem para aproximação, desvio e pedido. O prazo é finito e não aumenta automaticamente a cada suspensão.
- Uma tentativa abandonada por prazo, recusa ou indisponibilidade evita o mesmo ajudante por quatro dias; outra pessoa visível continua elegível.
- O limite de intenções é verificado antes de criar a proposta. Se uma transferência presencial válida ocorrer sem espaço para plano/compromisso, o fallback de ajuda continua disponível.
- Aceite não cria alimento. Cumprimento exige a transferência observada, ligada ao compromisso e com quantidade verificável. Entregas parciais e quebra de compromisso aceito mantêm os contratos existentes.
- Morte/indisponibilidade que abandona a intenção cancela sua obrigação ainda aberta. Vencimento mantém as transições próprias de expiração/quebra.
- A pessoa que nunca recebeu uma proposta não ganha uma memória de observação direta quando ela expira ou é cancelada à distância.

Os multiplicadores de distância e os quatro dias de nova tentativa são parâmetros iniciais de gameplay. Resolvem o prazo incompatível e a repetição imediata, mas não representam uma calibração científica nem garantia de que toda promessa será cumprida.

## Fatos e relatos com efeito na decisão

A escolha continua limitada a pessoas atualmente percebidas, visíveis e com sinal de excedente. Entre essas opções, a distância é ajustada pela avaliação e certeza da crença de confiabilidade na ajuda. A crença só participa quando cita uma memória que o NPC possui; ler um fato global desconhecido não muda a escolha. As evidências lembradas do ajudante ficam ligadas à intenção criada.

Um encontro presencial confirmado, inclusive o próprio pedido de ajuda, pode transmitir uma experiência recente de ajuda (transferência real ou pedido recusado) que a fonte conhece e o destinatário ainda não conhece. O limite é uma raiz por encontro, com janela de 30 dias. O destinatário registra `reported`, identifica a fonte e atualiza sua crença com o peso menor de relato já implementado no sistema de evidência. Repetir a mesma raiz não aumenta certeza nem aplica a consequência novamente. A resposta de aceite não é retransmitida como outra entrega: usa-se a raiz da transferência efetiva para evitar contagem duplicada.

A indicação de água existente continua usando memória sensorial e fonte do relato. A mudança não permite seguir posição privada de alguém conhecido por terceiros: relatos influenciam a preferência entre ajudantes observados, sem revelar sua posição atual ou seu inventário.

## Inspeção e verificação

O inspetor identifica a outra parte dos planos/compromissos, traduz os impedimentos da execução e inclui progresso e impedimento nos fatos de atualização. Continua separando fato observado, relato recebido, interpretação e lição recente da ação.

`tests/social-plan-execution.test.mjs` exercita a seleção e a execução reais de morador e soldado, interrupção de obra e aproximação, preservação neural, suspensão/retomada, prioridade de abastecimento/carga, escolha informada por memória, relato presencial sem conhecimento global, idempotência, cancelamento e intervalo de nova tentativa. Os testes existentes de ajuda, compromissos, migração, soldo e evidência permanecem relevantes.

`scripts/diagnose-social-plans.mjs` reproduz um mundo normal sem forçar decisões ou recursos. Aceita seed, dias, nome, JSON de saída e HTML opcional de inspeção. O HTML usa o renderizador de produção sobre uma pessoa do replay que concluiu ajuda; não é uma captura da sessão original de Oru J.

A suíte geral também contém alterações paralelas em cultivo/governança. As falhas de `corral-capacity` (expectativa de captura versus busca de alimento) e `ecology-seasonality` (crescimento 16,875 versus 180) foram reproduzidas numa cópia isolada com os quatro módulos sociais alterados restaurados para HEAD, mantendo as demais alterações do projeto. Não se deve atribuir essas falhas a esta implementação nem declarar a suíte inteira verde enquanto persistirem.

## Resultado observado

No replay final normal de seed 42 até o dia 180: 16 planos de ajuda concluídos e 16 compromissos cumpridos; quatro propostas vencidas, uma cancelada e quatro ainda propostas. Oru P concluiu um plano em 3/3 com `aid_delivered`; outra tentativa avançou até 1/3 e venceu, e uma terceira estava suspensa em 1/3. A política agora permite execução e sucesso, sem garantir a conclusão quando a rota, o ajudante ou a recuperação impedem o pedido.

A prévia visual gerada do mesmo replay mostra Jaci H com três planos concluídos, os respectivos compromissos em 2,5/2,5 e outro plano em andamento. A imagem é `reports/social-plan-final.png`; o JSON é `reports/social-plan-final-seed42.json`. A captura foi conferida no navegador integrado. A apresentação sobre o mapa também foi observada no jogo local; a prova das transições completas usa o replay determinístico e os testes de integração.

O contador de relatos retidos ao fim desse replay foi zero; ele não demonstra difusão espontânea de notícias nessa seed. A transmissão presencial, tanto em conversa como em pedido de ajuda, a identificação da fonte, a influência sobre a escolha seguinte e a ausência de duplicação foram demonstradas por cenários integrados controlados. Não alegar alcance ou frequência social a partir desse replay.

Build final aprovado (typecheck, bundle e otimização de imagens). A suíte geral final executou 266 testes: 264 passaram, com as mesmas duas falhas de ecologia/governança reproduzidas sem esta implementação social. Os logs estão em `reports/social-plan-final-tests.txt` e `reports/social-plan-build.txt`.
