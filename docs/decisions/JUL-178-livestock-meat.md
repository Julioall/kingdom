# JUL-178 — alimento de rebanho em escassez crítica

Data: 26/10/2026  
SHA de implementação: `f51d2b37feb25ec74f67103c6522157aa123fba6`  
SHA de validação: `c591f98575f4e4d0b5ef4f1bf4e76a005418bd08`  
Issue: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-cultivo-caca-civis)

## Pergunta e diagnóstico

Como permitir que o rebanho doméstico produza alimento sem criar carne, sacrificar o plantel inteiro nem ampliar a ecologia? `feedCommunalHerds` debita ração e a reprodução é finita; `attemptHumanHunt` rejeitava animais domesticados. O replay de 253 dias no SHA `0714033fb2f3e81a0c8f1f48ee7ad5b5f01c5cf6` registrou duas mortes por fome no conjunto das seeds 1/42/987/2026, reservas pessoais abaixo de 20 em milhares de adulto-dias e nenhuma ração de campo. Os estoques de tesouro e mercado terminaram zerados. Evidência: `docs/verification/JUL-178-food-replays-253-20261026.md` e o JSON completo ao lado.

## Evidência consultada e limites

* SciSpace encontrou Moritz, Buffington, Yoak et al., [No Magic Number: an Examination of the Herd-Size Threshold in Pastoral Systems Using Agent-Based Modeling](https://doi.org/10.1007/S10745-017-9927-0) (Human Ecology, 2017). O resumo afirma que taxas de retirada limitam o crescimento e que o limiar do rebanho é melhor tratado como uma faixa probabilística. Isso apoia testar o custo de retirada em cenários repetíveis; não fornece um número ideal de ovelhas para Kingdom.
* SciSpace também encontrou Bergland et al., [Pasture–livestock dynamics with density-dependent harvest and changing environment](https://doi.org/10.1111/nrm.12213) (Natural Resource Modeling, 2019). O resumo relaciona taxas de colheita e persistência de um estado finito, mas inclui uma extensão sazonal que fica explicitamente fora do Kingdom.
* Consensus foi tentado e continua sem cota mensal até 01/11/2026. Game Studio orienta manter a simulação determinística, a regra econômica fora da renderização e medir cenários pareados. Literatura orienta perguntas e alternativas; o replay é a evidência do comportamento deste jogo.

## Alternativas e decisão

| Alternativa | Vantagem | Limite | Decisão |
| --- | --- | --- | --- |
| Manter rebanho apenas como consumidor de ração e item de mercado | Nenhum risco de abate excessivo | Não fecha uma saída alimentar doméstica e mantém a lacuna levantada em JUL-178 | Rejeitada |
| Abate periódico/proporcional em todos os reinos | Produção previsível | Necessitaria de calendário/ritmo adicional, pode remover reprodutores e contraria o escopo ecológico mínimo | Rejeitada |
| Abate determinístico de emergência, apenas com percepção local e reserva comunitária abaixo de um dia | Reusa a ação de caça e os contratos de carga/abrigo; conserva dois adultos do plantel | O piso de dois adultos é uma regra inicial de gameplay, não um limiar científico; precisa ser avaliado por seed | Escolhida para experimento |

A ação de caça pode selecionar uma ovelha adulta da própria comunidade apenas quando a pessoa tem reserva abaixo de 48, percebe a ovelha, tem abrigo, não leva carne, o estoque alimentar disponível é menor que a demanda de um dia e restam mais de dois adultos no rebanho. O abate usa a conversão de carne já aplicada à caça, debita a vida do animal, guarda a carne na carga pessoal e reutiliza a entrega para o abrigo. Os contadores `harvests.livestock` e `harvests.livestockMeat` tornam quantidade e unidade produzida observáveis. Nenhuma sazonalidade ou ação neural nova é adicionada.

## Validação e limites

Os cinco testes focados cobrem abate, carne produzida a partir da massa, piso de dois adultos, estoques comunitários/da despensa, idade adulta e percepção local. `npm run audit:food -- --days 253 --seeds 1,42,987,2026 --repeat-seed 42` foi executado antes e depois. No replay de referência da seed 42, a crônica e o estado econômico observável permaneceram iguais; a única diferença de estado é a inicialização dos contadores novos de rebanho, que ficaram em zero. Em todas as quatro seeds, `livestock=0` e `livestockMeat=0`; fome permaneceu 1/0/1/0 e adulto-dias com reserva abaixo de 20 permaneceu 3305/3510/2912/2746. O replay padrão, portanto, não acionou nem demonstrou benefício da nova saída alimentar. A seed 42 repetida no SHA de validação foi determinística (`bfd44499c54b3105aa7e51e0b329291264bbfec484ff0155460911c73b072be3`; crônica `085ee8752bfa2670842c0414a4bb51ba4a8db2325df2d6a37c893b1250c8fc97`). Relatório completo: `docs/verification/JUL-178-food-replays-253-livestock-20261026.json`.

Mantemos o experimento por enquanto porque os testes controlados demonstram a regra e o replay padrão não piorou nem mudou as decisões do jogo; isso **não** satisfaz o aceite de uma cadeia alimentar de rebanho comprovada em cenários longos. Não ajustamos thresholds com base em poucas seeds. O próximo teste necessário é um choque controlado e reproduzível de oferta baixa que exercite a ação na simulação, com estoque, produção, mortes e piso do plantel registrados. Permanecem pendentes os horizontes 365/730 dias, auditoria completa de origem/destino e abastecimento real em campanha.
