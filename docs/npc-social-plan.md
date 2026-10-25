# Plano de NPCs inteligentes e interações sociais

Data: 24/10/2026. Estado: proposta de implementação; nenhuma etapa nova deste documento está implementada ou validada.

## Objetivo

Fazer cada habitante agir conforme necessidades, experiências, relações, conhecimentos e objetivos próprios. A sociedade deve transmitir notícias, construir reputações, negociar compromissos e reagir às decisões do governo. As consequências precisam ser observáveis e explicáveis no inspetor.

O ciclo proposto é: acontecimento → observação ou relato → memória → crença → intenção → ação → resultado → aprendizagem. Uma conversa pode mudar o que alguém acredita, estabelecer um compromisso ou transmitir um lugar conhecido. Seus efeitos dependem de operações da simulação, não de alterações arbitrárias de atributos pelo texto gerado.

Este plano complementa [a visão do projeto](project-vision.md), [a arquitetura](architecture.md) e [o plano de IA](ai-integration-plan.md). Preserva Qwen no rei, SmolLM2 no general e a avaliação prevista dos controladores individuais e militares. Não pressupõe trocar o controlador atual por Behavior Trees nem implementar uma instância de LLM por habitante.

## Base existente e limites

- O Worker é dono do estado; a simulação avança em dias. Renderização e interpolação visual têm outro relógio. Decisões sociais não rodam a 60 FPS.
- Moradores usam redes locais combinadas com utilidades e memória de recompensas. A comparação de larguras continua no plano de IA; acrescentar entradas ou recompensas sociais será um experimento separado.
- `individuals/perception.js` mantém memória sensorial de atores, água, troncos e armazenamentos. Ela continua responsável pelo conhecimento espacial; a memória social guarda referências e procedência.
- `individuals/actions.js` já oferece socialização e outras ações civis. `society/communities.js` mantém vínculos, confiança, encontros e coesão. Atualmente proximidade já aumenta confiança, inclusive fora de uma interação explícita: a migração dessa regra exige comparação antes/depois.
- O vínculo atual é compartilhado pelo par. Confiança direcional, obrigações, crenças e compromissos serão estruturas novas; não devem ser apresentados como existentes.
- Campanhas, soldo e abastecimento oferecem acontecimentos concretos. Rei, general e formações estão integrados em estágio experimental; comandantes autônomos e validações de escala continuam pendentes.
- A crônica atual guarda até 64 mensagens textuais. Ela é uma projeção para apresentação e não deve servir de banco de evidências ou fonte única de replay.
- A economia e a sobrevivência ainda têm validações pendentes. Cenários sociais precisam de recursos e rotas controlados para separar problemas econômicos de decisões sociais.

## Arquitetura proposta

| Camada | Responsabilidade | Execução |
|---|---|---|
| Necessidades e legalidade | Sobrevivência, alcance, recursos, acesso e ações possíveis | Cada atualização relevante do indivíduo |
| Política individual | Selecionar ações entre alternativas legais, usando utilidade e rede atual | No avanço da simulação |
| Memória e crenças | Guardar experiências, avaliar relatos, recuperar evidências e rever expectativas | Em eventos e manutenção escalonada |
| Intenções e planos | Manter objetivos por vários dias e escolher a próxima ação viável | Ao concluir passos ou mudar condições |
| Interações sociais | Propor, aceitar, recusar e resolver trocas e compromissos | Em encontros elegíveis |
| Governo e comando | Planejar com relatórios efetivamente recebidos | Agenda e gatilhos do plano de IA |
| Expressão | Balões, explicações e crônica coerentes com resultados registrados | Após a interação; LLM opcional |

A rede pontua alternativas; o motor executa transações, movimento e consequências. Emergências físicas podem suspender um plano. Soldados preservam o caminho operacional próprio, sem voltar à seleção de trabalho civil.

## Estado e memória

Separar quatro conceitos:

1. **Registro do mundo:** aconteceu uma transferência, um atraso ou uma batalha. Sua existência não o torna conhecido por todos.
2. **Memória individual:** o indivíduo presenciou, participou ou ouviu um relato sobre o acontecimento.
3. **Crença:** interpretação pessoal revisável, como considerar arriscado servir ao exército daquele reino.
4. **Intenção:** objetivo ativo, como conseguir pagamento, procurar outro trabalho ou preparar migração.

Registros propostos, com versão explícita de esquema:

| Estrutura | Campos principais |
|---|---|
| Evento social | `eventId`, `day`, `type`, participantes, alvo, local, resultado e referências de recursos |
| Memória | `memoryId`, `rootEventId`, tipo observado/recebido, emissor, origem, dia de aquisição, importância e referências de evidência |
| Crença | sujeito, tema, avaliação, certeza, evidências favoráveis/contrárias, última revisão |
| Relação dirigida | observador, alvo, confiança, afinidade, receio, interações relevantes |
| Compromisso | partes, objeto, quantidade, prazo, estado, recursos reservados quando aplicável |
| Intenção | tipo, prioridade, alvo, passos, progresso, impedimentos e condição de encerramento |

Usar IDs do mundo e a época existente para isolar sessões. Confiança e certeza usam escala documentada de 0 a 1; evitar misturá-las com necessidades de 0 a 100. Valores iniciais e coeficientes serão calibrados, não fixados como conclusões científicas.

Conhecimento de lugares mantém referência ao local e data de observação, distinguindo visita própria de indicação recebida. O morador só descobre que um recurso acabou quando recebe evidência; a camada de execução verifica disponibilidade real ao tentar agir. A morte da fonte não apaga automaticamente suas informações da memória de terceiros.

## Regras de interpretação e transmissão

- Uma testemunha registra apenas o que estava ao alcance de sua percepção. Não recebe automaticamente intenção do rei, estoque inimigo ou causa exata de uma derrota.
- Cada relato preserva o acontecimento de origem. Repetir a mesma notícia não cria novas perdas, novos atrasos ou recompensas duplicadas. Múltiplas testemunhas independentes podem aumentar certeza dentro de limites definidos.
- A avaliação combina confiança na fonte, experiência direta, relevância pessoal, idade da notícia e evidências contrárias. A avaliação pode ser equivocada sem tornar o estado físico do mundo equivocado.
- Distinguir temas: competência militar, cumprimento de pagamento, generosidade e legitimidade. Não reduzir todas as opiniões a uma única lealdade.
- Evidências positivas também alteram expectativas. Um pagamento posterior quita o débito real e pode recuperar confiança gradualmente, sem apagar o atraso anterior.
- Rever certezas e relevância ao longo do tempo; não fazer todo trauma desaparecer por um contador único. Aplicar saturação e intervalos para evitar espirais de opinião provocadas por encontros repetidos.
- O primeiro estágio transmite relatos verdadeiros ou desatualizados. Mentira deliberada e propaganda entram depois, com incentivo, habilidade e risco de descoberta explícitos.

## Catálogo inicial de interações

| Interação | Condições | Efeito concreto |
|---|---|---|
| Conversar | Proximidade, disponibilidade e interesse | Atende necessidade social; pode alterar afinidade |
| Informar recurso | Emissor conhece um local e decide compartilhar | Receptor recebe indicação com procedência |
| Pedir ajuda | Necessidade observável ou declarada | Abre pedido que pode ser atendido ou recusado |
| Ajudar | Doador dispõe de recurso e aceita o custo | Transfere estoque existente; registra experiência para ambos |
| Relatar experiência | Memória comunicável e tema relevante | Transmite informação; receptor avalia credibilidade |
| Propor compromisso | Objeto, prazo e partes válidos | Cria proposta; obrigação só começa após aceitação |
| Cumprir ou quebrar compromisso | Prazo ou entrega verificável | Resolve obrigação e produz evidência de confiabilidade |
| Pedir apoio | Objetivo compartilhável e relação suficiente | Registra apoio específico, revogável e com custo quando houver |

Compartilhar memória não obriga um personagem a concordar. Pedir não garante receber. Prometer não cria recursos. Socializar não interrompe automaticamente fuga, combate ou emergência vital. Encontros acontecem em locais existentes, como mercado, moradia, trabalho ou retorno de campanha; uma taverna nova não é pré-requisito.

## Seleção e resolução dos encontros

1. Consultar vizinhos com índice espacial; evitar acrescentar outra varredura de todos os pares.
2. Gerar poucas propostas elegíveis por pessoa, considerando necessidades, interesses, vínculos e planos.
3. Pontuar utilidade esperada, custo de tempo, risco e disposição do interlocutor.
4. Arbitrar propostas conflitantes em ordem estável. A mesma pessoa não participa de encontros incompatíveis no mesmo passo.
5. Revalidar distância, disponibilidade e recursos. Aplicar efeitos uma única vez, pelo Worker.
6. Registrar o resultado para participantes e testemunhas elegíveis; atualizar crenças e compromissos.
7. Gerar a expressão textual a partir do resultado confirmado.

Separar familiaridade por proximidade de confiança por comportamento. Migrar gradualmente o bônus atual de proximidade, medindo efeitos sobre adesão comunitária e coesão. Usar desempate determinístico ou o gerador aleatório do mundo, nunca aleatoriedade externa ao replay.

## Planos individuais persistentes

Começar com três planos, usando sequências pequenas de passos predefinidos:

- **Conseguir ajuda:** escolher uma fonte conhecida → aproximar-se → pedir → aguardar até um prazo → consumir o recebido ou tentar alternativa.
- **Avaliar trabalho ou serviço:** reunir informação → avaliar custo e remuneração → aceitar/recusar → acompanhar resultado.
- **Preparar migração:** conhecer destino possível → avaliar acolhimento e rota → obter provisões → viajar → solicitar entrada.

Cada plano tem prazo, condição de abandono e alternativas. Fome, ameaça ou rota inviável suspendem ou encerram passos. As ações existentes continuam responsáveis pela execução. Não implantar um planejador geral ou aprendizagem nova simultaneamente à primeira memória social.

## Governo, guerra e mudança política

Pedidos ao rei e relatórios ao general são informações transportadas por canais explícitos. A resposta do governo produz eventos verificáveis: entrega de alimento, recusa, ordem, pagamento ou resultado de campanha. Relatórios para LLMs não incluem crenças privadas sem um canal que as tenha comunicado.

No primeiro recorte político, crenças podem influenciar disposição ao trabalho/recrutamento e preparação de migração. Integrar com as regras existentes, evitando aplicar a mesma penalidade duas vezes por satisfação e crença.

Deserção, facções, conspirações e sucessão são entregas posteriores. Exigem intenção, apoio, oportunidade, recursos e efeitos militares definidos. Insatisfação abre alternativas; não dispara uma rebelião por um limiar isolado. Recrutamento, desmobilização e deserção devem preservar carteiras, inventários, compromissos e identidade do indivíduo.

## Papel opcional do LLM social

Primeiro implementar templates ligados a resultados. Depois comparar interpretação social ocasional por LLM com a mesma camada por regras. O modelo pode escolher um tema ou interpretação entre alternativas autorizadas; o Worker verifica evidências, alvo e efeito permitido. Efeitos numéricos continuam sob regras do jogo.

A geração de falas recebe o resultado aceito. Falha de texto usa template; falha de interpretação usa a política por regras. Uma interação que já teve efeito por contingência não recebe um segundo efeito quando a resposta atrasada chega.

Reutilizar serviço, isolamento de contexto, época, validade e deduplicação existentes, estendendo o contrato explicitamente caso se acrescente o papel social. Usar limite de chamadas e prioridade abaixo das decisões estratégicas urgentes; envelhecimento de pedidos e expiração evitam crescimento da fila. Calibrar no relógio de simulação e no tempo real, especialmente em avanço acelerado.

O uso social do SmolLM2-135M é um experimento novo e não altera sua escolha como general. Avaliar português, fundamentação, repetição e custo antes de torná-lo padrão. A bibliografia abaixo não valida esse modelo para esse papel.

## Persistência, escala e inspeção

- Salvar estruturas sociais serializáveis junto ao estado do mundo, com migração de esquema. Evitar um banco ou arquivo separado por NPC.
- Manter orçamento de memórias por pessoa, crenças por tema e relações ativas. Como ponto inicial de medição: 32 memórias episódicas por pessoa, até 16 relações detalhadas e até 3 intenções ativas. São limites experimentais; compromissos abertos e evidências necessárias não podem desaparecer silenciosamente para caber neles.
- Consolidar episódios antigos em resumos estruturados com contagens e procedência. Preservar obrigações abertas em registro próprio. Evicção de relação guarda obrigações e síntese suficiente para não zerar reputação arbitrariamente.
- Armazenar referências compartilhadas a evidências; coletar registros sem referências. A captura de replay é um artefato separado e tem política explícita de retenção/exportação, evitando histórico ilimitado dentro do mundo.
- Escalonar revisão de crenças e limpeza entre dias. Consultas de inspeção devolvem detalhes sob demanda; snapshots de render carregam somente resumo e eventos visíveis.
- Inspetor mostra intenção, motivo da última ação, crenças relevantes, fontes, confiança, compromissos e autoria da decisão. A interface distingue observação, relato, interpretação e texto gerado.

## Entregas e critérios para avançar

| Etapa | Entrega | Critério de aceitação |
|---|---|---|
| S0 | Contratos de estado, eventos e medição | Baseline de comportamento/custo registrado; fonte de verdade e isolamento de conhecimento testados |
| S1 | Memórias e crenças por regras | Experiência direta e relato diferenciados; repetição idempotente; evidência contrária revisa crença; retenção preserva obrigações |
| S2 | Encontros, informação e ajuda | Água indicada sem telepatia; ajuda conserva recursos; recusa válida; efeitos únicos; inspeção explica origem |
| S3 | Compromissos e planos persistentes | Aceite explícito, prazo e resolução; interrupção por emergência; nenhuma obrigação ou tarefa órfã |
| S4 | Integração econômica e política | Atraso de soldo, ajuda e recrutamento alteram decisões pertinentes; migração depende de rota e acolhimento viáveis |
| S5 | Experimento de interpretação e diálogo por LLM | Contratos e resultados antigos rejeitados; ganho de coerência/variedade revisado; custo medido frente a templates |
| S6 | Facções, oposição e validação prolongada | Apoio localizado e recursos explicam mobilização; ausência de oposição também é resultado válido; carga e replays aprovados |

Primeira entrega funcional: S0–S2 com três acontecimentos — água conhecida, ajuda alimentar efetiva e soldo atrasado. Sem mentira deliberada, facções ou LLM social nessa entrega. O compromisso de soldo já existente continua sendo a fonte do atraso; não duplicar esse débito no novo sistema.

S0–S2 podem ser desenvolvidos e medidos em cenários controlados enquanto as validações econômicas/militares existentes avançam. S4 depende dessas validações; S6 depende de contratos e regras políticas completos.

## Organização prevista no código

Criar módulos pequenos em `src/simulation/society/`: `social-events.js`, `social-memory.js`, `beliefs.js`, `interactions.js` e `commitments.js`, conforme cada etapa necessitar. Intenções podem ficar em `src/simulation/individuals/intentions.js`.

Integrar acontecimentos nos produtores reais: inventários, comércio, serviço militar e campanhas. `individuals/actions.js` consulta intenções e solicita interações; `society/communities.js` conserva seu papel de comunidade e delega relações ao módulo responsável. Definir uma única fase de resolução no avanço diário, após as propostas individuais; eventos militares do fechamento alimentam o próximo passo social, sem reexecutar o dia.

Ampliar protocolo, projeções e inspetor somente para os dados necessários. Cobertura de integração prevista em arquivos por domínio dentro de `tests/integration/`, acompanhada por avaliador social com métricas e seeds salvas. Não reescrever o motor, o provedor Ollama ou as redes individuais para acomodar o primeiro recorte.

## Validação e experimentos

**Contratos obrigatórios:** não revelar informação desconhecida; não criar recursos; não aplicar duas vezes; não aceitar resultado de outra época; não iniciar ação fora de alcance; não perder compromissos na consolidação. A confiança de A em B pode diferir da confiança de B em A. Salvar/carregar mantém o estado social quando essa funcionalidade for conectada.

**Cenários dirigidos:** dois habitantes com experiências diferentes sob o mesmo rei; notícia repetida; fontes contraditórias; fonte morta; recurso esgotado após indicação; pedido recusado; pagamento atrasado e depois quitado; migração sem provisões; encontro interrompido; retorno de campanha sem conhecimento da intenção do comando.

**Ablations:** A = controlador atual; B = A com memórias/crenças e interações por regras; C = B com planos persistentes; D = C com interpretação ocasional por LLM. Comparar cada incremento mantendo economia, população, observações e treinamento iguais. Mudanças nas entradas/recompensas da rede exigem rodada própria.

**Métricas:** sobrevivência, necessidades atendidas, produção, trabalho abandonado, migração bem-sucedida/falha, compromissos cumpridos, alcance/tempo de notícias, crenças sustentadas por evidências, diversidade de decisões, repetição de encontros, custo por dia, tamanho de estado/snapshot e memória estabilizada. Diversidade não vale como ganho se vier de ações incoerentes.

**Amostragem:** smoke tests verificam fluxo; não aprovam comportamento. Usar seeds pareadas, 30 de calibração e outras 30 finais, coeficientes congelados no teste final. Replays de 730 dias seguem a validação de carga existente; estudos curtos adicionais isolam mecanismos. Registrar decisões LLM e momentos de aplicação: seed sozinha não reproduz inferência assíncrona.

**Metas propostas:** zero violações de contrato nos cenários; sem aumento consistente de mortalidade evitável; relatos influenciam somente receptores alcançados; throughput mediano do Worker não cai mais de 15% frente ao mesmo cenário sem a camada social. Medir também p95 e crescimento de memória; o limite de 15% é orçamento inicial de engenharia, sujeito à revisão explícita após baseline, não resultado já alcançado. Comparação LLM mede separadamente a competição com rei/general.

## Referências e limites da evidência

- [Generative Agents (2023)](https://arxiv.org/abs/2304.03442): memória, reflexão e planejamento em 25 agentes; resultados de plausibilidade e difusão social, não comprovação de escala ou de SmolLM2-135M.
- [Comme il Faut (2011)](https://ojs.aaai.org/index.php/AIIDE/article/view/12454): conhecimento e regras sociais reutilizáveis em jogos; inspiração para interações pontuadas, não adoção automática de todo o sistema.
- [HTN e Behavior Trees (2018)](https://ojs.aaai.org/index.php/AIIDE/article/view/13044): precedente para separar planejamento de execução reativa; não exige substituir as redes atuais.
- [RepuNet (AAMAS 2026)](https://arxiv.org/abs/2505.05029): reputação, relatos e cooperação nos cenários estudados; não garante dinâmica política equilibrada no Kingdom.
- [Sub-goal Distillation (2024)](https://arxiv.org/abs/2405.02749): alternativa futura para treinamento por demonstrações e subobjetivos; estudo com modelos de 770M em ScienceWorld, sem comprovação para as redes pequenas atuais.

As referências foram localizadas com SciSpace e conferidas nas publicações originais na discussão que originou o plano. A arquitetura e os limites numéricos aqui propostos são decisões de engenharia a validar no Kingdom.
