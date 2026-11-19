# Kingdom | exclusividade de corredores por unidade

## Objetivo e contrato

O PR #142 coordena pedidos de passagem **entre dois atores**. Este incremento
mantém o direito de atravessar um estreitamento para uma **unidade completa**,
sem abrir caminho para a tropa adversária assim que o capitão sai.

`src/simulation/individuals/military-corridors.js` reserva apenas os trechos
realmente estreitos (até 40 células ortogonais), identificados por `canStep`
com as regras autoritativas de terreno, construções, elevação, cercas,
território e colisões estáticas. Nenhum teleporte é feito.

### Fluxo

1. Ao tentar ingressar no estreitamento, a primeira unidade recebe a
   concessão. Se já houver soldados de outra unidade no trecho, eles têm
   prioridade para desocupá-lo.
2. São registrados os integrantes da mesma unidade e campanha próximos ao
   acesso (raio local limitado), preservando a identidade do comandante e
   dos seguidores. Um soldado do grupo já à frente da saída não bloqueia a fila.
3. Enquanto qualquer integrante registrado ainda não tiver ultrapassado a
   saída, outras unidades da mesma campanha aguardam, mesmo depois de a
   vanguarda terminar de atravessar.
4. A conclusão é registrada **após** o passo real de movimento e liberação de
   todas as posições internas. Nunca são contadas tentativas bloqueadas.
5. Quando o trecho é liberado, os interessados ativos são escolhidos por
   prioridade militar determinística (fase, papel, liderança e ID da unidade).
6. Se ninguém da unidade vencedora ocupar o trecho e não houver progresso
   durante seis dias, a concessão pode expirar. Enquanto houver soldados
   fisicamente no trecho, ela não expira e nenhuma colisão é ignorada.
7. O estado de espera aparece no soldado como
   `aguardando liberação do corredor pela outra unidade`, com histórico
   de dias bloqueados. O estado autoritativo fica em
   `world.militaryCorridorTraffic` para permitir replays consistentes.

A distinção entre "ainda está dentro" e "já cruzou para o lado oposto" impede
liberação indevida quando a unidade apenas recua ao ponto de origem. Quando
há incumbentes sem reserva anterior, o controlador exige a evacuação física
de todos os participantes capturados, sem presumir a direção da marcha.

### Limites de segurança

- Aplicável apenas a soldados de unidades identificadas em campanha com
  papel tático. Demais NPCs continuam usando o movimento anterior.
- Não modifica o A*, as capacidades de ataque, estatísticas, cura ou dano.
- Não autoriza passagem por soldado inimigo nem teleporte para vencer filas.
- Não promete resolver gargalos com mais de 40 células ou pontes sem espaço
  de espera seguro na entrada/saída. Esses casos exigem replanejamento ou
  extensões de escopo explícitas.
- Apenas participantes próximos à entrada no início são rastreados; soldado
  afastado e separado pode exigir reagrupamento separado.
- O mecanismo prioriza integridade do campo de batalha sobre duração da
  travessia, e deve ser validado para evitar esperas excessivas.

### Testes

```sh
node --test tests/military-unit-corridors.test.mjs
node --test tests/military-passage-priority.test.mjs
node --test tests/battlefield-choreography.test.mjs
npm test
npm run typecheck
npm run build
```

Cenários cobrindo:
- Ponte estreita com comandante e dois seguidores, outra unidade no lado
  oposto, prioridade de posse e liberação da última fileira.
- Espera/posicionamento físico sem sobreposição ou pisar em pedra.
- Desistência/retorno ao ponto inicial e recuperação de concessão abandonada.
- Unidade já presente no trecho antes de receber o primeiro pedido.

### Portas de aceitação não automatizadas

- Inspeção visual no navegador com `?battleDebug=1`.
- Repetir 10 soldados por unidade e três a cinco unidades nas duas direções.
- Cobrir ponte, portão, obstáculo dinâmico, retirada, morte/substituição de
  líder, cruzamento com tropas inimigas e ausência de baia lateral.
- Reproduzir separadamente a issue #54 (seed 42, arqueiro 145 e torre 66).
- Comparar determinismo por seed, CPU e memória de 100, 500 e 5.000 NPCs.

A issue #141 só será encerrada depois de comprovar passagem, coesão e
contato militar com replays e observação em navegador.
