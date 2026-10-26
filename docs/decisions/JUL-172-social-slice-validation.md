# JUL-172 — validação do recorte social integrado

Data: 26/10/2026
Issue: [JUL-172](https://linear.app/julio-alves/issue/JUL-172/s2-implementar-encontros-compartilhamento-de-informacao-e-ajuda)
Código-base da auditoria orgânica: `9da250a3cbfc4ab0e09d8d7e3bfd6b5f2c593c78`

## Decisão

Validar o recorte com três evidências complementares: um replay orgânico e repetido do motor, um cenário controlado que passa pelas funções de produção até o HTML do inspetor, e um playtest do navegador em que o inspetor individual mostra memórias produzidas pelo próprio replay. Não adicionar uma tela ou uma mecânica de demonstração ao jogo.

O cenário controlado é necessário para os ramos raros de água indicada e pedido aceito/recusado; ele registra as pré-condições escolhidas e não é tratado como medida de frequência espontânea. O replay natural e a captura verificam que os fatos sociais também chegam à interface a partir de decisões normais dos agentes.

## Fontes consultadas

- **Game Studio / Game Playtest:** preserva a arquitetura atual, inicia o jogo no navegador, inspeciona um ator real e guarda uma captura contextual. A verificação ocorreu no app Canvas/DOM com simulação em Worker; não houve migração de engine nem inserção de estado social no renderer.
- **SciSpace:** a busca sobre V&V de interações sociais em ABM retornou Yilmaz, *Validation and verification of social processes within agent-based computational organization models* ([DOI 10.1007/S10588-006-8873-Y](https://doi.org/10.1007/S10588-006-8873-Y)). O resumo defende verificar os processos locais e sua consistência, sem tomar consistência local como prova suficiente dos resultados emergentes. Isso sustenta combinar cenário causal controlado com replay longo; não valida por si só o comportamento de Kingdom.
- **SciSpace — limite da evidência:** *Generative Experimentation and Social Simulation: Exploring Gaming for Model Verification and Validation* ([DOI 10.1109/ISCCS.2011.94](https://doi.org/10.1109/ISCCS.2011.94)) propõe fontes humanas e experimentação no contexto do jogo para V&V. A captura do inspetor é uma face check qualitativa, não validação empírica de frequência.
- **Consensus:** a cota mensal registrada em JUL-195 continua indisponível até 01/11/2026. Não bloqueia esta fatia; não foi feita nova chamada sem cota.
- **Linear field notes:** `linear_get_agent_context` ainda retorna `Tool get_agent_context not found`; a inspeção da issue e do código foi usada como fonte operacional.

## Alternativas consideradas

1. **Esperar até que água e pedido ocorram organicamente:** rejeitada como critério único porque a janela reproduzível seed 42 não produziu esses eventos; aumentar seeds até encontrá-los não demonstraria o comportamento causal do ramo.
2. **Incluir um modo de demonstração no produto:** rejeitada porque acrescentaria interface e estado de teste ao gameplay sem ser requisito funcional.
3. **Confiar apenas em testes unitários ou apenas em uma captura:** rejeitada porque nenhum dos dois verifica sozinho a passagem dos resolvers de produção para o conteúdo do inspetor.
4. **Combinar replay orgânico, cenário controlado e inspeção real no navegador:** escolhida. Separa frequência natural de cobertura de ramo e deixa cada afirmação auditável.

## Evidência

- `node --test tests/social-evidence.test.mjs tests/social-meetings.test.mjs tests/water-indication.test.mjs tests/social-aid.test.mjs tests/social-inspector.test.mjs tests/social-slice-integration.test.mjs` deve cobrir memória/procedência, reserva e emergência, referência válida de água, ajuda aceita/recusada, idempotência, confiança direcional e texto do inspetor.
- Replay orgânico: [`JUL-172-social-replay-integrated-30-seed42-20261026.json`](../verification/JUL-172-social-replay-integrated-30-seed42-20261026.json). Seed 42, 30 dias, repetição idêntica de estado e crônica; 3 conversas e 11 transferências reais, sem água indicada ou pedidos naquela janela.
- Playtest: [`JUL-172-social-inspector-replay-20261026.png`](../verification/JUL-172-social-inspector-replay-20261026.png). No replay browser `?seed=42&paused=1`, dia 78, Ravi O exibe diretamente as partilhas dos dias 27, 31 e 35 e a confiança aprendida sobre participantes.
- O teste integrado usa uma fixture pequena, água física presente no mapa, sinal local de necessidade, participantes distintos e estoque explicitamente controlado. Confere a saída do renderer do inspetor para conversa, relato de água com procedência/localização, transferência com débito/crédito e pedido aceito/recusado.

## Limites e próxima validação

O seed 42 prova repetibilidade, não prevalência dos eventos sociais na população. Água indicada e decisões de pedido não ocorreram organicamente nesse seed/horizonte; a cobertura desses ramos vem do cenário controlado. Replays adicionais e amostras de holdout continuam necessários antes de qualquer afirmação sobre taxa de interação ou efeito social de longo prazo.
