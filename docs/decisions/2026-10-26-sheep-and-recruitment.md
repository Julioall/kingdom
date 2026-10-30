# Avaliação da regra ecológica e escopo de rebanho — 26/10/2026

Issues: [JUL-178](https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-cultivo-caca-civis), [JUL-197](https://linear.app/julio-alves/issue/JUL-197/bug-soldado-aparece-executando-transporte-de-pedra), [JUL-198](https://linear.app/julio-alves/issue/JUL-198/expandir-currais-para-35-ovelhas-e-validar-novos-locais), [JUL-199](https://linear.app/julio-alves/issue/JUL-199/implementar-reproducao-manejo-etario-e-limite-de-ovelhas-selvagens), [JUL-200](https://linear.app/julio-alves/issue/JUL-200/vincular-recrutamento-e-evolucao-de-classes-aos-edificios-ativos).

## Regra vigente e avaliação

A regra de produto registrada em JUL-165/JUL-195 é manter recursos finitos e consequências necessárias à sobrevivência, usando estações apenas para representar visualmente a troca de tiles; não adicionar biomas nem simulação ecológica sazonal. Essa é uma boa restrição de escopo: ajuda a manter custos e decisões dos agentes previsíveis e torna os resultados de economia mais fáceis de explicar.

O código inspecionado nesta branch ainda diverge dessa regra:

- `ecology/climate.js:updateClimate` escolhe temperatura média por estação `[19, 25, 21, 15]` e multiplica chuva por `[1.14, .72, .84, 1.26]`.
- `ecology/plants.js:updatePlants` aplica `seasonalGrowth`; raízes cultivadas e brotos para ovelhas têm curvas distintas em `config/ecosystem.js`.
- `ecology/animals.js:reproduceAnimals` já produz filhotes quando há pares elegíveis. A regra usa energia, idade mínima de 200 dias, cooldown de 190 dias e maior chance para pares domésticos recentemente alimentados. Não há, no trecho inspecionado, tempo de cuidado materno escalado pela idade.
- O bloqueio genérico de reprodução consulta tamanho de grupo acima de 68, sem separar teto configurável de ovelhas selvagens. A idade adulta visual/alimentar é 180 dias. JUL-178 já registra produção finita de carne por abate de ovelha adulta, mas o código de caça filtra animais abaixo da idade adulta.

Portanto, “estações só visuais” ainda é a direção correta para a simplificação, mas não descreve integralmente o comportamento atual do runtime. JUL-165 precisa remover ou justificar os acoplamentos atuais de clima e plantas antes de somar um novo efeito sazonal. A solicitação explícita do usuário em 26/10/2026 revisa o alvo somente neste ponto: após a simplificação, a taxa de respawn de ovelhas selvagens será menor no inverno. Nenhum outro fluxo sazonal será introduzido.

## Decisões para as issues

1. **Comida da roça e do rebanho:** anexar a observação do jogador à auditoria JUL-178, sem abrir duplicata. A observação não veio com seed, dia, SHA ou captura; ela ainda precisa ser reproduzida. Os arquivos existentes demonstram ledger, abate sob choque controlado e entrega, mas os replays padrão anteriores tinham abate de rebanho igual a zero. Isso não prova que o fluxo autônomo consuma a comida ao longo de uma partida.
2. **Filhotes, cuidado e carne por idade (JUL-199):** estender o nascimento já existente com estados mínimos de cuidado e progressão etária. Permitir abate em diferentes idades e derivar carne da massa/idade, debitando a ovelha e creditando o ledger uma única vez. Faixas de maturidade adulta podem reduzir intervalos de nascimento e cuidado como regra de gameplay, com mínimo/máximo e sem aceleração ilimitada na velhice.
3. **Respawn selvagem:** adotar teto global explícito e configurável para ovelhas selvagens, independente do limite de 35 por curral doméstico (JUL-198). Quando estiver abaixo do teto, a população pode se recompor gradualmente; no inverno, a taxa é menor. Não decidir um número sem comparar com a população padrão do mapa e sem medir replays.
4. **Curral e edifícios (JUL-198/JUL-200):** validar espaço e materiais antes da construção. A capacidade de 35 é por curral. Fontes operacionais habilitam moradores, arqueiros e monges; destruir a última fonte da classe pausa recrutamento e progressão daquela classe, preservando unidades e mérito já obtido, até construir substituta.
5. **Soldado com pedra (JUL-197):** registrar como observação sem reprodução; verificar transição de promoção, tarefa civil pendente e estado visual antes de atribuir causa.

## Alternativas consideradas

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Manter todas as estações apenas visuais | Revisada parcialmente | A regra facilita testes, mas o usuário pediu explicitamente respawn de ovelhas mais lento em uma estação. |
| Restaurar clima, plantas e reprodução sazonais completos | Rejeitada | Acrescenta acoplamentos que JUL-165 busca retirar e dificultaria atribuir fome, regeneração e população às causas certas. |
| Limitar a exceção sazonal à taxa de respawn selvagem no inverno | Escolhida | Atende ao pedido com um único parâmetro isolável; manter um teto absoluto e testes de determinismo contém o crescimento. |
| Tratar o envelhecimento como previsão biológica literal | Rejeitada | A fonte consultada não demonstra que a gestação ou o cuidado fiquem mais rápidos a cada ano de idade. Usar faixas de maturidade adulta como abstração de gameplay, com limites declarados. |

## Fontes e limitações

- **SciSpace:** Aktaş et al., [“Effects of ewe live weight and age on reproductive performance, lamb growth, and survival in Central Anatolian Merino sheep”](https://doi.org/10.5194/aab-58-451-2015), estudo com 4.935 ovelhas e 5.548 cordeiros. O resumo relata associação da idade/peso com desempenho reprodutivo e crescimento, e fertilidade/partos múltiplos menores em ovelhas de 1,5 ano que nas mais velhas. Não demonstra gestação nem cuidado materno mais rápidos. A fonte informa uma faixa possível para abstração de maturidade, não calibra cooldowns do Kingdom.
- **Consensus:** consultado; a busca informou que as 30 consultas do mês foram usadas e reinicia em 01/11/2026. Não foi possível obter uma segunda revisão de literatura nesta etapa.
- **Game Studio:** lida a skill local `game-studio`. Preservar a arquitetura atual do jogo, deixar regra de simulação fora do renderer e fechar as alterações de gameplay com replay/playtest; nenhuma migração de engine é proposta.
- **Notas do Linear:** `linear_get_agent_context` foi chamada e retornou `Tool get_agent_context not found`; código, issues e evidências do repositório foram usados como referência operacional.
- O artigo de ovelhas é um estudo de uma população/raça; não é evidência universal de que todas as ovelhas mais velhas sejam mais férteis nem de que cuidem mais rápido.

## Validação pendente

As issues definem os testes e replays necessários; esta decisão não altera runtime. JUL-199 deve provar teto exato, reaparecimento abaixo do teto, respawn de inverno menor e determinismo em múltiplas seeds. JUL-198 deve testar 34/35/36 animais e área inválida sem custo. JUL-200 deve testar cada fonte, perda da última fonte e retomada após reconstrução. A observação sobre comida e a pedra devem ser reproduzidas antes de afirmar causa. Nenhum teste de runtime foi executado nesta etapa de registro.

## Estado do repositório

Branch `test/kingdom-autonomous`, HEAD `588e067`; após `git fetch kingdom main`, a branch estava 108 commits à frente e 0 atrás de `FETCH_HEAD` (main `b367276`). O trabalho preexistente permaneceu no diretório. Esta nota não altera código, não resolve nem fecha issues e não comprova os novos critérios de gameplay.
