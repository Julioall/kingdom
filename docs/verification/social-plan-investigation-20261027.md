# Investigação dos planos de ajuda sem progresso — 27/10/2026

O replay de produção confirma uma falha de integração entre criação de planos e seleção de ações. A expiração funciona, mas planos de ajuda são criados sem garantir oportunidade de execução. Nenhuma política de decisão, peso neural ou recurso foi alterado nesta investigação.

## Reprodução

```powershell
node scripts/diagnose-social-plans.mjs 42 120 'Oru P' reports/social-plan-investigation-seed42.json
```

O diagnóstico chama `engine.createWorld` e `engine.stepDay` normais, sem forçar decisões ou mudar recursos. Duas execuções independentes reproduziram os mesmos quatro planos, datas, estados e contagens de ações de Oru P. A segunda adicionou informações de atribuição e distinguiu o dia executado do dia do snapshot: o motor incrementa `world.day` após a atualização.

Resultado: morador Oru P, ID 135, vivo no dia 120. Planos criados nos dias 81, 85, 89 e 93, com prazos 84, 88, 92 e 96. Todos terminaram em `abandoned`, progresso 0/3 e motivo `deadline_expired`; os quatro compromissos ficaram `expired`, sem entrega.

Durante os 16 dias executados com plano aberto:

| Ação de Oru P | Dias |
| --- | ---: |
| Construir | 13 |
| Coletar alimento | 3 |
| Socializar/pedir ajuda | 0 |

Nos primeiros 12 dias de construção a atribuição observada era `build`, fonte `community-project`; o último dia de construção terminou sem atribuição no snapshot. As 13 decisões de construção não passaram pela comparação de pontuações neurais. A pessoa permaneceu no mesmo lugar, com o ajudante a aproximadamente 7,62 células. O ajudante estava visível e com sinal de excedente em 15 dos 16 snapshots de plano aberto. No último dia aberto, passou a ficar fora de vista. Os 15 primeiros snapshots não registraram impedimento no plano; o último registrou `target_not_visible`.

## Causa no código

1. `src/simulation/individuals/actions.js`, bloco `currentFoodAidPlan`/`perceivedFoodHelper`: criava a intenção e a proposta quando a reserva estava abaixo de 40 e um ajudante com excedente era percebido. Isso ocorria antes da seleção da ação, inclusive para soldados.
2. No mesmo arquivo, `assignedBuildDuty` força construção quando a atribuição não conflita com necessidades. A pausa por alimento ocorre abaixo de 24; o pedido de ajuda já é planejado abaixo de 40. Portanto, uma reserva entre esses limiares permite criar planos sucessivos enquanto a obra mantém precedência. No replay, as reservas nos dias executados 81–93 ficaram aproximadamente entre 35,5 e 39,5.
3. Os passos de ajuda só são executados dentro de `action === 'socialize'`. A prioridade 0,7 da intenção é armazenada em `social-evidence.js`, mas não é consultada pela seleção em `actions.js` nem por `choosePeopleAction`. Após a obra, Oru P escolheu coleta e o plano continuou sem passos executados.
4. `src/simulation/economy/trade.js`, `ensureFoodAidPlan`: usa `dueDay = world.day + 3`. Quando o plano anterior termina, o mesmo ajudante percebido pode gerar outro plano/proposta. O prazo não depende da rota ou da disponibilidade de tempo. Isso agrava a repetição, mas não é a causa dos passos em zero: o executor nem foi selecionado.
5. Sem entrar em `resolveFoodAidRequest`, não existe pedido presencial, aceite nem transferência. Por isso o compromisso fica **proposto** e depois **vencido**, em vez de aceito e quebrado.

## Lacuna específica de soldados

`src/simulation/kingdoms/military-learning.js` define apenas `guard`, `patrol`, `train`, `campaign`, `drink`, `rest` e `return_garrison`. O caminho normal de seleção militar em `actions.js` não seleciona `socialize`, embora o bloco anterior pudesse criar `seek_food_aid` para esse mesmo soldado. Conservar planos após recrutamento também não fornecia um executor militar para eles.

No mesmo replay, houve 15 dias-pessoa de soldados com planos de ajuda abertos: 12 retornando à guarnição, um descansando, um bebendo e um de guarda, sem socialização. Essa contagem é observação agregada; não reproduz a identidade ou o estado da sessão de Oru J.

## Encaminhamento técnico

A correção integra o próximo passo do plano à arbitragem das ações, com precedências explícitas. Para respeitar a política do Kingdom, somente civis entram no fluxo de ajuda alimentar: soldados não procuram ajudantes, não criam novas propostas nem resolvem pedidos; planos legados após promoção ficam suspensos por `military_duty`. O abastecimento militar permanece separado. Para os demais planos, o prazo considera aproximação e pedido, e tentativas repetidas registram impedimentos ou escolhem alternativa. Aumentar apenas o prazo ou alterar recompensas neurais não resolve a falta de integração.

Validar a correção com um morador ocupado em obra, um soldado com fome moderada que não solicite alimento, suspensão por dever/necessidade física, perda e recuperação de visibilidade, aproximação até um ajudante distante e entrega conservando recursos. O teste deve percorrer a seleção e execução reais, além das transições isoladas da intenção.

Artefatos: `scripts/diagnose-social-plans.mjs` e `reports/social-plan-investigation-seed42.json`. A sessão original de Oru J não foi acessada; o diagnóstico individual reproduzido é de Oru P, seed 42.

## Regressão por capacidade de memória — correção validada em 27/10/2026

Ao repetir o replay integrado de combate em seed 42, um solicitante chegou ao limite de 32 memórias citadas por uma intenção ativa. No dia 139, o plano tentou anexar a transferência real depois de uma transição de compromisso podar a memória nova. O Worker devolveu `Evidência social inválida: a pessoa não possui memória da evidência ...` e não produziu o snapshot.

A transição agora preserva temporariamente as evidências de entrega, transição e intenção. O plano atualiza suas referências antes da poda normal; a resposta alimentar também permanece disponível até ser anexada. Foram acrescentados testes de limite e de transferência real com o solicitante no limite.

Resultado após a correção: `tests/social-plan-execution.test.mjs` 14/14; `tests/combat-worker.test.mjs` aprovado em seed 42 até o dia 192, com 173 ações de combate; suíte completa 306/306; build/typecheck aprovados. Os valores e a causa foram reproduzidos no Worker de produção, sem forçar recursos ou alterar a simulação.
