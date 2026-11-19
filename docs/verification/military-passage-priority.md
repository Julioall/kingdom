# Passagem militar: arbitragem determinística entre unidades

Esta etapa complementa a primeira mudança de largura de postos do PR #140.
O objetivo específico é evitar que dois grupos da **mesma campanha** tentem
desalojar um ao outro na mesma célula enquanto marcham em sentidos opostos.

## Contrato da implementação

- Só é aplicada a soldados aliados, da **mesma campanha**, com
  `militaryUnitId` e `tacticalRole` definidos. Demais NPCs mantêm a
  política anterior de cessão de passagem.
- Quando uma célula é ocupada, o agente que deseja ocupá-la pode solicitar
  que o bloqueador encontre uma posição adjacente **legal** usando o
  `moveOne` existente. Nenhum ator é reposicionado diretamente.
- Controle manual e reservas que ainda guardam posição não cedem passagem
  compulsoriamente.
- Dentro da mesma unidade, o comandante precede os seguidores.
- Entre unidades, prioridade de fase tática e papel da unidade; empates têm
  resultado estável pela identidade da unidade, não pela ordem de execução.
- Quem cede a passagem entre unidades distintas não pode imediatamente
  retornar à célula liberada **no mesmo dia de simulação**. A movimentação
  normal pode ser retomada no próximo dia.
- Estamina, colisão de pessoas, terreno, estruturas, território,
  guardas de combate, limites de recursão e logística continuam nas regras
  atuais do motor.

## Cobertura nova

`tests/military-passage-priority.test.mjs` inclui:
1. Precedência de capitão sobre seguidor, sem movimentação artificial.
2. Prioridade simétrica e determinística entre unidades; retirada sobre marcha.
3. Respeito a reserva, comando manual e campanhas distintas.
4. Duas unidades em sentidos opostos: concessão de passagem em área lateral
   transitável, espera sem retorno imediato e retomada de ambas as rotas.

## Limites explícitos

Esta é uma **arbitragem local de passagem**, não um sistema completo de
reserva de corredor por toda a unidade. Quando não existe espaço lateral
acessível, a unidade continua obrigada a aguardar ou replanejar pelos
mecanismos existentes. Não prometemos atravessar corredores fisicamente
impossíveis nem assumimos resolução da issue #54 sem reproduzi-la.

## Porta de aceite para a próxima etapa

- Reproduzir a issue #54 na seed 42 e classificar o bloqueio real.
- Implantar, caso justificado pelos replays, autorização coletiva de entrada
  em trechos estreitos com liberação após a saída do último soldado.
- Medir tempos de espera, faltas de progresso, reversões, coesão e CPU por
  unidade antes de ampliar comportamento em 500/5000 NPCs.
- Validar em navegador usando `?battleDebug=1` sem falsear o movimento
  por animação/interpolação.
