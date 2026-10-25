# Comparar modelos locais do Kingdom

O benchmark compara `qwen2.5:0.5b`, `smollm2:135m` e `smollm2:360m` usando Ollama. O Needle 2 foi retirado da avaliação por desempenho inadequado nos cenários e custo de processamento. O benchmark continua separado do fluxo do jogo e não envia comandos à simulação; o rei integrado já consulta Qwen pelo serviço local. Requer Node 22+ e Ollama em execução.

```powershell
# Comparação completa: 192 respostas (3 modelos × 16 casos × 2 modos × 2 repetições).
npm run benchmark:ai -- --pull

# Comparação de generais com saída estruturada: 120 respostas.
npm run benchmark:ai -- --role general --mode schema --repeats 5

# Modelo isolado; o diretório de saída deve ser novo.
npm run benchmark:ai -- --models smollm2:135m --out reports/ollama/teste-135m

npm run benchmark:ai -- --help
```

Se o servidor estiver parado, abra o Ollama ou execute `ollama serve` em outro terminal. `--host` ou `OLLAMA_HOST` seleciona outro servidor. O script usa somente modelos Ollama já instalados, salvo com `--pull`.

## O que está sendo medido

Há oito cenários de rei e oito de general, com gabarito editorial inspecionável em `scripts/ai-benchmark/scenarios.mjs`. As escolhas do rei vêm de `kingdomStrategyChoices`, usando relatórios sintéticos com o formato do jogo. As ações militares são uma proposta para um futuro controlador de generais; ainda não são comandos do jogo.

Os casos cobrem fome, mercado, ração, cultivo, materiais, prioridades concorrentes, pedido com instrução indevida, força militar, suprimentos, reconhecimento, defesa e ordens. Alguns casos têm uma única ação possível e medem principalmente o contrato de saída. Vários gabaritos aceitam mais de uma escolha razoável.

- `plain`: pede JSON no prompt, sem restringir a geração.
- `schema`: também aplica um JSON Schema com enum das ações possíveis no Ollama.
- **Acerto utilizável:** JSON completo, ação aceita pelo gabarito e resposta não truncada.
- **Ação correta:** escolha do gabarito recuperada pelo parser do jogo, inclusive seu fallback textual.
- **JSON válido:** objeto com exatamente `action`, `confidence` entre 0 e 1 e `reason` preenchido.
- **Mediana/p95:** tempo total da chamada entre respostas concluídas; erros e timeouts aparecem separadamente.
- **Tokens/s:** tokens de saída divididos pelo tempo de geração informado pelo Ollama; não equivale a decisões por segundo.
- **Memória:** tamanho do modelo no disco, alocação informada por `/api/ps` e p95 do working set de processos durante as chamadas.
- **Processamento:** no Windows, o sampler mede CPU-ms por chamada e uso relativo a um núcleo (pode exceder 100% quando vários núcleos são usados). O relatório calcula decisões utilizáveis por segundo de CPU.
- **Custo monetário:** inferência local não gera cobrança por chamada/token. O benchmark não estima kWh ou reais porque não há leitura de potência por modelo.

Ollama usa temperatura 0,1, contexto 2048 e limite de 96 tokens. A lista de escolhas é rotacionada a cada repetição para reduzir viés de posição. A ordem plain/schema alterna entre repetições, embora cache e ordem fixa dos modelos ainda possam influenciar a latência. Há um aquecimento por modelo, excluído das medições. Os modelos são descarregados entre grupos; outros processos podem competir por recursos.

## Arquivos de saída

Cada execução cria uma pasta em `reports/ollama/`, ignorada pelo Git:

- `report.md`: comparação ordenada por acerto utilizável e velocidade.
- `summary.json`: métricas agregadas de qualidade, RAM, CPU e tempos.
- `results.jsonl`: prompts, respostas, gabaritos, avaliações, tempos e erros de cada chamada.
- `metadata.json`: configurações, casos, baseline determinístico do rei, versão do Ollama, hardware e informações dos modelos carregados.

O baseline atual é uma política por regras, não uma rede TinyML treinada. Serve como referência de custo e qualidade. A revisão humana ainda precisa avaliar as justificativas e o idioma.

## TinyML e decisões dos habitantes

TinyML é uma abordagem de redes pequenas para tarefas específicas, não um nome de modelo no Ollama. O jogo já usa redes pequenas individuais em `src/controllers/individual/neural.js`, combinadas com utilidade, memória de recompensas e viés de plano. Essa camada continua responsável por decisões frequentes. Os modelos comparados aqui são úteis para experimentar decisões menos frequentes, como estratégia do rei ou ordens militares, mas a avaliação atual não os integrou ao jogo.

Este teste não demonstra que um modelo governa melhor numa partida. Para isso, é necessário comparar controladores em simulações completas com várias seeds, medindo sobrevivência, produção, custo de campanha e cumprimento de ordens. As medições históricas do WebLLM não preveem diretamente o desempenho do serviço Ollama integrado.
