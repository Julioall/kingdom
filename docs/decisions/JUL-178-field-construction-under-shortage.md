# JUL-178 — Construção de roça durante escassez

## Problema observado

O lote da roça agora é limitado pela massa de sementes e pelos tiles realmente ocupados: `min(sementes × 1.250, tiles × 420)`. A meta padrão continua em 10.000 para 8 unidades de semente e 24 tiles. O replay da seed 42 no SHA `2b66d1c86e7e74899aa874afc42688f78cf2b3e2` mostrou que essa produção não ajudaria enquanto as roças ficassem incompletas (33/34 e 0/34); ambas as comunidades terminaram sem comida.

## Evidência e diagnóstico

O replay de 365 dias no SHA `7fd1778684ff71924338484cf4110b3e2e2bfe2b` repetiu a seed 42 de forma idêntica. A exceção de reserva alimentar ajudou uma roça da seed 1 a chegar a 34/34 e entregar 9.953,36 das 10.000 unidades colhidas; a outra comunidade daquela seed continuou sem produção. Na seed 42, as roças terminaram em 33/34 e 6/34, sem colheita, e os estoques comunitários chegaram a zero.

O rastreamento diário da seed 42 localizou duas barreiras distintas: construtores de roça com reserva entre 8 e 24 eram tratados como indisponíveis; depois de permitir que um construtor persistisse acima de 8, os candidatos paravam quando energia chegava a 27. A recuperação domiciliar só começa em 24 (`GARRISON_RECOVERY.startRestEnergy`), portanto pessoas entre 24 e 27 não construíam nem descansavam. A mesma inspeção também mostrou dias em que todos os adultos próximos estavam retidos em tarefas de coleta urgente.

## Decisão

Manter uma exceção estreita, somente para obra de roça já financiada ou atribuída como `invest-in-cultivated-food`:

- um construtor pode continuar enquanto sua reserva alimentar estiver acima de 8;
- a energia mínima acompanha o início do descanso (`>24`); ao alcançar 24, a política de recuperação pode agir;
- outros edifícios mantêm os limites anteriores (24 de reserva e mais de 27 de energia);
- a tarefa imediata de sobrevivência ainda substitui a construção no limiar crítico de comida.

Alternativas rejeitadas: aumentar artificialmente o estoque ou a colheita para esconder a obra travada; reduzir limites de energia e fome para todo tipo de construção; deixar todo o reino construir e interromper a coleta de curto prazo. A exceção de um trabalhador preserva a coleta dos demais e não altera as regras de sobrevivência nem a unidade dos estoques.

## Fontes e limites

O requisito de sementes/área está registrado em [JUL-178-field-yield-area-seed.md](JUL-178-field-yield-area-seed.md), com a consulta SciSpace sobre simulação de lavoura até a colheita. Os coeficientes são calibração de gameplay, não estimativas agronômicas. Consensus continua indisponível até o reset de cota informado para 01/11/2026. A escolha dos limites de trabalho decorre do comportamento concreto do motor: fome crítica começa em 8 e descanso em casa em 24. Não foi adicionada mecânica ecológica ou sazonal.

## Verificação

- No SHA `7fd1778`, 30/30 testes focados passaram e `npm run build` passou. O replay anual confirmou melhora parcial, mas não o aceite alimentar: seed 42 continuou sem colheita e ambas as reservas comunitárias terminaram em zero.
- No SHA `66092bab2a33fddfcd38820856422c76d8e778fe`, a mesma suíte focada passou em 30/30 e o build local passou. O replay 365 dias da seed 42 completou com hash de estado `2b2c1d8d30affd0bce21d270b393feb8793ddb1fe0ba8c716bec996c16222067` e crônica `27bc09fd7af8b4094152fcf31107f1aea906bf2b5758ff864b1c36b619c0a004`. A roça da Corvânia concluiu no dia 154, colheu 10.000 e entregou 9.962,02; a comunidade terminou com 2.774,26 unidades e recuperou o estoque acima de 300. Valedouro continuou sem produção, com a outra roça em 4/34, estoque final zero e 230 dias abaixo de 300. O total caiu de 12.138 para 8.496 adulto-dias abaixo de 20, mas isso não demonstra alimentação estável para ambos os reinos.
- A repetição exata da seed 42 foi confirmada no SHA `7fd1778`, antes do ajuste de energia. O mundo seed 42 começa com zero madeira e pedra nas duas comunidades, enquanto `nextCommunityStructure` exige esses materiais para uma roça. A inspeção do fallback e das opções do rei confirma que, quando o alimento está abaixo da meta e os materiais faltam, o plano seleciona coleta de alimento e não expõe a reunião dos materiais da roça. Isso é consistente com a roça tardia (6/34 no SHA `7fd1778`; 4/34 no `66092ba`). O próximo passo é atacar esse gargalo sem tirar todos os trabalhadores da busca de comida.
- Ainda não há critério para encerrar JUL-178: faltam a repetição da suficiência em ambas as comunidades/seeds, os demais horizontes e seeds, o mercado explícito de sementes de JUL-201 e a cadeia alimentar do rebanho onde aplicável.
