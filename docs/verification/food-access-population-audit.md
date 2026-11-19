# Auditoria alimentar com perfil real do navegador (novembro de 2026)

## Problema observado

O comando `npm run audit:food` usava apenas `engine.createWorld(seed)`, que inicia a configuração legada de 96 pessoas. O navegador passou a iniciar 500 pessoas com 80% de soldados. Portanto, resultados históricos da auditoria não validam automaticamente o novo perfil.

Esta entrega é **instrumentação**, não uma correção da política de alimentação. A auditoria mantém o modelo de alimentos, comércio e ecologia sem alterações.

## Execução

O comportamento legado continua sendo o padrão para reproduzir revisões anteriores:

```bash
npm run audit:food -- --days 30 --seeds 42 --repeat-seed 42
```

Para reproduzir o perfil do navegador, com 500 pessoas, das quais 400 soldados:

```bash
mkdir -p out
npm run audit:food -- --days 30 --seeds 42 --repeat-seed 42 --population 500 --military-share 0.8 --output out/food-access-500-30.json
```

Repetir depois em 90, 180, 365 e 730 dias, conforme o custo medido. Evitar começar pela maior execução quando o perfil ainda não tiver desempenho e sobrevivência caracterizados. Para comparar com uma configuração antiga, remover as duas flags de população.

`--population` aceita inteiros entre 96 e 5000. `--military-share` aceita apenas `0.8`, conforme o contrato atual do gerador de mundos. Especificar `--population 500` **sem** `--military-share 0.8` não reproduz a proporção militar do navegador. Os valores efetivos do mundo são registrados por seed em `initialPopulation` e `initialMilitaryCount`, e as opções utilizadas aparecem em `worldOptions`.

## Campos novos no relatório

`foodAccessByKingdomAndRole` separa pessoas por reino e por grupos `military` (soldados) e `non-military` (todos os demais, inclusive governantes):

- `observedAdultDays`: número de pessoas-dia vivas com idade a partir de 12 anos.
- `criticalAdultDays`: pessoas-dia adultas com `foodReserve < 20`, o mesmo limiar da auditoria histórica.
- `criticalAdultDayRate`: proporção de pessoas-dia adultas observadas em condição crítica.
- `invalidReserveAdultDays`: valores ausentes, não numéricos ou infinitos, que não devem ser contabilizados como reservas suficientes.
- `criticalWithCommunityStock`, `criticalWithTreasuryStock`, `criticalWithMarketStock`: pessoas-dia críticas quando a conta indicada tinha estoque positivo. As categorias **se sobrepõem** e não devem ser somadas.
- `criticalWithAnyRecordedStock`, `criticalWithoutRecordedStock`: classificação exclusiva segundo as três contas acima.
- `starvationDeathsAllAges`, `starvationDeathsAdults`: mortes acumuladas por fome, considerando respectivamente todas as idades e a faixa adulta.

**Atenção:** estoque contabilizado em tesouro, mercado ou comunidade não comprova que o indivíduo podia alcançá-lo, recebê-lo ou pagá-lo. O indicador `criticalWithAnyRecordedStock` é uma pista para investigar barreiras de acesso, não uma prova de defeito na IA. Alimento selvagem, carga individual e reservas de campanhas não estão nessas três contas.

## Critérios da próxima etapa

1. Checar se `initialPopulation` e `initialMilitaryCount` batem com o perfil que foi solicitado.
2. Garantir que `adultDaysFoodReserveBelow20` equivale à soma de `criticalAdultDays` dos grupos reportados.
3. Confirmar repetibilidade com `--repeat-seed`; comparar os hashes autoritativos e da crônica.
4. Inspecionar indivíduos vulneráveis com `scripts/diagnose-food-deaths.mjs` e replays controlados antes de modificar pesos da IA ou criar novos estoques.
5. Avaliar o comportamento por reino e por profissão com o tempo: mortes não precisam ser zero, mas precisam de causa explicável, recuperação possível e estoque conservado.

Testes isolados da instrumentação: `node --test tests/food-access-metrics.test.mjs`. A suíte integral, a auditoria real com 500 pessoas e o build precisam ser executados na branch/CI antes da aprovação do PR.
