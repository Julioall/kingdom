# Kingdom — GDD: Reinos Autônomos e Participação Opcional

**Versão:** 0.2.0  
**Atualização:** 27/10/2026  
**Status:** Proposta revisada — para revisão no PR #1; não equivale à aprovação, implementação ou integração à main.  
**Produto:** [Kingdom — Reinos Autônomos](https://linear.app/julio-alves/project/kingdom-reinos-autonomos-0db1ae2cf728)  
**Repositório:** [Julioall/kingdom](https://github.com/Julioall/kingdom)  
**Referências principais:** [JUL-195 — execução ativa](https://linear.app/julio-alves/issue/JUL-195) · [JUL-205 — interação futura](https://linear.app/julio-alves/issue/JUL-205)

> **Regra de escopo:** Kingdom é hoje uma aplicação web. Este GDD não determina migração para Genesis, MonoGame ou outra engine. O modo autônomo/observacional permanece o baseline demonstrável; o jogador poderá participar opcionalmente em uma evolução incremental, sem eliminar a autonomia das IAs.

## 1. Visão do produto

Kingdom simula reinos, moradores, comunidades e exércitos que produzem, negociam, aprendem, disputam território e vivem consequências persistentes. A fantasia central é **acompanhar — e futuramente também participar — de uma história política emergente que não depende do jogador para acontecer**.

Inspirado na dinâmica geral de estratégia e construção de RTS clássicos, mas com sistemas e identidade próprios, o jogo busca decisões compreensíveis, recursos limitados e múltiplas trajetórias possíveis, inclusive fome, deserção, migração, conquista e queda de governos.

**Duas experiências complementares:**

1. **Modo de observação autônoma (base M0–M6):** mundo avança por conta própria. O jogador inspeciona, pausa, acelera, reproduz seeds e investiga causas; a demonstração anual M5 não admite intervenções para cumprir seus critérios.
2. **Participação opcional (roadmap M7–M12):** jogador pode selecionar personagens/grupos, emitir ordens e eventualmente assumir rei, general, militar ou peão. Ao devolver o controle, a IA retoma com identidade, recursos, ordens, relações e memórias preservados. Isso é direção futura, não requisito já entregue.

**Plataforma atual:** navegador desktop, Vite e Canvas 2D. Controles, escala ou outras plataformas só mudam com evidências e decisão de produto.

## 2. Pilares de design

1. **Autonomia verificável:** cada reino age sem comandos humanos. Intervenção opcional não substitui o mundo autônomo.
2. **Causalidade:** ordens têm origem, validação, custo, duração, consequência e registro.
3. **Agentes não oniscientes:** pessoas e governantes conhecem apenas observações, relatos e memórias com fonte, idade e incerteza.
4. **Escassez e propriedade:** recursos, inventários, ouro, capacidade, alimentos, munições e tempo não surgem gratuitamente.
5. **Sociedade emergente:** relações, confiança, ajuda, lealdade, compromisso, facções e oposição influenciam política e sobrevivência.
6. **Conflito com consequências:** combates respeitam espaço, linha de visão, defesa, logística, baixas e efeitos econômicos/políticos.
7. **Histórias explicáveis:** crônica e replay permitem seguir intenção → ordem → execução → resultado.
8. **Controle seguro e reversível:** humano e IA usam a mesma autoridade de domínio, sem dois motores ou duas versões contraditórias do mundo.

## 3. Experiência do jogador e modos de interação

### 3.1 Observação — baseline obrigatório

O jogador pode iniciar, pausar, avançar por passos, ajustar velocidade, usar seeds, explorar mapa, inspecionar indivíduos/reinos/edifícios/campanhas, comparar populações e consultar crônica, recursos, objetivos, decisões e consequências. Um replay de um ano precisa funcionar **sem comandos humanos** para validar M5.

### 3.2 Participação progressiva — proposta, não implementação concluída

- **M7:** comandos versionados, papéis/autoridade, seleção por mouse, grupos e alvos no mapa; alternativa estável com menu.
- **M8:** intenções textuais estruturadas, plano curto com condições e orçamento; rei delega a general, que pode aceitar parcialmente, recusar e contrapropor com base em soldados realmente disponíveis.
- **M9:** comparar menu/mouse, texto e voz (incluindo seleção por voz). Microfone é experimento; voz pode ser rejeitada ou adotada apenas onde agregar valor.
- **M10:** assumir corpo de militar ou peão para mover, defender, atacar ou trabalhar com regras/custos já existentes.
- **M11:** integrar comandos, táticas, lembranças, promessas e continuidade entre jogador e NPC.
- **M12:** motor de respostas de IA nas interações jogador–NPC, **depois** da validação de M11.2.

Em todas as modalidades, o jogo distingue ordem solicitada, aceita, em execução, parcial, concluída, recusada ou cancelada; um comando humano não concede recursos ou conhecimento oculto.

## 4. Sistemas do mundo

### 4.1 Mundo, recursos e ecologia mínima

Terreno, água acessível, vegetação colhível e animais sustentam alimentação, rotas, custos de construção e decisões. O objetivo **não** é simular cientificamente clima, hidrologia, solo ou novos biomas.

- As estações servem principalmente para **troca visual de tiles**. Não desenvolver biomas, clima sazonal completo ou efeitos ecológicos sazonais generalizados.
- Manter a exceção específica já registrada para a [JUL-199](https://linear.app/julio-alves/issue/JUL-199): menor respawn de ovelhas selvagens no inverno, somente se implementada com limites e testes.
- Recursos colhíveis e estoques transportados são conceitos diferentes; alimento em pé no campo não é automaticamente alimento disponível ao morador.
- Qualquer simplificação deve preservar recursos finitos, caminhos acessíveis, necessidade de comida e efeito observável sobre decisões. Ver [JUL-165](https://linear.app/julio-alves/issue/JUL-165), registrada como Done no Linear.

### 4.2 Indivíduos, memórias e relações

Indivíduos têm idade, estado vital, necessidades, saúde, energia, localização, inventário, capacidades, habilidades, moradia, vínculos, percepção, memória e planos. As ações locais consomem tempo e recursos, e passam por validação do domínio.

A trilha social [JUL-169](https://linear.app/julio-alves/issue/JUL-169) diferencia:
- **S0–S3:** contratos sociais, memória/crenças com procedência, encontros/ajuda e compromissos persistentes — registrados como Done, sujeitos a revalidação no SHA corrente.
- **S4–S6:** impactos sociais na economia/política, avaliação de diálogos por LLM, facções/oposição e testes prolongados — ainda planejados.

Memória persistente de acontecimentos **não significa** treinamento dos pesos de um modelo de linguagem. Conhecimento novo precisa de fonte e canal de comunicação; boatos podem estar errados ou desatualizados.

### 4.3 Comunidades, assentamentos e edifícios

Casas/abrigos, roças, mercados, currais, castelos, torres, centros militares e monastérios têm custos, capacidade, localização, acessibilidade e manutenção. Construção precisa sobreviver a ameaça, fuga, cancelamento, ocupação de postos e posterior retomada.

A [JUL-198](https://linear.app/julio-alves/issue/JUL-198) está Done para **até 35 ovelhas por curral** e validação de novos locais. Reprodução e manejo etário permanecem propostos em JUL-199.

A [JUL-200](https://linear.app/julio-alves/issue/JUL-200) vincula recrutamento/evolução ao edifício **operacional** correspondente, sem geração gratuita. A [JUL-203](https://linear.app/julio-alves/issue/JUL-203) planeja alistamento voluntário condicionado a vagas, soldo e risco. O recrutamento não deve converter civis automaticamente apenas para completar uma guarnição.

### 4.4 Reinos, governo e legitimidade

Cada reino possui população, território, tesouro, produção, reservas, instituições, força militar e objetivos concorrentes. O rei deve decidir a partir de relatórios **que poderia conhecer**, com orçamento, prazo e reavaliação.

A governança envolve arrecadação, serviços, defesa, ajuda à população, migração, satisfação, confiança, lealdade, sucessão, revolta e diplomacia. Apoio político, obediência e medo não são sinônimos. A autoridade de um general é limitada pelo papel e pelas ordens recebidas; ele pode comunicar impossibilidades ou propor alternativa válida.

**Exemplo de delegação M8:** rei pede 50 arqueiros, mas o general informa 32 disponíveis, mobiliza apenas o autorizado e apresenta custo, vagas, edifícios, candidatos e tempo necessários para obter os 18 restantes. Nenhum agente inventa arqueiros, estoque ou conhecimento.

### 4.5 Economia e sobrevivência

Fluxo econômico obrigatório: **produção/coleta → posse e transporte → estoque acessível → venda/troca/consumo/construção → consequências**. A produção histórica de uma roça e sua biomassa em crescimento não são estoque líquido disponível.

- **JUL-178:** auditar conservação e logística de alimento entre roça, caça, estoque privado/comunitário, mercado, civis e tropas.
- **JUL-201:** moradores vendem excedentes de comida/madeira/pedra e compram alimento/insumos em mercado, com estoque, preços, proprietários e ouro reais.
- **JUL-202:** direção proposta de financiar o rei com **impostos em ouro** e compras de bens; sobretaxa de guerra motivada e reversível. **Depende** da operação confiável do mercado (JUL-201).
- **JUL-224:** calibrar roças e currais contra consumo líquido real da população; referência experimental de uma roça + curral para ~50 moradores, não garantia automática e nem alimento gratuito.
- **S4 / JUL-174:** ajuda, remuneração, promessas, escassez e impostos podem alterar confiança, adesão e política após validação da economia.

Nenhuma transação pode debitar duas vezes, usar estoque inacessível ou permitir que o rei confisque materiais civis como se fossem do tesouro sem uma regra política/econômica explícita.

### 4.6 Exército, campanhas e combate tático

A hierarquia militar tem três escalas: **rei** define objetivo, prioridade e orçamento; **general/grupo** decide destacamentos, formação e manobras; **soldado** executa movimento, ataque, defesa e recuperação com condições locais.

M6 amplia a beta existente sem reimplementar seus sistemas:
- Construção resiliente e contato de golpes/projéteis (JUL-180/181) foram registrados como Done, mas exigem teste de regressão.
- Campanhas com grupos simultâneos, suprimentos, retirada, flanco e retorno (JUL-183); ocupação e rodízio de arqueiros em torres (JUL-184).
- Formações adaptativas (JUL-189) a partir de estudo concluído JUL-182; habilidades de espada/lança (JUL-185), arqueiro (JUL-186), supressão coordenada (JUL-187), escudo/esquiva (JUL-188) e clérigos (JUL-190).
- Rei multiobjetivo e defesa em camadas (JUL-191); arena militar financiada com ouro e treino headless reproduzível (JUL-192); XP por perícia e generais (JUL-193).
- Civil desarmado não vira alvo legítimo apenas por ser estrangeiro; reproduzir e corrigir a agressão indevida em JUL-223. Soldados não devem continuar tarefas civis de transporte após promoção (JUL-197).

Habilidade requer alvo, alcance/colisão, orientação, custo, munição/mana/estamina, cooldown, janela de animação e contrajogo. Formação e ataque devem respeitar gargalos, posições e percepção; sem teleporte, dano fantasma ou informação global secreta.

Treino por IA **só conta como aprendizado comprovado** se comparar políticas, seeds de treino e não vistas, resultado real de combate, custo de ouro/tempo e ausência de regressões. Aumentar pontos de treino por dia não basta.

## 5. Arquitetura de decisões e modelos de IA

**Separação de autoridade:**

| Camada | Decide | Não pode fazer |
|---|---|---|
| Rei / planejamento estratégico | Intenções, orçamento, objetivos e delegação | Ler estado oculto de adversários ou criar recursos |
| General / coordenação | Plano executável, tropas reais, alvos, formações e contrapropostas | Ignorar vagas, distâncias, suprimentos ou comando válido |
| Indivíduo / política local | Trabalho, rota, golpe, defesa e reações percebidas | Ultrapassar regras de domínio, colisões ou custos |
| Motor / Worker | Deriva fatos, calcula custos, valida e aplica transições | Aceitar texto de LLM como escrita arbitrária de estado |
| Observador / interface | Apresenta snapshots, crônica e inputs | Alterar estado diretamente por renderização |

O **motor calcula** disponibilidade, reservas, capacidades, distâncias, regras, riscos verificáveis e opções legais. Modelos pequenos selecionam objetivos/ações, interpretam texto ou propõem planos **estruturados**, sem fazer contabilidade ou impor estados. Decisões complexas incluem pré-condições, orçamento, data, responsável, etapas, gatilho de revisão e feedback de execução. Fatos desconhecidos permanecem desconhecidos; não devem ser tratados como zero.

A [JUL-221](https://linear.app/julio-alves/issue/JUL-221) compara SLMs locais, inclusive **qwen3.5:0.8b**, com baselines, por acerto, ação válida, latência, memória e qualidade da decisão. Não declarar modelo vencedor ou adotado sem teste registrado. Falhas de timeout, indisponibilidade ou baixa confiança usam fallback determinístico, sem travar a simulação. LLM não precisa rodar a cada quadro nem em cada NPC.

Aprendizado neural e políticas militares devem ser medidos contra heurísticas e versões anteriores, com replays reproduzíveis e seeds de avaliação reservadas. Memória de fatos não equivale a alterar pesos do modelo.

## 6. Ciclo de simulação, observabilidade e desempenho

O relógio deve ser reproduzível por **seed, versão, configuração e sequência de comandos**. A simulação pertence ao Worker; renderização e interface consomem snapshots/eventos.

1. Disponibilidade de recursos e ambiente mínimo necessário ao gameplay.
2. Observações limitadas, necessidades, comunicações, planos e tarefas de agentes.
3. Validação e execução de trabalho, rotas, construção, comércio e custos.
4. Decisões de reino, campanhas, táticas e efeitos de combate.
5. Balanço de estoques, necessidades, legitimidade, baixas e transições políticas.
6. Crônica, indicadores, snapshots, save/replay e atualização visual.

Processos usam cadências apropriadas e medições reais; não reproduzir sazonalidade ecológica complexa. O jogo deve produzir métricas de throughput, FPS, p50/p95, memória, consumo de recursos, mortalidade, campanhas e causas de falha. Comparações usam mesmos seeds, SHA e configurações. Dados de checkpoints antigos não são benchmarks do HEAD.

## 7. Escopo, baseline e limites

### 7.1 MVP observacional / M0–M5

Inclui dois reinos autônomos iniciais, recursos finitos, necessidades, assentamentos, estratégia/delegação, conflitos causais, crônica, inspeção, simulação no Worker e replay. **Critério M5:** um ano de jogo com decisões autônomas, múltiplas seeds, resultados auditáveis, sem intervenção humana necessária.

### 7.2 M6 — refinamento tático

Campanhas e formações coerentes, habilidades de classes, torres, general/rei, treino e progressão verificados sob testes e simulações. O marco não pode ser declarado concluído apenas pela presença de módulos.

### 7.3 M7–M12 — evolução opcional

Comandos humanos, planos e linguagem, voz experimental, controle corporal, memória compartilhada em interações e motor de respostas conversacionais entram por fatias com gates específicos. Não são exigências retroativas para o MVP autônomo.

### 7.4 Fora do escopo vigente

Biomas novos, simulação climática/científica exaustiva, uma LLM por peão, multiplayer, campanha roteirizada, migração automática de engine, criação artificial de recursos, e uso obrigatório de voz. A eventual ampliação do número de reinos ou mapa depende de desempenho e design.

**Correção de baseline:** o antigo GDD 0.1 registrava **96×96** como checkpoint histórico. A configuração consultada da `main` em 27/10/2026 usa **128×128**; validar dimensões e estatísticas no SHA do teste. Não reciclar como atuais dados de 96×96 nem a antiga suspeita sobre fixture de 192×192.

## 8. Interface, inspeção e controles

A interface atual prioriza mapa com camadas/tile sazonal, câmera/zoom, indivíduos, reinos, estoques, obras, tropas, crônica, inspeção causal e reprodução de seeds. Indicadores devem distinguir recursos do mundo, propriedade, transporte e estoque realmente acessível.

Interfaces futuras reutilizam **um catálogo comum de comandos**: selecionar por mouse/menu, indicar destinatário/alvo, escrever intenção textual, e opcionalmente falar. Comparar modalidades sem supor vantagem de voz; zoom não muda silenciosamente destinatários. Se o jogador assumir um corpo, controles de movimento/ataque são executados pelo mesmo motor, sem inferência de LLM por golpe.

Não apresentar como certeza uma explicação gerada por LLM que contrarie os eventos reais. Guardar origem, confiança e momento de cada relato.

## 9. Critérios de sucesso e gates de aceitação

- **Domínio:** comida, madeira, pedra, ouro, soldados, vagas e materiais são conservados; ações impossíveis são recusadas.
- **Autonomia:** reinos continuam produzindo, negociando e reagindo sem comando humano.
- **Combate:** hits, defesa, munição, posicionamento e alvo legítimo seguem regras e produzem registros verificáveis.
- **IA:** ações propostas são válidas e úteis; general negocia objetivos inviáveis; modelos não recebem estado onisciente.
- **Social:** memória, ajuda e compromissos têm fonte e efeitos; diálogo não finge execução.
- **Reprodução:** repetir seed + SHA + comandos reproduz o comportamento dentro dos contratos declarados; testes 365/730 dias registram estados, custos e falhas.
- **Interação futura:** entrada mouse/texto/voz é comparada em tarefas reais; troca humano↔IA conserva estado e compromissos.
- **Engenharia:** build, typecheck, suíte direcionada, CI aplicável, smoke Worker/browser e playtest com evidência. Issues só ficam Done após aceite, não por projeto ou plano.

## 10. Stack atual e direção de arquitetura

**Snapshot de referência, 27/10/2026:** branch `main` do GitHub em `b36727648370ac52a02707b86fbcfcb5a9315d10`. Esta referência identifica a consulta documental, **não** atesta execução dos testes ou aprovação de todas as funcionalidades.

- Aplicação web com **Vite**, TypeScript/JavaScript, **Canvas 2D**, interface HTML/CSS e simulador em **Worker**.
- Serviço de IA local integrado ao **Ollama** (`src/ai/ollama-service.mjs`); modelos e runtime devem ser checados no manifest/HEAD efetivos. WebLLM aparece no histórico como alternativa, não como descrição exclusiva do runtime vigente.
- Scripts presentes: `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`; testes publicados não substituem CI/replay completo.
- **JUL-177** segue responsável por reconciliar suíte, CI e checkout limpo; não considerar CI validada sem execução.
- Melhorias de renderização, chunks e profiling devem ser medidas; não trocar engine por preferência. Não misturar este repositório com o projeto Genesis.

O Worker é autoridade do mundo; entrada humana ou de IA passa por comandos validados. Preservar fronteiras entre domínio, política, integração de IA e renderer.

## 11. Arquitetura lógica e contratos

| Sistema | Responsabilidade | Contrato de fronteira |
|---|---|---|
| **Simulation Core / Worker** | Tempo, seed, estado, validação, snapshots, replay | Não depende de renderer nem de texto livre |
| **World / Resources** | Recursos finitos, terreno, água e fauna mínima | Expõe disponibilidade observável |
| **Economy / Settlements** | Produção, inventários, transporte, mercado, obra | Conserva quantidades e propriedade |
| **Individuals / Social** | Necessidades, crenças, relações, compromissos | Recebe observações limitadas |
| **Kingdom / General AI** | Objetivos, delegação, planos, relatórios, campanhas | Pede ações, não grava estado diretamente |
| **Military / Combat** | Grupos, formação, táticas, contatos, ferimentos, treino | Resolve regras físicas e custos |
| **Observer / Player Input** | Mapa, painéis, inspeção e futuros comandos humanos | Não executa regras por UI |

Contratos essenciais: **Observation** (fatos, procedência, idade, incerteza), **Intent/Plan** (ator, papel, objetivo, orçamento e validade), **Command** (origem humano/IA, alvo, parâmetros, revisão, idempotência), **Validation** (recusa/aceite), **ExecutionResult** (parcial, concluído, interrompido), **Event** (causas e custos) e **Snapshot/Replay** (consistência e auditoria).

Nunca admitir duas políticas disputando controle de um mesmo personagem. Quando o humano devolve o controle, o agente continua com a posição, necessidades, inventário, experiência e planos ainda válidos.

## 12. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Crescer escopo antes de estabilizar economia/combate | Fatias pequenas, gates e dependências do Linear |
| Divulgar recursos ou tropas inexistentes | Motor calcula fatos derivados e valida cada transição |
| LLM falhar, atrasar ou alucinar | Orçamento de inferência, ações estruturadas, timeout, fallback |
| IA onisciente ou social sem causa | Relatórios limitados, memória com procedência, eventos e replay |
| Guerra atacar civis sem regra legítima | Critério de hostilidade, teste de alvo e correção JUL-223 |
| Treinamento neural apenas aparente | Arena real, custo, baselines, seeds holdout e ablação |
| Regressão em Worker, inventários e FPS | CI, seeds fixas, perfis, smoke browser e controle de versão |
| Docs afirmarem entrega ainda não verificada | Diferenciar feito no Linear de confirmado no SHA corrente |
| Experimentos de voz virarem obrigação | Gates comparativos e opção de rejeitar voz |

## 13. Roadmap de produto e rastreabilidade

| Marco | Direção | Estado de referência em 27/10/2026 |
|---|---|---|
| **M0** | GDD e baseline | Done no Linear — JUL-156 |
| **M1** | Worker, snapshot e observador | Done no Linear — JUL-159 |
| **M2** | Planejamento/delegação do reino | Done no Linear — JUL-161 |
| **M3** | Economia e assentamentos | In Progress — JUL-162, JUL-178, JUL-201/202/224 |
| **M4** | Território, logística e conflito | In Progress — JUL-163, JUL-223 |
| **M5** | Vertical slice autônomo anual | In Progress — JUL-164, bloqueado por JUL-177 |
| **M6** | Beta tático, combate e aprendizagem | Parcial: JUL-179/180/181/182 Done; demais fatias e JUL-194 pendentes |
| **S0–S6** | Social, memória, ajuda, política e facções | JUL-170–173 Done; JUL-174–176 planejadas |
| **M7** | Seleção e autoridade humano/IA | Backlog — JUL-206–209 |
| **M8** | Texto, planos e delegação | Backlog — JUL-210–212; experimento JUL-221 em andamento |
| **M9** | Experimento de voz | Backlog — JUL-213/214 |
| **M10** | Controle de corpos | Backlog — JUL-215–217 |
| **M11** | Tática + continuidade | Backlog — JUL-218–220 |
| **M12** | Respostas de IA nas interações jogador–NPC | Backlog — JUL-225, após JUL-220 |

**Status da issue não comprova integração na `main`.** Validar no SHA corrente e registrar evidências. As novas propostas não reabrem automaticamente marcos M0–M5 nem ativam o roadmap M7–M12.

## 14. Janela operacional já planejada — 27/10 a 23/11/2026

- **27/10–02/11:** JUL-177 (base/CI), JUL-223 (alvo civil), JUL-197 (soldado em transporte), JUL-178 (conservação e logística de alimentos).
- **03–09/11:** JUL-201 (mercado após JUL-178), JUL-200 (edifícios de recrutamento) e JUL-221 (benchmark de SLM).
- **10–16/11:** JUL-202 (impostos após JUL-201) e JUL-184 (guarnição e turnos em torres). JUL-203 é reserva condicionada.
- **17–23/11:** fatia inicial de JUL-183 (campanhas), prova inicial de JUL-192 (arena de treino), replay intermediário de JUL-164; preparar JUL-191 **após** JUL-183 e JUL-184.

A janela de quatro semanas **não** equivale ao aceite completo de M6, M5 ou da JUL-195. Itens bloqueados permanecem aguardando; prazo-alvo não garante implementação.

## 15. Decisões ainda abertas

1. Hardware/browser mínimos e orçamento de FPS, memória e simulação aceito.
2. Quando e como ampliar mapa e número de reinos depois de medir escala.
3. Regras de informação entre rei, general e NPCs, inclusive perda de conhecimento na conquista e sucessão.
4. Parâmetros finais de oferta/demanda, impostos e produção alimentar após replays econômicos.
5. Conjunto e balanceamento final de formações, habilidades e aprendizagem militar.
6. Modelo local de linguagem vencedor após benchmark JUL-221; nenhuma escolha automática.
7. Modalidades de controle humano aprovadas por experimento; voz pode não entrar.
8. Validação de controle compartilhado sem quebrar autonomia e determinismo.
9. Aprovação do GDD 0.2.0 e merge do PR #1, ambos sujeitos a revisão humana.

## 16. Checklist de alinhamento com o Linear — 27/10/2026

| Verificação documental | Situação desta revisão | Referência |
|---|---|---|
| Atualizar jogador observador → participação opcional | Incorporado ao GDD, implementação futura | JUL-205, M7–M12 |
| Remover biomas e ecologia sazonal do escopo ativo | Incorporado, com exceção estreita da ovelha | JUL-165, JUL-199, JUL-204 |
| Descrever mercado, impostos em ouro e demanda alimentar | Incorporado como propostas condicionadas | JUL-178, JUL-201/202/224 |
| Detalhar recrutamento, exército, general e treino neural | Incorporado sem declarar M6 entregue | JUL-183–194, JUL-200/203 |
| Diferenciar memória social, planejador, LLM e motor | Incorporado; benchmark não presumido | JUL-169–176, JUL-221 |
| Corrigir arquitetura e cenário de referência | Descrição atualizada; execução CI não atestada | JUL-177, GitHub main em 27/10 |
| Estender roadmap M0–M12 e explicitar dependências | Incorporado, futuro permanece Backlog | JUL-195, JUL-205 |
| Integrar versão revista à main | **Não realizado — depende de revisão/merge do PR #1** | GitHub PR #1 |

**Regra de manutenção:** usar GitHub como fonte do GDD versionado e do código; Linear como fonte do estado, decisões e dependências. Toda alteração relevante no produto deve atualizar GDD e issue associada com link, SHA, motivo e evidência. Não marcar Done sem teste e nem presumir que texto implementa gameplay.
