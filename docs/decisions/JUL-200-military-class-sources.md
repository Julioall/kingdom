# Decisão — fontes ativas para recrutamento e graduação militar

Data: 27/10/2026
Issue: [JUL-200](https://linear.app/julio-alves/issue/JUL-200/vincular-recrutamento-e-evolucao-de-classes-aos-edificios-ativos)
Estado: recrutamento, graduação e limite residencial implementados; replay demográfico indica variabilidade entre seeds e a issue permanece aberta para validar causa/reserva de vagas e a retomada registrada na crônica.

## Direção

Recrutar e avançar a graduação exige uma fonte operacional da classe. Uma fonte está operacional quando está concluída, não destruída e tem integridade e vida positivas (quando esses valores existem). Uma segunda fonte ativa da mesma classe mantém a função disponível quando a primeira cai.

| Classe | Fonte exigida |
| --- | --- |
| Guerreiro e lanceiro | Centro militar |
| Arqueiro | Arquearia |
| Monge | Monastério |

O centro militar também conserva a capacidade de guarnição. Uma oferta de recrutamento só usa centro concluído, operacional e com vaga real, contando soldados vivos e treinamentos pendentes atribuídos a ele. A perda da última fonte de classe ou de um centro com vaga não remove nem reclassifica soldados existentes.

## Pausa, mérito e retomada

Quando a última fonte de uma classe deixa de funcionar, a graduação dessa classe para e o motivo é registrado uma vez na crônica. Ao reconstruir ou disponibilizar outra fonte, a graduação volta a considerar o mérito elegível que existia antes da pausa. O mérito de combate continua sendo registrado para comando e histórico; a parcela ganha enquanto a graduação está bloqueada não se converte em salto de patente ao voltar a fonte.

Treinamentos já pagos ficam pendentes se perderem a fonte de classe ou o centro militar. Eles retomam sem débito adicional quando os requisitos voltam. Se o centro anterior foi perdido, o treino pode ocupar vaga livre em outro centro operacional do mesmo reino. A interface desabilita classes sem fonte e mostra o motivo nos dados do reino e da pessoa.

## Alternativas consideradas

| Opção | Decisão | Motivo |
| --- | --- | --- |
| Remover ou rebaixar soldados quando o edifício cai | Rejeitada | O requisito é bloquear novos membros e progressão, preservando as funções atuais das unidades existentes. |
| Cancelar treinamento e perder os recursos já debitados | Rejeitada | A perda do prédio é um bloqueio temporário; cobrar de novo ou apagar o progresso criaria uma penalidade duplicada. |
| Permitir promoção imediata por mérito obtido enquanto a classe estava bloqueada | Rejeitada | Isso aplicaria progressão durante a janela em que a fonte necessária não existia. |
| Congelar o mérito de combate por completo | Rejeitada | Esse mérito também afeta a seleção de comando e o histórico militar. Mantém-se o mérito, mas a parte obtida durante a pausa não avança a graduação. |
| Considerar uma classe disponível se qualquer prédio incompleto ou destruído existir | Rejeitada | Um projeto ou ruína não pode treinar ou sustentar uma classe. |

## Limite desta fatia

JUL-200 também pede que abrigos e casas sirvam de origem para novos moradores, respeitando capacidade, custo, comida e limites populacionais. A regra adotada para essa fatia é que reprodução natural só conclui quando existe uma vaga em abrigo ou casa concluídos e operacionais. Casas mantêm suas 13 vagas; abrigos comunitários recebem a mesma capacidade, para que o limite seja legível e comparável. A vaga do recém-nascido é reservada no nascimento e liberada quando o morador morre ou deixa o grupo.

O custo existente de criar uma criança continua explícito: os pais precisam estar alimentados e transferem 7 e 5 pontos de suas reservas para a reserva inicial do bebê, além de pagar energia e hidratação. Não há tarifa adicional em ouro por nascimento nem nova população fixa máxima: o limite corrente é a capacidade residencial construída e paga. Sem vaga ou sem condições alimentares dos pais, o nascimento é adiado sem debitar energia, comida ou cooldown. A hipótese de capacidade de 13 por abrigo é conservadora, derivada da capacidade já usada pelas casas; deve ser revisada por replay de crescimento e mortalidade.

### Moradia e nascimento — alternativas e fontes

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Permitir nascimento sem moradia e deixar `assignHome` tentar resolver depois | Rejeitada | A função podia iniciar uma casa paga, ainda incompleta, e o nascimento mesmo assim terminava; isso deixava o bebê sem vaga operacional. |
| Criar automaticamente uma casa ou uma vaga ao nascer | Rejeitada | Ignora o tempo de construção e transforma capacidade residencial em oferta sem limite observável. |
| Cobrar ouro por criança | Rejeitada | A casa/abrigo já consome recursos na construção, e os pais já transferem reserva alimentar e energia para a criança. |
| Limitar a capacidade de cada moradia e adiar o nascimento quando não há vaga | Escolhida | Reutiliza a capacidade de 13 das casas existentes, torna o abrigo uma moradia funcional e preserva a decisão dos pais de ter filhos apenas quando comida e abrigo permitem. |

SciSpace encontrou modelos de sociedades agrícolas baseados em necessidades domésticas, acesso a recursos e regras sociais, mas não uma capacidade universal de moradores por abrigo; o número 13 vem do contrato existente do jogo, não da literatura. Saqalli et al. (2010), [modelo empírico multiatividade e multidimensional de sociedades rurais](https://doi.org/10.18564/jasss.1547), adverte que modelos de baixa disponibilidade de dados devem ser tratados como provedores de tendências, não de números absolutos. Isso reforça calibrar a capacidade e sobrevivência por cenários locais, sem alegar validade demográfica realista. Consensus foi tentada nesta etapa e recusou novas buscas: a cota mensal de 30 buscas só reinicia em 01/11/2026.

Essa decisão completa o vínculo entre edifício e novos moradores. A reprodução animal continua fora de JUL-200, e não foram adicionados biomas nem mecânicas ecológicas sazonais. O replay anual de quatro seeds em `docs/verification/JUL-200-residential-365-20261027.json` confirma nascimentos humanos e determinismo na repetição da seed 42, mas a variação de mortes por fome e população final não demonstra, por si só, se cada nascimento respeitou a vaga reservada nem se a remoção e reconstrução da última moradia retomam o ciclo com o registro esperado. JUL-200 permanece aberta até essa evidência ficar explícita.

O ciclo agrícola pedido pelo jogador — comprar sementes no mercado, levar à roça, plantar, colher e entregar — segue registrado em [JUL-178-market-seed-cycle.md](JUL-178-market-seed-cycle.md). A implementação permanece atrás da auditoria e do contrato econômico de JUL-178/JUL-201. Não foram adicionadas biomas ou estações agrícolas.

## Evidência e validação

- Fontes conferidas: `commands.js`, `service.js`, `frontier-intelligence.js`, `projects.js`, `initialization.js`, `systems.js` e a inspeção em `game.js`.
- Para a regra residencial, foram conferidos `lifecycle.js`, `construction.js`, `residency.js`, `inventories.js`, `building-card.js` e o registro existente de capacidade 13 das casas.
- Os bloqueios e retomadas são eventos de crônica; a inspeção da pessoa mostra a fonte ausente/recuperada e os treinamentos pendentes mostram a causa da pausa.
- Testes cobrem as quatro classes, fontes alternativas, bloqueio sem custo, pausa de graduação, treinamento pendente sem nova cobrança, centro substituto e repetição determinística do mesmo cenário.
- Teste residencial: `tests/residential-birth-capacity.test.mjs` cobre casa, abrigo comunitário sem reino, vaga cheia/inativa, transferência das 12 unidades alimentares, custo de energia/hidratação, cooldown de 280 dias e liberação de vaga após morte; suíte direcionada final: 12/12.
- Suíte completa: 201/201 testes passaram; `npm run build` passou com `tsc --noEmit` e produção Vite. O build converteu 489 PNGs em WebP sem perdas (8,03 MiB → 5,27 MiB).
- Playtest no navegador: cartão do abrigo mostrou `Moradores / vagas totais: 0 / 13` no dia 242, sem erro de console; screenshot anexado à JUL-200.
- Replay social residencial, SHA `6ff605b4d9862e78963eb4c6d06b889e0a236b4c`, 365 dias, seeds `1, 42, 987, 2026`, sem intervenção: população final `97, 103, 101, 97`; nascimentos humanos `5, 7, 5, 6`; mortes por fome `8, 1, 4, 13`. A repetição completa da seed 42 coincidiu em hash do estado e da crônica. Isso é uma evidência de estresse e de determinismo, não um critério para encerrar JUL-200; o replay não expõe ocupação/vaga por moradia nem a sequência de motivo e retomada.
- GitHub Actions no SHA integrado mais recente `6ff605b4d9862e78963eb4c6d06b889e0a236b4c`: [run #136](https://github.com/Julioall/kingdom/actions/runs/40479627600) passou em `npm ci`, typecheck, 230 testes, replay de comida e build.
- `linear_get_agent_context` foi tentada nesta etapa, mas o servidor respondeu `Tool get_agent_context not found`. As instruções da issue, o código e as evidências locais foram usados.
- SciSpace foi consultado sobre limites de habitação em sociedades simuladas; não encontrou uma capacidade universal, então 13 foi mantido por consistência com as casas atuais. Consensus foi tentada, mas a cota mensal de 30 buscas está esgotada até 01/11/2026. A skill Game Studio `game-playtest` foi aplicada para verificar o painel no navegador.
