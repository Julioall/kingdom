# Decisão — fontes ativas para recrutamento e graduação militar

Data: 27/10/2026
Issue: [JUL-200](https://linear.app/julio-alves/issue/JUL-200/vincular-recrutamento-e-evolucao-de-classes-aos-edificios-ativos)
Estado: primeira fatia implementada; geração de moradores por abrigo/casa continua pendente

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

JUL-200 também pede que abrigos e casas sirvam de origem para novos moradores, respeitando capacidade, custo, comida e limites populacionais. O nascimento atual não valida esses requisitos antes de criar a pessoa. Essa cadeia de população precisa de desenho e implementação próprios; esta mudança não a declara concluída e não altera reprodução.

O ciclo agrícola pedido pelo jogador — comprar sementes no mercado, levar à roça, plantar, colher e entregar — segue registrado em [JUL-178-market-seed-cycle.md](JUL-178-market-seed-cycle.md). A implementação permanece atrás da auditoria e do contrato econômico de JUL-178/JUL-201. Não foram adicionadas biomas ou estações agrícolas.

## Evidência e validação

- Fontes conferidas: `commands.js`, `service.js`, `frontier-intelligence.js`, `projects.js`, `initialization.js`, `systems.js` e a inspeção em `game.js`.
- Os bloqueios e retomadas são eventos de crônica; a inspeção da pessoa mostra a fonte ausente/recuperada e os treinamentos pendentes mostram a causa da pausa.
- Testes cobrem as quatro classes, fontes alternativas, bloqueio sem custo, pausa de graduação, treinamento pendente sem nova cobrança, centro substituto e repetição determinística do mesmo cenário.
- SHA de implementação, suíte completa, build e replay serão registrados após o commit.
- `linear_get_agent_context` foi tentada nesta etapa, mas o servidor respondeu `Tool get_agent_context not found`. As instruções da issue, o código e as evidências locais foram usados.
- SciSpace/Consensus não foram consultados de novo: esta fatia implementa uma regra de produto e contabilidade já registrada, sem hipótese científica a calibrar. A skill Game Studio `game-playtest` foi aplicada para verificar o painel no navegador.
