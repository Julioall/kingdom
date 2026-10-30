# JUL-223 — Alvos militares, defesa local e aviso territorial

**Data:** 27/10/2026
**Estado:** implementação validada por testes; reprodução visual do relato ainda pendente.
**Branch:** `test/kingdom-autonomous`

## Relato e limites da reprodução

O jogador observou um arqueiro atacando um peão que procurava alimento dentro de um acampamento, sem campanha identificada. Também relatou um inimigo atravessando o reino e atacando moradores sem reação das patrulhas ou dos soldados próximos. A sessão original não trouxe seed, dia ou SHA; ela segue registrada como observação, não como reprodução controlada.

No SHA anterior `ca786f893354ad31ec6cbf55a0a394c51ce69890`, um cenário controlado com seed 42, dia 115, arqueiro e residente de reinos diferentes passou um residente pacífico a `fightTacticalRound`; a saúde caiu de 100 para 84,824648. Esse teste demonstra que o resolvedor tático aceitava um civil rival como ameaça, mas não prova que seja a mesma chamada ou estado da captura do jogador.

## Inspeção do caminho atual

* `battlefieldOpponents` selecionava qualquer pessoa de outro reino perto do objetivo de campanha.
* `fightTacticalRound` tratava qualquer pessoa da lista adversária como ameaça. A checagem de reino não distinguia combatente de civil pacífico.
* `defendTowers` só chama o combate de torre quando há campanha ativa.
* `patrolSoldier` percorre waypoints seguros, mas não interceptava um invasor observado em território próprio.
* `markTerritoryStep` já avisava sobre território estrangeiro e `resolveBorderIncursions` gravava uma restrição de entrada por 180 dias ao expulsar alguém. No retorno a chão seguro, porém, a etapa de movimento apagava o sinal visível de captura, apesar da restrição continuar no mapa interno.

## Decisão

1. Centralizar a elegibilidade no mesmo predicado usado na seleção tática e no contato do projétil. Soldados rivais são combatentes possíveis nos encontros que os selecionam. Uma pessoa de outra classe só pode ser alvo se houver evidência direta recente: uma vítima viva do reino defensor registra `lastAttackedById` e `lastAttackedDay` nos últimos dois dias. Propriedade rival, campanha próxima e busca de comida não bastam.
2. Executar uma defesa tática local sem exigir campanha. O defensor e o invasor precisam estar em tiles pertencentes ao reino defensor; o invasor precisa ser soldado ou agressor civil com evidência direta recente; o defensor só avança até 12 células e só usa tiles do próprio reino. Ao sair da fronteira, o invasor deixa de ser alvo e a perseguição termina.
3. Manter civis informados por percepção local. Ao sofrer dano direto, guardar fonte, reino, dia, posição e território, registrar uma lição e elevar moderadamente o risco. Se o dano ocorrer em território estrangeiro, reter o aviso de cautela junto ao prazo de 180 dias. Ao voltar para chão seguro, preservar a memória de abordagem enquanto ela estiver válida.
4. Fazer a patrulha primeiro pela rota que já existe e intervir apenas quando observar a ameaça. Não dar conhecimento global do mapa, não transformar todos os civis rivais em inimigos e não iniciar uma campanha automaticamente.

### Alternativas consideradas

* **Corrigir apenas o arqueiro** deixaria a guarda sem reação, que é a segunda metade do relato.
* **Atacar qualquer pessoa de outro reino** explicaria invasões, mas reproduziria o dano contra moradores pacíficos.
* **Atacar qualquer civil próximo de um soldado** continua sem evidência de agressão e pune coleta/trânsito pacífico.
* **Usar o mapa global para localizar ameaça** reduziria a importância da patrulha e violaria a informação local já definida para a IA.

## Pesquisa consultada e limitações

* O skill Game Studio foi consultado. A recomendação aplicável é preservar a arquitetura existente, fazer a fatia de gameplay pequena e validar combate no navegador; o projeto usa simulação própria, então não foi migrado para Phaser. Nenhuma ferramenta específica do conector Game Studio estava disponível nesta sessão.
* A cota mensal do Consensus estava esgotada (30/30 buscas), com reset informado para 01/11/2026. A indisponibilidade foi registrada; não bloqueou a implementação.
* SciSpace localizou [“Multi-agent patrolling in dynamic environments”](https://doi.org/10.1109/AGENTS.2017.8015305), de Othmani-Guibourg, El Fallah-Seghrouchni e Farges (2017). O resumo compara patrulha reativa simples com planejamento coordenado em um simulador dinâmico e relata melhor adequação da segunda arquitetura naquele cenário. A evidência é específica ao modelo estudado; aqui serve para justificar o cenário de patrulha dinâmica e a medição de resposta, não valores de alcance, agressividade ou balanceamento.
* A nota compartilhada do Linear não pôde ser consultada: a chamada `get_agent_context` retornou “Tool get_agent_context not found”; a gravação de aprendizado retornou o mesmo erro. Este documento e os comentários das issues guardam as observações verificadas.

## Validação

* Reprodução diagnóstica anterior: seed 42, dia 115, SHA `ca786f893354ad31ec6cbf55a0a394c51ce69890`; um civil rival sofreu dano quando passado diretamente ao resolvedor tático. Cenário sintético, não reprodução exata da sessão.
* Testes focados: `node --test tests/territorial-defense.test.mjs tests/combat-contact.test.mjs tests/combat-integration.test.mjs` — 40/40 aprovados.
* Typecheck: `npm run typecheck` — aprovado.
* Suíte completa: `npm test` — 220/220 aprovados (inclui Worker determinístico; ~68 s).
* `npm run typecheck` — aprovado.
* `npm run build` — aprovado.
* Inspeção no navegador em `http://127.0.0.1:4173/`: interface e mapa carregaram; no dia 61 havia 98 moradores, dois reinos e campanhas em marcha. Esse estado comprova apenas o smoke test visual; não reproduziu o ataque ao peão nem a intervenção local. Não foi anexado como evidência de combate.
* O caso sintético de seleção civil, contato de projétil, agressor conhecido, interceptação local e encerramento ao sair do território está coberto por 6 testes novos. A suíte direcionada passou em 40/40.
* Código validado sobre o SHA-base `ca786f893354ad31ec6cbf55a0a394c51ce69890`; commit de implementação e SHA final devem ser registrados no comentário da JUL-223. A issue permanece In Progress até a captura/reprodução do combate em jogo.
