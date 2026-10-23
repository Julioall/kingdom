# Kingdom — GDD: RTS de Reinos Autônomos

**Versão:** 0.1.0  
**Status:** Proposta para validação  
**Repositório-alvo:** [Julioall/kingdom](https://github.com/Julioall/kingdom)  
**Escopo deste documento:** evolução do protótipo Kingdom para um simulador estratégico observacional, inspirado no ciclo de construção e disputa territorial de RTS clássicos.

> Este documento se refere ao repositório `kingdom`, uma aplicação web. Ele não propõe migrar o projeto para o repositório Genesis nem reutilizar sua stack MonoGame.

## 1. Visão do produto

**Kingdom** é um simulador de reinos autônomos. Populações, governantes, comunidades e forças de defesa tomam decisões sem um jogador comandando unidades. A pessoa usuária acompanha o mundo, observa as consequências e investiga por que cada reino prospera, entra em conflito, se divide ou desaparece.

A referência a *Age of Empires* é de alto nível: coleta e transformação de recursos, crescimento de assentamentos, construção, defesa, expansão territorial e conflito. Kingdom terá regras, identidade visual e sistemas próprios; não reproduzirá conteúdo, facções, mapas ou assets do jogo de referência.

### Fantasia central

> “Observar uma história política surgir de decisões de sobrevivência, economia, liderança, território e defesa.”

### Posicionamento

- **Gênero:** simulador estratégico e RTS observacional.
- **Modo inicial:** um mundo, várias facções controladas integralmente por IA.
- **Papel da pessoa usuária:** observadora e investigadora; não controla um reino ou exército.
- **Plataforma inicial:** navegador, com foco em desktop.
- **Estilo atual:** mapa 2D em pixel art, com camadas de inspeção e visualização causal.

## 2. Pilares de design

1. **Autonomia:** o mundo continua funcionando sem ordens da pessoa usuária.
2. **Causalidade:** decisões consomem tempo e recursos, e seus resultados deixam evidências.
3. **Agentes limitados:** cada pessoa age a partir de necessidades, capacidades, percepção e memória locais; não tem conhecimento perfeito do mapa.
4. **Reinos como sistemas sociais:** um reino depende de pessoas, alimentos, materiais, confiança, liderança, instituições e defesa; seu tamanho não é apenas uma pontuação.
5. **Conflito com consequências:** disputas surgem de objetivos e pressões simulados, e produzem custos econômicos, humanos e políticos.
6. **Histórias legíveis:** acontecimentos importantes podem ser inspecionados sem transformar o simulador em uma sequência roteirizada.
7. **Equilíbrio não forçado:** falência, divisão, migração, vitória e extinção são resultados possíveis; o sistema não cria recursos para garantir que todos sobrevivam.

## 3. Experiência de observação

No escopo inicial, a pessoa usuária não escolhe ações de trabalhadores, movimenta tropas nem administra um reino. Pode:

- iniciar, pausar, avançar um passo e alterar a velocidade da simulação;
- escolher ou repetir uma semente e um cenário;
- navegar pelo mapa e alternar camadas de clima, recursos, território, população e conflito;
- selecionar indivíduos, governantes, assentamentos, edifícios e eventos;
- consultar necessidades, recursos percebidos, memória recente, intenção, custo e resultado de um agente;
- acompanhar a crônica do mundo e abrir a cadeia causal de um evento;
- comparar população, reservas, produção, satisfação, território, baixas e estabilidade entre reinos.

Intervenções da pessoa usuária, como controlar um reino ou emitir comandos, ficam fora do primeiro MVP. Isso preserva a pergunta central: o que as IAs fazem quando precisam governar e sobreviver sem direção humana?

## 4. Sistemas do mundo

### 4.1 Mundo e ambiente

O mapa fornece terreno, água, clima, vegetação, fauna e recursos minerais. As condições ambientais determinam onde é possível viver, produzir, deslocar-se e construir. As regras ambientais devem continuar separadas da renderização.

A fidelidade científica é progressiva: cada processo precisa ter unidades, limites, custos e relações causais claros. O MVP não precisa simular toda a natureza com precisão de pesquisa, mas deve evitar regras que contradigam o próprio estado do mundo.

### 4.2 Indivíduos

Cada indivíduo possui, no mínimo:

- necessidades de alimento, água, descanso, saúde e vínculo social;
- idade, estado vital, capacidades físicas, habilidades e relações;
- posição, inventário carregado, moradia e vínculo comunitário ou político;
- percepção local, memória sensorial e memória pessoal recente;
- uma política comportamental de baixo custo, atualmente uma rede neural pequena com aprendizado por recompensa;
- custos de ação, como deslocamento, trabalho, risco e consumo de recursos.

As ações devem ser filtradas pelas regras do mundo. A política não pode construir sem materiais, conhecer recursos invisíveis ou ignorar bloqueios, distância e risco.

### 4.3 Comunidades e assentamentos

Comunidades podem cooperar, dividir tarefas, trocar recursos, migrar, crescer, separar-se ou se unir. Casas, abrigos, currais, mercados, oficinas e defesas consomem recursos e espaço. A construção afeta o ambiente e cria dependências de manutenção, acesso e trabalho.

### 4.4 Reinos e governança

Cada reino possui população, território, tesouro, reservas, instituições, governante e objetivos. O reino deve:

- equilibrar necessidades imediatas com preparação para estações e crises;
- delegar tarefas de acordo com capacidade, urgência, distância e disponibilidade;
- cobrar e gastar recursos com efeitos observáveis sobre a população;
- manter moradia, produção, armazenamento e defesa;
- reagir a insatisfação, perda de território, migração e sucessão política.

A substituição do governante deve resultar de regras sociais e políticas observáveis, como apoio, prestígio, recursos, lealdade e controle da força. A simples construção de um edifício não transfere automaticamente o poder.

### 4.5 Economia

A economia opera sobre recursos materiais finitos, estoques e fluxos. O ciclo básico é:

**ambiente e trabalho → coleta ou produção → transporte → armazenamento → consumo, troca ou construção → efeitos sobre a população e o ambiente.**

Recursos do MVP: alimento, água, madeira, pedra, ouro e alimento para rebanhos. Preços e decisões de troca respondem à oferta, demanda, localização, risco e reservas. Ouro pode facilitar aquisições, mas não cria recursos do nada.

### 4.6 Defesa e conflito

Reinos podem patrulhar, fortificar, recrutar, negociar, competir por recursos, invadir ou recuar. Uma decisão de conflito deve apontar causas observáveis, como:

- disputa por mina, água, passagem, área produtiva ou fronteira;
- escassez, dívida, pressão demográfica ou oportunidade estratégica;
- histórico de agressões, alianças, confiança ou quebra de acordos;
- avaliação de força, abastecimento, distância, terreno e risco.

Combate deve considerar mobilização, suprimento, tempo, terreno, cansaço, dano, baixas, feridos, moral e custo de oportunidade. Resultados probabilísticos podem existir, mas devem usar aleatoriedade com semente e registrar os fatores que contribuíram. Não haverá guerra sem causa apenas para gerar ação.

## 5. Arquitetura de decisão da IA

O simulador deve separar três escalas de decisão:

| Escala | Responsabilidade | Frequência esperada |
|---|---|---|
| **Estratégia do reino** | Definir prioridades, orçamento, preparação, expansão, diplomacia e defesa. | Diária ou acionada por eventos importantes. |
| **Delegação e coordenação** | Transformar prioridades em tarefas concretas e distribuí-las a pessoas ou grupos. | Quando muda a prioridade, a disponibilidade ou o estado da tarefa. |
| **Política individual** | Escolher ações locais usando necessidades, percepção, habilidades e experiência. | Em resposta a necessidades e oportunidades; não precisa rodar uma LLM por indivíduo. |

A estratégia do reino pode começar determinística e explicável. As redes neurais individuais continuam responsáveis por escolhas locais. O modelo local de linguagem já existente pode permanecer como experiência opcional e de baixa frequência, desde que:

- receba contexto limitado e ações candidatas válidas;
- não seja a fonte de verdade do estado da simulação;
- decisões sejam validadas por regras e custos;
- resultados sejam registrados para replay e diagnóstico;
- falha, latência ou indisponibilidade retornem à política base.

A IA não deve controlar diretamente o renderer nem alterar o estado do mundo fora dos comandos válidos do domínio.

## 6. Ciclo de simulação

A simulação deve manter um relógio reproduzível, com níveis de atualização adequados a cada processo:

1. clima, água, solo e efeitos ecológicos atualizam o estado ambiental;
2. necessidades, percepção, tarefas e planos dos agentes são avaliados;
3. indivíduos executam ações viáveis, com custos e resultados registrados;
4. produção, transporte, consumo, comércio e construção atualizam estoques;
5. governança, relações, sucessão, território e conflitos resolvem consequências;
6. o diário causal publica eventos e um snapshot para inspeção e renderização.

A proposta de cadência inicial é manter clima, ecologia e economia em passos diários; atualizar mercado e impostos em ciclos mais longos; e resolver movimento, combate e ordens por subpassos ou duração de ação quando o MVP exigir. A cadência exata deve ser validada por testes e benchmark antes de aumentar o custo por agente.

## 7. Escopo do MVP

### Incluído

- mundo procedural reproduzível por semente;
- dois reinos autônomos no cenário inicial, com possibilidade futura de divisão e formação de novas facções;
- população, governantes, necessidades, tarefas, memória local e redes neurais individuais;
- alimentos, água, madeira, pedra e ouro com coleta, transporte, estoque, consumo e troca;
- assentamentos, casas, castelos, mercados, currais e estruturas defensivas com custos verificáveis;
- um planejador estratégico por reino que define prioridades e delega trabalho;
- expansão territorial, tensão de fronteira, defesa e conflitos limitados, com consequências persistentes;
- observação do mapa, controle de velocidade, crônica e inspeção de indivíduos, reinos e decisões;
- salvamento/replay determinístico para configuração e semente iguais;
- execução de cenários fixos em múltiplas sementes para revelar diferenças emergentes.

### Referência para o primeiro cenário, não limite final

A branch inspecionada usa atualmente grade de **96 × 96 células**, **10 m por lado** (0,9216 km² de área nominal), 50 pessoas, dois reinos e 24 ovelhas no início. Essa configuração serve como baseline experimental; não define o tamanho final do mapa, a população-alvo ou o número final de facções.

### Fora do MVP

- jogador comandando trabalhadores, economia ou exército;
- multiplayer, campanha roteirizada ou árvore extensa de missões;
- LLM por indivíduo ou decisão neural em cada quadro;
- simulação científica exaustiva de toda a biosfera;
- port para Unity, MonoGame ou engine 3D sem um requisito e benchmark que justifiquem a migração;
- equilíbrio artificial que impeça fome, derrota, ruptura ou extinção.

## 8. Interface de observação

A interface deve tornar o estado do mundo compreensível sem transformar a simulação em uma lista de estatísticas.

- **Mapa:** biomas, água, recursos, edifícios, fronteiras, rotas, tropas e áreas disputadas.
- **Painel do reino:** população, governante, reservas, satisfação, produção, tarefas, território e defesa.
- **Inspetor individual:** necessidades, habilidades, percepção recente, objetivo, ação, custo, memória e resultado.
- **Crônica:** eventos datados, com ator, alvo, local, recursos envolvidos e causa registrada.
- **Cadeia causal:** por exemplo, seca → menor disponibilidade de alimento → queda de reservas → migração → perda de trabalhadores → vulnerabilidade defensiva.
- **Reprodução:** pausar, avançar passo, ajustar velocidade, repetir semente e comparar cenários.

Os relatos em linguagem natural são explicações derivadas de eventos registrados; não substituem nem alteram o estado que foi simulado.

## 9. Critérios de sucesso do produto

O primeiro vertical slice é aceito quando:

1. o mundo executa sem comandos humanos e os reinos continuam tomando decisões;
2. todo edifício, troca, recrutamento, ataque e deslocamento usa recursos e tempo reais;
3. ações inválidas são recusadas pelo domínio, independentemente da política que as sugeriu;
4. o observador consegue explicar por que um reino cresceu, migrou, entrou em conflito ou colapsou;
5. a mesma semente e versão reproduzem os mesmos eventos dentro do modo determinístico;
6. decisões locais usam informação que o agente poderia perceber;
7. ao menos uma execução de um ano pode ser acompanhada e inspecionada em sementes fixas;
8. build, testes e benchmark têm resultados registrados; a população e o tamanho de mundo suportados são definidos por medição, não presumidos.

Não há condição de vitória do jogador no MVP. O resultado é avaliado pela autonomia, coerência, legibilidade e desempenho do mundo.

## 10. Stack atual e decisão técnica

### O que o repositório usa hoje

- Vite e navegador como aplicação de execução;
- TypeScript junto a módulos JavaScript (`allowJs: true`, `checkJs: false` no `tsconfig.json`);
- Canvas 2D próprio para o mapa e interface HTML/CSS;
- módulos de simulação para clima, hidrologia, flora, fauna, indivíduos, sociedades, economia e reinos;
- testes com `node:test`;
- rede neural individual pequena em JavaScript;
- `@mlc-ai/web-llm` como camada local opcional, executada em Web Worker com WebGPU.

### Diagnóstico

A stack é **suficiente para o MVP web 2D** e para validar a experiência observacional. Não há evidência para uma troca imediata de engine. O código já separa parte dos domínios e expõe uma fachada de simulação, mas o crescimento da proposta exige evoluir as fronteiras e o controle de execução.

Pontos técnicos que o primeiro marco deve confirmar ou endereçar:

- a simulação diária é executada de forma síncrona; o relógio da interface pode avançar até 12 dias em uma chamada, o que tende a bloquear o quadro se o mundo crescer;
- `src/ui/game.js` concentra renderização, eventos de interface, inspeção e integração com a simulação em um arquivo extenso;
- arquivos `.js` da simulação não passam pela verificação estrita de tipos porque `checkJs` está desativado;
- o modelo WebLLM atende solicitações em fila e não é adequado para controlar cada indivíduo a cada passo;
- há uma divergência aparente: `src/config/ecosystem.js` define 96 × 96, enquanto `tests/integration/migration.test.mjs` espera 192 × 192. O teste precisa ser executado para confirmar e corrigir ou documentar a diferença;
- a IA estratégica atual adiciona um conselho opcional a decisões individuais; ela ainda não representa um planejador de reino separado que distribui uma agenda completa de governo.

### Decisão recomendada

**Manter TypeScript + Vite + Canvas 2D no curto prazo. Evoluir a arquitetura antes de trocar a stack.**

1. Estabelecer baseline de build, testes, replay, throughput e memória em cenários e browsers definidos.
2. Isolar o núcleo da simulação do DOM e executá-lo em um Web Worker; enviar comandos de entrada e snapshots/deltas de saída por contratos versionados.
3. Quebrar `game.js` em renderer, controles de observação, inspetores e conectores de estado.
4. Migrar gradualmente a simulação para TypeScript estrito, ou ativar verificação de JavaScript por diretório, sem reescrever tudo de uma vez.
5. Medir o custo antes de introduzir estruturas data-oriented: arrays tipados para campos densos do mapa, índices espaciais e atualizações em regiões ou agentes ativos podem ser adotados quando o benchmark demonstrar benefício.
6. Manter Canvas 2D como renderer inicial. Avaliar PixiJS/WebGL somente se o custo medido de sprites, zoom, camadas ou animação for o gargalo.
7. Manter WebLLM opcional para aconselhamento estratégico pouco frequente; políticas locais leves continuam sendo a base rápida, barata e reproduzível.

Uma migração para outra engine só deve ser reaberta se o produto exigir 3D/nativo ou se benchmarks mostrarem que a solução web não atende ao orçamento acordado.

## 11. Arquitetura lógica proposta

| Módulo | Responsabilidade | Fronteira principal |
|---|---|---|
| **Simulation Core** | Estado, relógio, semente, reprodutibilidade, comandos e eventos. | Não depende de DOM, Canvas ou LLM. |
| **World & Ecology** | Terreno, clima, água, solo, flora, fauna e recursos naturais. | Expõe observações e mudanças de estado. |
| **Economy & Settlements** | Inventários, produção, transporte, mercado, construção e manutenção. | Valida custos e disponibilidade. |
| **Individuals & Communities** | Necessidades, percepção, memória, relações, tarefas e políticas individuais. | Agentes recebem observações limitadas e emitem ações candidatas. |
| **Kingdom Strategy** | Prioridades do reino, delegação, orçamento, sucessão, diplomacia e defesa. | Emite planos; não escreve diretamente no mundo. |
| **Conflict & Military** | Patrulha, mobilização, combate, baixas, ocupação e encerramento de conflitos. | Consome tempo, recursos, unidades e estado político. |
| **Observer & Renderer** | Mapa, painéis, timeline, inspetores, visualização e controles de tempo. | Consome snapshots/eventos; não decide regras da simulação. |

### Contratos essenciais

- **Observation:** dados locais filtrados por sentidos, acesso institucional ou inteligência disponível.
- **Plan/Command:** intenção com ator, alvo, prioridade, validade e origem da decisão.
- **Validation:** checagem de capacidades, custo, caminho, posse, prazo e estado atual.
- **Event:** mudança ocorrida com tick, causas, participantes, custos e resultado.
- **Snapshot:** visão consistente para salvar, replay, renderer e comparação de cenários.

## 12. Riscos e mitigação

| Risco | Mitigação inicial |
|---|---|
| Escopo de RTS cresce antes do núcleo estar estável. | Entregar uma fatia jogável observacional e fechar gates antes de adicionar sistemas. |
| Crescimento do mapa torna a simulação lenta. | Benchmark antes/depois, worker, atualizações em múltiplas escalas e dados compactos. |
| IA parece aleatória ou onisciente. | Observações limitadas, decisões registradas, causas, custos e validação determinística. |
| LLM atrasa ou falha. | Limitar frequência, manter fila pequena, fallback local e nunca bloquear a simulação. |
| Muitos ajustes arbitrários dificultam entendimento. | Centralizar parâmetros, registrar a justificativa e usar fixtures para relações importantes. |
| Testes deixam de representar o código atual. | Alinhar dimensão do cenário, fixtures e critérios com o baseline da branch. |
| Conflito vira espetáculo sem causalidade. | Exigir motivo, capacidade, abastecimento, risco e consequências registradas. |

## 13. Roadmap de produto proposto

### M0 — GDD e baseline técnico

Validar escopo observacional, cenário inicial, build, testes, determinismo e custo atual. Resolver a divergência de dimensão entre configuração e teste.

### M1 — Núcleo reproduzível e observador desacoplado

Definir contratos de comandos, eventos e snapshots; mover simulação para Worker; preservar replay e manter UI responsiva.

### M2 — Planejamento e delegação por reino

Criar política estratégica separada para cada reino, prioridades e tarefas delegadas, mantendo ações e custos validados pelo domínio.

### M3 — Economia e crescimento de assentamentos

Consolidar produção, transporte, armazenagem, consumo, mercado, construção, manutenção e efeitos demográficos.

### M4 — Território, diplomacia e conflito

Implementar motivos rastreáveis para disputa, preparação, defesa, guerra, recuo, perda e reorganização política.

### M5 — Vertical slice autônomo

Acompanhar múltiplos reinos por um ano, comparar sementes, inspecionar eventos causais e medir o limite de escala da máquina/browser de referência.

## 14. Primeira issue recomendada

**Auditar baseline do Kingdom antes de ampliar o RTS autônomo.**

Entregáveis: resultado real de `npm run build` e `npm test`, resolução da expectativa 96 × 96 versus 192 × 192, seeds determinísticas de referência, throughput/memória para o cenário atual, mapa de módulos e recomendação quantificada para o próximo passo. Esta issue deve preceder uma reescrita ou mudança de engine.

## 15. Decisões abertas

- Qual browser e hardware definem o alvo mínimo do primeiro MVP?
- O mundo começa com dois reinos em todos os cenários ou o gerador poderá iniciar populações sem reinos e observar sua formação?
- Qual janela temporal define a primeira demonstração: um ano, várias gerações ou ambos em velocidades distintas?
- Qual quantidade de população e dimensão de mapa deve ser o primeiro alvo de escala após o benchmark?
- Como conhecimento estratégico é preservado, compartilhado ou perdido quando um reino se divide ou é conquistado?
- Quais ações da pessoa observadora são aceitáveis sem alterar a tese de autonomia?
