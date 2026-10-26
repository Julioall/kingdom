# JUL-178 — dependentes e suprimento da guarnição

**Status:** implementação em validação; JUL-178 permanece In Progress.

## Evidência reproduzível

No replay seed 42/800 dias em `ad06270f01d9d90f41906ac9579b7bf70a5d640e`, o auditor encontrou duas mortes humanas por fome:

- Ivo Filha morreu no dia 478, com saúde 99,86, hidratação 99,76 e reserva 0,1. Tinha um ano e morreu no primeiro dia registrado sem cuidador próximo. O histórico anterior mostra cuidado e reserva de 0,42; o guardião era um soldado sem reserva e o estoque comunitário era zero. O limite `foodReserve <= .1` em `updateDependent` causava a morte sem colapso de saúde.
- Ema D morreu no dia 618, com saúde 0,026 após perdas de saúde por fome. Era soldado fora de campanha, com centro militar designado, reserva pessoal zero e 38,15 unidades no estoque da comunidade. O agente selecionava `forage`; a sobrevivência forçada sobrepunha o retorno à guarnição. `campaignOrderFor` fornecia `fieldCommandPost`, mas a política passava qualquer ordem como campanha ativa. Além disso, o retorno restringia a rota a tiles já pertencentes ao próprio reino.

O mesmo replay terminou com 92 pessoas vivas, sem estoques agregados negativos e ledger completo de 16 lados de campanha. Biomassa comestível no entorno não provava que o recurso fosse uma âncora de coleta acessível; não foi observada falta global de biomassa que justificasse aumentar geração.

## Decisões

1. **Dependentes:** a reserva baixa não é condição terminal. O sistema mede alimento consumido, refeição comunitária e transferência real de cuidador; a parcela de necessidade que continuar sem cobertura reduz saúde pela mesma escala de perda diária usada para adultos. A morte ocorre por colapso de saúde ou hidratação. Isso permite recuperação após uma falha breve de cuidado e ainda mata dependentes submetidos a privação persistente. Nenhum alimento é criado.
2. **Guarnição:** soldado em paz com reserva abaixo de 42 retorna a um centro militar somente quando tesouro ou comunidade oficial têm alimento disponível. Com estoque, o retorno tem prioridade sobre forrageio e repouso; sem estoque, a coleta local permanece como contingência. A ração continua debitada por `drawGarrisonRation` das contas existentes.
3. **Rota e estado de campanha:** `fieldCommandPost` não é uma campanha. A política agora sinaliza campanha apenas quando `campaignOrder.campaign` existe. O retorno usa a navegação normal e a exceção territorial já permitida a soldados com fome crítica, sem exigir que toda a rota atravesse apenas tiles próprios.
4. Não aumentar biomassa, regeneração ou alcance de percepção; não adicionar estação, bioma ou mecânica ecológica sazonal.

## Alternativas consideradas

- **Manter a morte imediata a 0,1 reserva:** rejeitada; mata uma criança saudável depois de uma única interrupção curta do cuidador.
- **Remover a reserva terminal sem registrar déficit:** rejeitada; permitiria privação prolongada sem efeito alimentar explícito sobre saúde.
- **Permitir retirada militar irrestrita de qualquer estoque comunitário:** rejeitada; a guarnição usa o canal oficial do reino e só retorna quando há saldo real.
- **Forçar retorno mesmo sem alimento disponível:** rejeitada; prenderia o agente em uma ordem sem benefício e impediria a coleta local que ainda funciona.
- **Aumentar a ecologia:** rejeitada; os traces apontaram condições de acesso e prioridade, não falta global de alimento.

## Pesquisa e limites

A busca SciSpace perguntou: “In agent-based simulation models of human or animal foraging under food scarcity, how should agents balance target persistence and re-planning when resources are spatially distributed, so they avoid starvation without generating resources or using omniscient information?”

- Guo e Hermundstad, [“Efficient planning and implementation of optimal foraging strategies under energetic constraints”](https://doi.org/10.1093/pnasnexus/pgag009), descrevem o balanço entre custo energético de busca, retorno de patches e crenças sobre recursos ainda desconhecidos. Apoia modelar custo/localidade, mas não calibra os valores de Kingdom.
- Roberts e Goldstone, [“EPICURE: Spatial and Knowledge Limitations in Group Foraging”](https://doi.org/10.1177/1059712306072336), modelam forrageio em grade a partir de percepção e reforço locais e mostram que restrições espaciais afetam a coleta de informação. É evidência metodológica, não prova da regra de guarnição.
- Müller et al., [“Modelling food security: Bridging the gap between the micro and the macro scale”](https://doi.org/10.1016/j.gloenvcha.2020.102085), orienta medir consequências individuais e agregadas ao longo do tempo; não valida um limiar específico.

Consensus continua sem cota até 01/11/2026 (30 buscas mensais utilizadas). O conector Game Studio não está disponível; o skill local `game-playtest` foi consultado. Estas mudanças são lógica de simulação, sem efeito visual ou de combate, portanto não exigem screenshot de navegador. O conector de contexto compartilhado do Linear falhou com `get_agent_context` não encontrado; a issue JUL-178, código, testes e replays forneceram o contexto restante.

## Validação

- Dependentes: regressões direcionadas 4/4.
- Forrageio, sobrevivência, retorno e ração: 3/3; conjunto de comida/logística 15/15.
- Suíte completa: 170/170 com `node --test --test-concurrency=1 tests/*.test.mjs`. A execução padrão paralela junto de build e typecheck excedeu 180 s no Worker de campanha; o mesmo teste passou isolado em 127,4 s e na suíte serial em 117,7 s.
- `npm run typecheck`: passou.
- `npm run build`: passou (107 módulos; 489 PNGs otimizados pelo script existente, 8,03 MiB → 5,27 MiB).
- SHA dos dois commits: `7aae564` (dependentes) e `3d16459` (guarnição); branch `test/kingdom-autonomous` atualizada em fast-forward.
- Replay pós-correção de seed 42/253 dias em `3d16459d205af2d4f37917d3ae5eaa4ebffef20a`: concluído duas vezes; estado `7a6d497ecb1be0b4ddb72a0f1e5c62d880afa5c5e6ad5356a3d66cfed088ecf5` e crônica `e5b41dee6cb986cd70f4f90f846ccc02ecf3bf9b38012bf33d65b6203d98a295` coincidiram byte a byte. Resultado: 99 pessoas vivas; nenhuma morte humana por fome (1 combate), uma morte de animal selvagem por fome; 3.939 adultos-dia com reserva <20; 70 batalhas, 78 transações de mercado; logística de 4 lados completa, sem diferenças de origem ou balanço; sem estoques agregados negativos.
- O replay de 800 dias, seed 42, no SHA `3d16459d205af2d4f37917d3ae5eaa4ebffef20a` está em execução para localizar eventual regressão de longo prazo após as duas correções. A ausência de fome humana em 253 dias não fecha o aceite de multissemente/choques.

JUL-178 permanece aberta até a validação de longo prazo, demais seeds/horizontes, choques de oferta, dependentes, cultivo/rebanho e reconciliação militar exigidos no aceite.
