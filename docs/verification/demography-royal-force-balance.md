# Demografia e autonomia militar dos reis (experimental)

## Diagnóstico

No motor anterior, `reproducePeople` considerava todos os pares férteis do mundo, mas só selecionava um nascimento a cada 30 dias, **independentemente do número de reinos**. Idades avançavam um dia por ciclo de simulação, com infância dependente até 12 anos, aptidão para recrutamento a partir de 15 anos, reprodução dos 18 aos 45 e morte natural aos 82. Portanto, o envelhecimento já avançava, mas nascimentos eram estrangulados globalmente e recrutas nascidos agora não aparecem instantaneamente.

O navegador inicia 200 habitantes (100 por reino), com 80% militares; 500 continua disponível como cenário opcional, mas a alocação fundadora não deve ser mantida por decreto para sempre. Sem desmobilização, perdas de guerra não deixam trabalhadores suficientes para produção e cuidado de crianças.

## Alterações

- Nascimentos mensais agora podem acontecer **em cada reino**, com teto de até `ceil(população viva do reino / 100)` por mês, condicionado aos pares realmente aptos, relações de confiança, moradia vaga, alimentação e intervalos individuais de 280 dias. Cada adulto participa de no máximo um parto no ciclo.
- Adultos em campanha não formam novos pares reprodutivos enquanto estão mobilizados. Casais com forte vínculo podem se reunir em uma mesma casa mesmo que estejam a algumas células de distância. Continuam necessários adultos de sexos diferentes, saúde suficiente e um vínculo social observado.
- Quando existe casal pronto mas **todas as moradias estão lotadas**, o reino solicita uma casa conforme a regra de construção vigente: local legal, custo real de madeira/pedra, projeto e trabalhadores. Não há casa nem bebê grátis.
- A cada 30 dias, nos mundos iniciados explicitamente com `initialMilitaryShare: .8`, o rei revisa a força disponível. O alvo de composição é dinâmico: 25% dos adultos em escassez civil/alimentar, 35% em paz, 45% sob alerta e 60% em guerra, sempre preservando pelo menos 35% da população adulta como civis.
- Durante campanhas ativas o rei não desmobiliza tropas; só treina novos soldados quando há adultos civis excedentes, alimento comunitário e os estoques e centros reais exigidos pelo recrutamento. O treinamento mantém os seis dias já previstos.
- Fora das guerras, a desmobilização acontece aos poucos (até 12 soldados por reino a cada 30 dias, escalonados conforme o contingente adulto), escolhendo militares sem comando, sem serviço em torre e sem controle manual. Os personagens continuam vivos, voltam a trabalhar e preservam seus salários, recursos e histórico. Unidades militares são reconstruídas pelo comando existente, sem manter os dispensados nas fileiras.
- Os soldados vivos voltam à produção sem perder suas economias ou salários devidos. A disponibilidade real de trabalhadores e a reserva civil também limitam o recrutamento por IAs externas.
- A apresentação visual acompanha o crescimento infantil gradualmente e reduz levemente a escala dos idosos; o inspetor mostra a fase da vida, sem alterar colisões nem o relógio.
- Mundos legados criados por `createWorld(seed)` mantêm o perfil fundador antigo sem balanço automático. Isso isola benchmarks históricos de um ajuste de comportamento que precisa de validação longitudinal.

## Fronteiras da entrega

Os limites de idade de 12, 15, 18 e 82 anos **não foram acelerados**. Esse ritmo é uma escolha: elevar o nascimento sem sustentar alimentação e alojamento pode aumentar mortalidade infantil, e os recém-nascidos só participam da economia muitos anos depois.

O alvo de 25–60% não é promessa de convergência exata. Pode não ser atingido quando não há soldados livres para dispensar, adultos aptos, recursos para recrutar, vagas operacionais ou segurança alimentar. A proporção militar de 80% é um ponto de partida, não uma meta; a revisão mensal está documentada no estado `kingdom.forcePolicy`.

Não se alterou o dano das armas, a resolução das campanhas, a duração do calendário nem a produção ecológica.

## Testes e critérios de aceite

```bash
node --test tests/kingdom-demography-force-policy.test.mjs tests/residential-birth-capacity.test.mjs tests/person-age-scale.test.mjs
npm test
npm run typecheck
npm run build
```

Replays recomendados após aprovação dos testes: 200 habitantes (padrão) e 500 (cenário adicional), 80% militares, seeds 1, 42, 987 e 2026, com horizontes de 30, 90, 180 e 365 dias. Medir por reino: população total, nascimentos, crianças que atingiram 12 e 15 anos, mortalidade por causa, civis adultos disponíveis, militares ativos/em treinamento, alimento e moradias operacionais. Para validar recuperação pós-guerra, comparar um cenário que efetivamente entra em guerra com outro controlado sem mobilização. Repetir seeds para garantir determinismo.

**Não aprovar por apenas aumentar a contagem de nascimentos.** A estabilidade depende de crianças sobreviventes, trabalhadores livres, moradia e abastecimento de ambos os reinos.
