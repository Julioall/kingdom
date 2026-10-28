# Abandono dos reinos e abastecimento até o dia 4.500

Data: 25/10/2026. Semente usada na comparação: 42. Mapa e população inicial mantidos.

## Diagnóstico

- O centro da comunidade do reino seguia a média das posições dos moradores. Coleta e combate deslocavam esse centro, que também servia como destino de entregas e referência da ausência.
- A ausência considerava apenas distância maior que dez células. Uma pessoa em casa, em território próprio ou cumprindo uma viagem de trabalho podia atingir 45 dias de ausência e perder o vínculo quando a satisfação geral caía.
- A migração humana pontuava grama, que não integra a dieta humana, e não considerava raízes cultivadas nessa pontuação.
- Os lotes de coleta eram interrompidos pela governança: a primeira coleta convertia imediatamente a tarefa em entrega.
- Campos construídos podiam acumular milhares de unidades de raízes enquanto os estoques ficavam vazios. A delegação dependia de alimento na percepção pessoal e não indicava a roça conhecida pelo reino. Uma tarefa de campo produtiva também terminava após uma coleta, deixando o trabalho sem ordem até a próxima rodada de governança.
- O limite fixo de cinco trabalhadores urgentes não acompanhava a demanda alimentar. Materiais reais do tesouro não eram usados para preparar abrigo e cultivo quando o estoque comunitário não conseguia iniciar essa cadeia.

## Alterações

1. Comunidades de reinos usam a posição do castelo, com a sede registrada como alternativa. Comunidades independentes conservam seu movimento anterior.
2. Casa válida, território próprio e deslocamento produtivo em serviço da comunidade preservam a ligação residencial. Uma atribuição sem movimento não protege indefinidamente. A saída por ausência prolongada exige dificuldade pessoal; afastamento real com privação continua podendo provocar abandono.
3. A migração considera os alimentos humanos: frutos e raízes cultivadas.
4. A tarefa de coleta estratégica mantém a fase de coleta durante a formação do lote. A fase de entrega começa quando a pessoa realmente executa a entrega.
5. A colheita de um campo próprio pode entrar na reserva local durante o trabalho no talhão. A biomassa é retirada antes do depósito, com a reserva de raízes preservada; nenhuma produção é criada sem colheita.
6. Ordens de alimento podem indicar uma roça comunitária concluída, inclusive fora da visão pessoal. A ordem informa um local conhecido do reino; a percepção continua sendo usada para escolher recursos dentro do campo. A tarefa permanece ativa enquanto o estoque está crítico, respeitando expiração e recuperação pessoal.
7. A capacidade de delegação alimentar urgente considera a demanda dos membros e a capacidade de colheita dos adultos disponíveis. Os critérios de saúde, água, energia e alimento para trabalhar continuam ativos.
8. Madeira e pedra necessárias ao primeiro abrigo e à primeira roça podem ser transferidas do tesouro para a comunidade. A transferência exige saldo suficiente para os dois materiais, conserva os totais e fica registrada. Sementes e construção continuam tendo custos e progresso reais.

## Comparação

Comando PowerShell: definir `LATE_DAYS=4500` no ambiente e executar `node scripts/diagnose-late-survival.mjs`.

| Resultado no dia 4.500 | Antes | Depois |
| --- | ---: | ---: |
| Pessoas vivas | 53 | 143 |
| Vinculadas a Valedouro | 8 | 73 |
| Vinculadas a Corvânia | 2 | 70 |
| Independentes entre os sobreviventes | 43 | 0 |
| Abandonos acumulados observados | 60 | 0 |
| Satisfação de Valedouro | 0,315 | 0,537 |
| Satisfação de Corvânia | 0,392 | 0,459 |

Fontes completas: `kingdom-abandonment-before.jsonl` e `kingdom-abandonment-final.jsonl`. A comparação altera a trajetória, inclusive nascimentos e mortes; a diferença de população não representa uma contagem isolada de mortes evitadas. Uma semente não garante o comportamento de todas as partidas.

## Limitações que permanecem

- Ainda há escassez de alimento. No último dia, a reserva comunitária de Valedouro estava praticamente zerada e a de Corvânia em aproximadamente 34,62 unidades. Tesouro e mercado de ambos estavam sem alimento. As reservas comunitárias tiveram reposições ao longo do replay; não foi demonstrada abundância estável.
- A população cresceu sem ampliação proporcional do número de campos: cada reino terminou com uma roça concluída. A expansão da produção conforme a população aumenta ainda precisa de trabalho.
- A validação que exige nenhuma morte por fome até o dia 253 continua falhando, com três mortes por fome. Essa expectativa não foi removida ou relaxada.
- As regras corrigidas previnem o esvaziamento observado no replay novo. Não foi implementada recuperação automática de cidadania para pessoas que já haviam abandonado um reino numa partida em andamento.

## Validação

- 13 testes novos de residência, centro fixo, migração para alimento, financiamento com conservação de materiais, colheita local e ordens agrícolas foram aprovados.
- Suíte completa: 303 de 306 testes passaram na primeira execução. As três falhas foram timeout de um benchmark de IA, fixture sazonal e sobrevivência até 253 dias.
- O benchmark de IA passou isoladamente. A fixture sazonal foi corrigida para comparar plantas silvestres fora do talhão cultivado, mantendo as comparações de crescimento; passou isoladamente. O teste de abandono legítimo também passou após posicionar a pessoa em terra comum, fora do território e da casa.
- A falha de sobrevivência permanece aberta. Não se afirma que a suíte completa esteja aprovada.
- `npm run build` passou; permanece o aviso do bundle principal acima de 500 kB.
