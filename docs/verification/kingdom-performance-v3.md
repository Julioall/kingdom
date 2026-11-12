# Kingdom Performance V3 — validação de capacidade

## Índice de atores e câmera
A renderização não precisa varrer todas as entidades do mapa em cada quadro
quando a câmera ocupa uma região pequena. O índice mantém caixas de movimento
conservadoras, incluindo as posições intermediárias retidas pelo interpolador.
As posições finais continuam filtradas pela câmera. Personagens controlados
manualmente e em ações de combate são consultados sempre.

Em caso de qualquer inconsistência visual, **desative somente a indexação
gráfica** com `?actorCulling=0` — sem alterar simulação, IA, fauna ou colisões.
Verifique também `?profile=1` e `context.actorViewport`.

## Consultas de abrigo
Um índice espacial de estruturas estáticas acelera a pergunta "há algum abrigo
válido a 4 tiles?". A verificação de tipo, conclusão e comunidade consulta o
objeto vivo; construções anexadas ao array são incorporadas antes de consultar.
A distância final utiliza o mesmo Math.hypot e raio da implementação anterior.
Não acelera o cálculo diário de reparo/construção e não é cache de propriedade.

## Evidências automáticas
`.github/workflows/performance-v3.yml` executa o mundo autoritativo de
**5.000 NPCs** em dois checkouts, no mesmo runner, e exige SHA-256 do snapshot
completo equivalente. O teste de Chromium alterna `actorCulling=0` e
`actorCulling=1` com zoom, tempo, seed, UI e condições iguais. Ambos deixam
artefatos JSON. A CI normal mantém testes de interpolação e comportamento.

## Limitações
O benchmark CPU usa apenas uma seed/dia no cenário de estresse e captura de
heap após o dia, não pico. Chromium headless roda com renderização de software,
não testa a GPU local. Repetições e avaliação em máquina real ainda são
necessárias para confirmar ganhos duradouros de FPS e p95. O transporte compacto
(`transport=compact`) e o scheduler neural (`cognitiveBudget=128`) continuam
opcionais para evitar alterações não homologadas no comportamento padrão.

## Orçamento neural adaptativo

`?cognitiveBudget=adaptive` é um modo opcional que seleciona a cada dia `max(128, ceil(adultos/8))` inferências rotineiras, com limite de 4096. Para 5.000 adultos o valor efetivo é 625, reduzindo o intervalo de aproximadamente 40 para cerca de 8 dias em população estável. Reis, generais, combate, perigo e fome continuam prioritários, fora desse orçamento; física e necessidades continuam diárias. Esse modo muda decisões dos NPCs e **não está habilitado por padrão**. Seu custo e benefícios precisam de A/B próprio; a execução perfilada informa o orçamento realmente escolhido.
