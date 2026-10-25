# Plano de testes e integração da IA

Data: 24/10/2026. Estado: I0 concluída; serviço I1 operacional localmente; rei I2, general I3 e formações determinísticas I4 integrados em estágio experimental. I5 tem um avaliador piloto de redes de cidadãos, sem dados para seleção; comparação militar e validação de escala permanecem planejadas.

## Estado verificado nesta revisão

- **I0 concluída:** manifesto de papéis/modelos; contrato versionado com identidade, época, agente, ordem, campanha, validade, fatos e ações; rejeição no Worker de resposta antiga, duplicada, expirada ou incompatível; parser de decisão aplicado exige JSON completo. Os cenários sintéticos e contratos estão em `tests/integration/ai-contract.test.mjs` e `tests/integration/ollama-service.test.mjs`.
- **I1 implementada, operacional em teste local:** serviço Ollama de loopback com fila de uma inferência, máximo de oito aguardando, validação, cancelamento, prioridade, health e digest. `npm run dev` inicia o jogo e o serviço; `npm run preview` faz o mesmo para o build; `npm run ai:prepare -- --check` inspeciona a instalação; `--pull` baixa modelos ausentes com progresso.
- **I2 experimental:** o pedido de um rei atravessou o Worker, foi respondido pelo `qwen2.5:0.5b` instalado e alterou o plano validado do reino. Uma verificação local, seed 42, retornou `forage_for_food` em 2.353 ms e o Worker aplicou `secure-shared-food`/`forage`. Na calibração sintética schema, 24 respostas por orçamento: 96 tokens = 29,2% utilizáveis, 45,8% de contratos completos e 54,2% truncadas; 192 = 70,8% utilizáveis, 100% de contratos completos e 0% truncadas; 256 repetiu 70,8% e 0% de truncamento. O menor orçamento observado, 192, foi selecionado provisoriamente. A primeira justificativa revisada inventava fatos sobre a guarnição; o inspetor agora marca justificativas como não verificadas. O resultado não aprova o papel em 30 seeds nem demonstra justificativas fundamentadas.
- **I3 experimental:** o Worker também entrega relatórios isolados por campanha e lado ao `smollm2:135m`. O general recebe fatos de efetivo, objetivo, suprimentos, coesão e oposição; escolhe `advance`, `hold_position` ou `withdraw` dentro de uma lista fechada. O Worker valida identidade, época, versão da ordem, campanha, validade e ação; manter posição interrompe a marcha, avançar preserva o objetivo e retirar encerra a campanha por armistício. Pedidos e efeitos têm histórico limitado e aparecem no inspetor. Há cobertura sintética de campanhas isoladas e roteamento pelo Worker, mas ainda não há amostra humana de justificativas nem validação em 30 seeds; o papel segue experimental.
- **I4 experimental:** cada lado de uma campanha tem formação determinística em coluna, postos individuais espaçados e orientação para o destino. Em frente aberta, pode abrir em linha; os estados formar, marchar, manter, atacar e retirar e as mudanças ficam registradas. A coesão e as baixas de integrantes são medidas; a coesão modifica força e exposição no confronto, e bloqueios de movimento são contados. O inspetor exibe forma, líder, estado e coesão; a batalha registra os dados das duas formações. Testes cobrem geometria, espaçamento, mudança linha/coluna entre frente aberta e passagem estreita, sucessão do líder e reorganização após baixa, transições, coesão, bloqueio e registro em batalha. Ainda não há aprovação T2: obstáculos reais de rota, alvo fora de alcance e troca de ordem durante marcha precisam de cenários integrados; o líder designado ainda não toma decisões próprias.
- **I5 experimental, apenas instrumento inicial para T4 de cidadãos:** `npm run evaluate:people-networks` executa controle por regras e redes com 4/6/9 neurônios ocultos em seeds pareadas, salvando configuração e resultados brutos em `reports/neural-evaluation/`. Um smoke test de 1 seed × 5 dias confirmou quatro relatórios, mas não mede qualidade nem permite escolher arquitetura. A ferramenta não altera o padrão do jogo e não cobre soldados, comandantes, treinamento congelado ou as 30+30 seeds de seleção/validação.
- **Instalação observada:** Ollama 0.40.6; Qwen `Q4_K_M`, 397.821.319 bytes, digest `a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67`; SmolLM2 135M `F16`, 270.898.672 bytes, digest `9077fe9d2ae1a4a41a868836b56b8163731a8fe16621397028c2c76f838c6907`. A leitura completa fica em `.local/ai-model-installation.json`, ignorado pelo Git. O limite de saída 192 é provisório; comparar 96/192/256 antes de fixá-lo.
- **Ainda não implementado:** comandantes com decisão própria; avaliação de redes militares e execução comparativa de longo prazo dos candidatos; carga de 730 dias × 30 seeds, diagnóstico de memória/CPU e fluxo de recuperação interativo. Não declarar esses papéis como ativos.
- **Licenças e distribuição:** os pesos não são copiados ao repositório nem ao build; a preparação usa Ollama. Antes de redistribuir modelos ou um instalador que os inclua, revisar as licenças/model cards vigentes de cada modelo e acrescentar os avisos exigidos.

## Objetivo e decisões do projeto

Integrar os modelos ao jogo, com instalação assistida, configuração, execução, diagnóstico e decisões aplicadas à simulação. O benchmark isolado permanece como ferramenta de avaliação, mas não substitui a integração.

| Camada | Controlador definido | Responsabilidade |
|---|---|---|
| Rei | `qwen2.5:0.5b` via Ollama | Prioridades do reino, recursos, mobilização e objetivos estratégicos. |
| General | `smollm2:135m` via Ollama | Traduzir os objetivos autorizados em planos de campanha, abastecimento, avanço, defesa e retirada. |
| Comandante | Comparar regras, redes com 9/16/32 neurônios ocultos e SmolLM2 135M compartilhado | Coordenar uma formação e escolher manobras dentro das ordens do general. |
| Soldado comum | Controle operacional local; comparar regras e redes com 6/9/16 neurônios ocultos | Ocupar posição, acompanhar a formação e executar ações autorizadas. |
| Cidadão | Rede local; comparar 4/6/9 neurônios ocultos | Necessidades, trabalho e deslocamento individual, escolhendo o menor tamanho que preserve resultados. |

Needle permanece excluído. Os números de neurônios são candidatos experimentais, não vencedores medidos. O tamanho indicado refere-se à camada oculta, não ao total de parâmetros. Cada indivíduo mantém estado próprio. Os pesos dos LLMs são carregados uma vez por modelo e atendem vários agentes por uma fila; não existe uma cópia dos pesos por pessoa.

## Base existente e lacunas

- `src/ai/local-engine.js` coordena Qwen para o rei e SmolLM2 para o general pelo serviço local do Ollama. O mesmo processo compartilha fila, limite de uma inferência e contingência determinística.
- `src/app/session.ts`, `src/simulation/protocol.ts` e `src/simulation/worker-runtime.js` já possuem um caminho de pedido e aplicação de decisões estratégicas, com controle de época do mundo.
- `src/simulation/kingdoms/strategy.js` produz relatórios e valida escolhas estratégicas. A simulação continua sendo a única dona de estoques e ordens.
- `src/controllers/individual/neural.js` usa redes locais e utilidades. A configuração ativa possui 18 entradas, 9 neurônios ocultos para pessoas comuns e 50 para o personagem governante. O avaliador experimental pode comparar residentes com controle por regras ou largura 4/6/9, sem alterar essa configuração ativa; a rede atual atualiza apenas pesos da saída, portanto largura maior não garante melhor aprendizado.
- Campanhas, suprimentos, patrulhas e perdas já existem. O general emite ordens versionadas por lado, e campanhas instanciam formações individuais em linha/coluna. Os postos influenciam movimentação, a coesão participa da força e da exposição a baixas, e eventos de batalha guardam o estado observado. Faltam comandantes com decisão própria e aprovação da matriz operacional T2.

O cérebro individual do personagem rei pode continuar atendendo necessidades físicas. O Qwen assume o planejamento do reino; são responsabilidades distintas.

## Arquitetura de integração

Fluxo: interface → coordenador de IA → serviço local do projeto → Ollama → decisão proposta → Worker de simulação → validação → aplicação → resultado observado.

1. Criar um manifesto de modelos em `src/ai/`, associando rei a Qwen e general a SmolLM2. Registrar tag, digest efetivamente instalado, quantização, contexto, limites de saída e versão do contrato de decisão.
2. Criar adaptador Ollama e serviço local vinculado ao endereço de loopback. O serviço oferece operações específicas de IA; não funciona como proxy arbitrário. O jogo chama a mesma interface em desenvolvimento e no build local de produção. Configurações de origem e porta ficam no projeto.
3. Entregar comandos de preparação e execução: verificar instalação do Ollama, conferir/baixar modelos ausentes, mostrar progresso, testar saúde e iniciar o serviço junto do jogo. Instalação do runtime Ollama é um pré-requisito explicitado; pesos baixados localmente ficam fora do Git. Incluir manifesto e instruções de distribuição/licenças, sem embutir pesos sem revisão.
4. Introduzir um coordenador compartilhado com fila limitada e inicialmente uma inferência total em andamento. Priorizar mudanças urgentes, evitar duplicatas e substituir pedidos pendentes superados por ordens novas. Comparar posteriormente residência simultânea dos dois modelos com carregamento sob demanda.
5. Generalizar os pedidos para incluir `requestId`, `worldEpoch`, papel, agente/reino/campanha, versão da ordem, dia do relatório, prazo de validade, contexto observado e ações permitidas. Contextos e históricos continuam isolados por agente.
6. Aplicar apenas respostas do pedido atual. O Worker rejeita época antiga, duplicata, papel incorreto, entidade morta, campanha encerrada, ordem substituída, ação ilegal ou decisão expirada. Validar novamente os recursos e o estado no momento da aplicação.
7. A simulação avança enquanto a inferência ocorre. O plano vigente e a política local continuam executando; falhas ativam a política de contingência explicitamente indicada na interface. Respostas atrasadas não desfazem ações já executadas.
8. Consultas ocorrem por eventos e intervalos configuráveis, nunca por quadro de renderização. O rei parte do intervalo atual de 24 dias simulados. O general tem intervalo inicial experimental de 12 dias, reduzido para 5 em alerta de suprimentos, coesão ou rota; calibrar esses gatilhos e a competição entre papéis no teste de carga.
9. Registrar pedidos, propostas, rejeições, decisões aplicadas e seus efeitos. Um replay reutiliza as decisões gravadas: mesma seed sozinha não reproduz a geração assíncrona dos LLMs.

O suporte anterior a WebLLM deve passar pela mesma interface de provedor se for preservado. A rota principal desta entrega é Ollama local; um site remoto precisaria de uma estratégia própria de hospedagem/runtime, fora da distribuição local planejada aqui.

## Plano de testes, antes da adoção de cada camada

### T0 — Baseline, instrumentação e contratos

- Registrar estado atual da suíte e do build sem confundir falhas preexistentes com regressões.
- Medir simulação sem LLM, IA WebLLM atual e políticas determinísticas. Registrar hardware, GPU, versões, tamanhos instalados e configurações.
- Preparar cenários e separar seeds de treinamento/calibração das seeds de validação e do teste final. Usar situações equivalentes e inverter lados/posições para reduzir favorecimento por mapa ou defensor.
- Testar JSON inválido, truncamento, ID fora da lista, resposta repetida, timeout, cancelamento, reset, troca de ordem e resultado recebido após fim da campanha. Testar isolamento entre reinos e agentes.
- Exigir 100% de rejeição das ordens inválidas na suíte. Nenhuma resposta pode criar recursos, declarar guerra sem autorização ou alterar o mundo diretamente.

### T1 — Qwen rei e SmolLM2 general

- Manter os cenários anteriores como regressão e ampliar para relatórios completos com prioridades concorrentes, recursos insuficientes, informação antiga, inimigo desconhecido e petições contendo instruções indevidas.
- Medir separadamente ação correta, contrato completo, truncamento e ação efetivamente aplicada. Não contabilizar aceitação pelo parser textual como JSON completo.
- O limite anterior de 96 tokens truncou muitas respostas do Qwen. Comparar 96/192/256 tokens, justificativa curta e saída mínima; escolher o menor orçamento que preserve contrato e acerto na validação. Fixar essa configuração antes do teste final.
- Avaliar cada papel isolado e depois ambos juntos, com decisões realmente passando pelo protocolo e alterando o jogo. Fazer revisão humana de uma amostra de justificativas e conferir se usam apenas fatos observados.
- Usar pelo menos 30 seeds de validação para replays completos; ajustar a duração até cobrir mobilização, abastecimento, confronto, retirada e recuperação econômica. Reservar outras 30 seeds para o resultado final. Repetições do mesmo caso não contam como cenários independentes.
- Comparar controle por regras, Qwen rei com general por regras, general SmolLM2 com rei por regras e ambos os modelos. A seleção dos modelos por papel já foi definida pelo usuário; o teste decide prompts, frequência e prontidão, não troca modelos silenciosamente.

### T2 — Formação e obediência dos soldados

- A referência determinística já está conectada às campanhas: linha/coluna, posições individuais, espaçamento, orientação, destino e estados formar/marchar/manter/atacar/retirar. Trocas de formação e de estado têm transição registrada. Completar e medir a matriz abaixo antes de aprovar T2.
- Cenários: campo aberto, passagem estreita, obstáculo, líder morto, perda de integrantes, alvo fora do alcance, ataque sem autorização, retirada e nova ordem durante marcha.
- Ordens autorizadas, alvo permitido, alcance, terreno e ocupação são restrições do motor. A rede só escolhe entre ações legais. Formação admite desvios controlados para obstáculos, emergência física e retirada autorizada; cada exceção é registrada.
- Medir tempo para formar/chegar, distância aos postos, integrantes fora da formação, colisões/bloqueios, cumprimento das ordens, perdas e ataques indevidos. Proibir ataques sem autorização em todos os cenários de contrato.
- Conectar posição, alcance e exposição aos efeitos do confronto antes de atribuir vitórias à inteligência operacional. Não validar posicionamento só pela animação nem pela força agregada atual.

### T3 — Comandante: rede pequena versus SmolLM2

- Comparar política por regras, redes 9/16/32 e consulta ao mesmo SmolLM2 135M já usado pelo general, com contextos próprios e chamadas ocasionais. Não carregar uma instância por comandante.
- Usar as mesmas observações, ações autorizadas e ordens para os candidatos. Igualar orçamento de treinamento das redes; registrar algoritmo, inicialização e atualizações. A alternativa LLM usa o modelo previamente treinado, portanto comparar sistemas finais e custos, sem afirmar igualdade de treinamento.
- Treinar/calibrar em seeds separadas, congelar parâmetros no teste final e avaliar adaptação online em uma experiência separada. Não transferir aprendizados do teste para os candidatos seguintes.
- Selecionar o menor custo que preserve obediência e resultados de campanha. Uma rede maior só entra se demonstrar ganho consistente. LLM no comandante só entra se o ganho superar custo e atraso em batalha.

### T4 — Redes de soldados e cidadãos

- Soldados: comparar regras e redes 6/9/16 dentro das mesmas restrições de formação. Evitar que uma rede individual substitua o plano da unidade.
- Cidadãos: comparar 4/6/9 mantendo entradas, ações, utilidades e recompensas iguais. Não reduzir entradas ou alterar recompensas junto do tamanho da rede.
- Medir sobrevivência, fome/sede, necessidades atendidas, produtividade, entregas, trabalho desperdiçado, CPU e memória por indivíduo e no conjunto. Separar animais para que o experimento com cidadãos não altere suas redes.
- Critério proposto: escolher o menor tamanho cuja produção média fique até 5% abaixo da referência e que não introduza aumento consistente de mortalidade evitável. Para militares, exigir obediência às restrições e resultado não inferior à referência. Usar diferenças pareadas por seed e intervalos de confiança de 95%; resultado inconclusivo mantém a configuração atual.
- Se todos os tamanhos falharem, revisar observações, recompensas e treinamento antes de aumentar neurônios. Testar aprendizado de todas as camadas como experimento próprio, separado da comparação de tamanhos.
- O avaliador piloto de cidadãos está em `scripts/evaluate-people-brains.mjs`; usa `NEURAL_SEEDS`, `NEURAL_DAYS`, `NEURAL_CANDIDATES` e `NEURAL_REPORT_DIR`, registra os resultados por execução e informa diferenças pareadas vs regras com IC95%. Rodadas com menos de duas seeds declaram o intervalo indisponível. O teste de fumaça (uma seed, cinco dias) verifica o fluxo de arquivo apenas; não entra em qualquer critério de seleção.

### T5 — Carga, duração e funcionamento no jogo

- Escalas propostas: 50/200/500 cidadãos, 20/100/300 soldados e 1/4/12 formações; rotular as maiores como teste de estresse, não capacidade prometida. Variar número de campanhas e volume de eventos.
- Medir dias simulados/s, tempo p50/p95 do Worker, travamentos da interface, tamanho máximo da fila, pedidos superados, tempo até aplicar uma decisão e idade do relatório ao aplicar.
- Medir carga fria e aquecida, RAM de toda a árvore de processos, memória do serviço, memória do navegador/Worker e alocação do Ollama. Reportar GPU/VRAM e utilização quando disponíveis; CPU baixa não significa custo total baixo. Marcar métricas indisponíveis sem inventar valores e não somar alocações sobrepostas como memórias independentes.
- Reportar CPU-segundos/decisão, latência p50/p95, decisões aplicadas/minuto, rejeições, pico de memória e memória estabilizada. Comparar os dois modelos residentes com carregamento sob demanda. Energia só será convertida em custo se for medida.
- Rodar o cenário padrão por 730 dias simulados em pelo menos 30 seeds finais. Fazer teste interativo prolongado com reinicialização, pausa, velocidade alta, interrupção do Ollama e recuperação. Verificar que histórico e fila têm limites e que memória se estabiliza.
- Meta inicial: mediana do throughput do Worker não cair mais de 15% frente à mesma implementação com decisões gravadas, na mesma carga. Medir também a carga compartilhada com Ollama. Saturação deve reduzir frequência e descartar pedidos superados, mantendo a fila limitada.
- Entrega inclui um fluxo real: preparar modelos → iniciar jogo → ver rei/general ativos → observar ordem aplicada → verificar efeito e autoria no inspetor. Testar o build local de produção, além do servidor Vite.

## Implementação em entregas verificáveis

| Ordem | Entrega | Áreas principais | Condição para avançar |
|---|---|---|---|
| I0 | Instrumentação, cenários, manifesto e contratos de teste | `scripts/ai-benchmark/`, `tests/integration/`, `src/ai/` | Baseline registrado; T0 automatizado e reproduzível. |
| I1 | Serviço/adaptador Ollama, preparação dos modelos e execução integrada | `src/ai/`, novo serviço local, `package.json` | Download/verificação assistidos; saúde, timeout e cancelamento testados; build local conecta ao serviço. |
| I2 | Qwen no rei pelo protocolo existente | `local-engine.js`, `session.ts`, protocolo, `strategy.js`, UI | Pedido real chega ao Qwen e decisão validada altera o reino; T1 rei aprovado. |
| I3 | General e ordens versionadas de campanha com SmolLM2 | controladores de campanha, `campaigns.js`, protocolo, snapshots | **Implementada em estágio experimental.** Os contratos e as ordens têm testes integrados; ainda faltam T1 integrado, revisão humana e 30 seeds.
| I4 | Referência de formações determinísticas e execução operacional | `formations.js`, campanhas, movimento, confronto e UI | **Implementada em estágio experimental.** Posições e coesão afetam a batalha; falta completar a matriz T2 e validar cenários emergentes. |
| I5 | Avaliação e seleção dos controladores pequenos | `neural.js`, configuração experimental por papel e scripts de avaliação | **Ferramenta piloto de residentes implementada; sem seleção.** Ainda faltam comandante/soldado, calibração/treino, matriz T3/T4 e validação independente. |
| I6 | Uso padrão no projeto e validação de carga | agendador, diagnósticos, comandos de execução e documentação | T5 aprovado; sem modelos experimentais apresentados como ativos. |

Cada entrega precisa de teste de contrato, cenário integrado, verificação de recursos e demonstração no jogo. O plano de controle por regras continua disponível para indisponibilidade dos modelos, com motivo visível. A interface diferencia carregando, ativo, aguardando, erro e contingência, identifica o modelo e mostra qual agente originou a ordem.

## Artefatos e conclusão

Salvar cada execução em uma pasta própria com configuração, seeds, versões/digests, eventos de decisão, medições brutas e relatório de comparação. Preservar replays das decisões aplicadas para investigar divergências. Documentar quais resultados são de fixture, cenário sintético e partida completa.

A integração estará concluída quando o fluxo de instalação e execução do projeto carregar os modelos definidos, rei e general produzirem decisões com efeitos observáveis e validados, comandantes e soldados respeitarem ordens e formações, os tamanhos das redes locais forem escolhidos por testes separados, e o orçamento de processamento estiver documentado em uma partida completa. Até lá, declarar cada camada como planejada, experimental ou validada.
