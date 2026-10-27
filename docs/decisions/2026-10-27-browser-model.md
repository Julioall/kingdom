# Decisão: modelo estratégico no navegador — 27/10/2026

## Decisão

Usar **Qwen3 0.6B ONNX quantizado em Q4F16 como candidato provisório** para as propostas estratégicas do rei e do general no navegador. A escolha é limitada ao conjunto testado diretamente em WebGPU. Não demonstra que Qwen3 seja o melhor modelo geral do Kingdom nem conclui JUL-221: ainda falta avaliação de general, diálogos, p95 e classes de hardware.

O app baixa os pesos sob demanda, usa o cache do navegador e não exige Ollama. WebGPU é a rota observada nesta máquina; CPU/WASM continua como fallback de carregamento. Uma inferência que exceder 30 s encerra o Worker, aplica o plano determinístico e deixa a IA desativada até o jogador reativá-la.

## Comparação observada

| Candidato | Ativação no browser | Respostas observadas | Desempenho e limite |
| --- | --- | --- | --- |
| `onnx-community/Qwen3-0.6B-ONNX`, revisão `58ca03a5e7b354b480b1a82b34bde8dc7b854cc0`, `q4f16` | Baixou o arquivo de pesos de 570 MB e inicializou em WebGPU; estimativa total do cache: 579 MB | No ensaio pareado e pausável da seed `3620835298`, quatro decisões (dias 13, 19, 37 e 41) passaram pelo contrato JSON e escolheram uma ação permitida. Todas escolheram “buscar alimento para a reserva comum”; a repetição pode refletir as opções e a escassez do cenário, não prova qualidade estratégica. Uma segunda execução observou mais quatro decisões válidas; entre as latências exibidas pelo jogo estavam 6,9 s e 4,0 s. | Uma decisão exibiu 8,9 s. Uma quinta chamada permaneceu pendente por mais de 40 s e foi cancelada ao desativar a IA. Hardware, VRAM, RAM e p95 não foram expostos pelo playtest. O timeout foi então adicionado e coberto por teste unitário; não se afirma que o caso de 40 s foi reexecutado com o novo limite. |
| `onnx-community/Qwen3.5-0.8B-ONNX-OPT`, revisão `9a4c21d8f724176b0a7edaaed36303044451886e`, `q4f16` | Baixou/preparou cerca de 664 MB e inicializou em WebGPU | Na amostra anterior houve 2 decisões válidas e 4 saídas recusadas. No ensaio de mesmo seed inicial `3620835298`, o histórico do jogo registrou ações do rei nos dias 53 e 72 (`capture sheep`, `prepare food shelter`) e do general nos dias 60 e 64 (`advance to objective`). Também houve uma resposta do rei recusada como JSON incompleto e uma proposta descartada porque já não era válida para o mundo. A simulação divergiu após as escolhas diferentes; os estados seguintes não são prompts idênticos. | Uma chamada do rei ainda estava “pensando” após 20 s e retornou recusada na observação seguinte; latência individual exata não foi exposta. Não há p95 nem tempo por token. |
| `onnx-community/SmolLM2-360M-Instruct-ONNX`, revisão `fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9`, `q4f16` | Baixou 272 MB e inicializou em WebGPU. | No seed `1444968414`, uma saída do rei e outra do general foram recusadas por não serem objetos JSON completos. No ensaio pareado `3620835298`, o histórico continuou vazio e três pedidos foram vistos até o dia 61, incluindo um ainda pendente; nenhum foi aceito. O fallback determinístico permaneceu responsável pelas ordens. | Latência comparável não foi obtida. O model card oficial limita o uso principalmente a inglês, uma desvantagem para prompts e explicações em português. |

Os três foram carregados pelo mesmo adapter Transformers.js/Worker, em WebGPU, e sob o mesmo contrato. Qwen3 e SmolLM2 usaram o mesmo seed inicial `3620835298` no teste pareado; Qwen3.5 também começou desse seed. A sequência do mundo divergiu depois das primeiras ordens, então não trate decisões posteriores como respostas ao mesmo prompt. Não foram medidos tokens/s, TTFT, CPU/RAM de processo, VRAM, temperatura, prompt tokens, p95 ou o perfil sem WebGPU. Não comparar diretamente estes números com GGUF/Ollama.

## Por que esta escolha

Qwen3 0.6B fica como candidato provisório por apresentar respostas mais rápidas e consistentes no contrato nos ensaios curtos, com download menor que Qwen3.5. Qwen3.5 0.8B mostrou decisões mais variadas (abrigo, ovelha e avanço do general), uma vantagem potencial para a estratégia; a resposta JSON incompleta, a proposta desatualizada e a lentidão observada impedem promovê-lo sem rubrica de qualidade e replay com prompts controlados. Qwen3 repetiu busca de alimento quatro vezes, que também não pode ser chamada de boa estratégia sem confirmar a necessidade e a viabilidade das demais ações no instante de cada pedido. A seleção é operacional, não um veredito de qualidade. O model card do [Qwen3 0.6B ONNX](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/tree/58ca03a5e7b354b480b1a82b34de8dc7b854cc0) documenta uso por Transformers.js e inclui `model_q4f16.onnx` de 570 MB; o [Qwen3.5 0.8B ONNX OPT](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT/tree/9a4c21d8f724176b0a7edaaed36303044451886e) também é compatível com esse runtime.

A decisão segue a orientação de avaliar a política em cenários repetíveis, separando planejamento de execução: [Tribes](https://doi.org/10.1609/aiide.v16i1.7438), [Hierarchical Macro Strategy Model](https://doi.org/10.1609/AAAI.V33I01.33011206) e [Resource-Aware Strategic Planning](https://doi.org/10.3390/info17100963). Esses estudos não medem estes modelos, esta implementação ou este hardware. A cota do Consensus permaneceu indisponível; não usei a literatura como prova de latência.

## Alternativas e limite da adoção

1. **Manter Qwen3.5 0.8B como principal.** Não descartado: variou mais as ações e produziu entradas no histórico do rei e general. Adiado como padrão porque também falhou o formato, teve proposta desatualizada e deixou uma inferência inicialmente pendente; a rubrica ainda não separa variedade útil de erro.
2. **Usar Qwen3 0.6B provisoriamente.** Escolhido para o runtime browser, mantendo o estado experimental e o fallback. A amostra não prova o comportamento do general nem a qualidade das ordens de cultivo.
3. **Voltar ao Ollama ou promover uma família maior.** Adiado: o objetivo de execução direta no browser não requer servidor instalado e nenhuma avaliação pareada dos baselines Ollama foi realizada.

Não fechar JUL-221, JUL-211, JUL-178 ou JUL-224 com esta evidência. Antes de adoção final: testar os cenários de rei e general com entradas idênticas e gabarito/rubrica prévios; medir pelo menos 30 consultas por papel, mediana/p95, taxa de JSON válido, ação executável e timeout; repetir em hardware WebGPU distinto e CPU/WASM; registrar licença e limites de distribuição do artefato ONNX. O timeout de 30 s e o fallback reduzem o dano de consultas lentas, mas não fazem o modelo mais rápido.

## Fontes e arquivos

- O model card upstream do [Qwen3 0.6B](https://huggingface.co/Qwen/Qwen3-0.6B/tree/main) declara licença Apache-2.0. O ONNX foi obtido da conversão `onnx-community`; antes de distribuição, conferir o arquivo de licença e os avisos do artefato convertido. Model cards e revisões ONNX estão vinculados acima e fixados em `src/ai/model-manifest.js`.
- Playtest CUA em `http://127.0.0.1:4174/`, seed `3620835298`; Qwen3 foi ativado, decidiu quatro vezes e uma consulta posterior ficou pendente por mais de 40 s. A captura visual mostrou o painel “IA ativa no navegador · qwen3:0.6b · WebGPU”.
- `node --test tests/browser-ai-engine.test.mjs tests/ai-calendar-observations.test.mjs`: 10/10 aprovados; a suíte `npm test`: 227/227; `npm run typecheck` e `npm run build`: aprovados. O build produz o Worker de inferência separado (602 kB) e o runtime WASM (26,86 MB), baixados quando necessários.
- `tests/browser-ai-engine.test.mjs`: cancelamento, mensagens correlacionadas e encerramento em timeout.
- Consensus indisponível por quota até 01/11/2026, conforme contexto da JUL-195. A decisão depende dos ensaios locais, não de uma comparação publicada.

## Método da comparação e evidências externas

SciSpace encontrou trabalhos que reforçam avaliar ação executável e resultado verificável em execuções repetidas, e separar erro de raciocínio de falha de formato: [GameWorld (arXiv:2604.07429)](https://arxiv.org/abs/2604.07429) e [Where Small Language Models Break](https://doi.org/10.5281/zenodo.21496991). São referências metodológicas; nenhuma mede os candidatos deste ensaio, Qwen em WebGPU ou o hardware desta máquina. A busca também retornou [TinyLLM](https://doi.org/10.48550/arXiv.2511.22138), um estudo de uso de SLMs para ferramentas em edge devices; seus resultados não substituem este contrato do Kingdom.

O [model card do SmolLM2 360M](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct) afirma que os modelos SmolLM2 entendem e geram principalmente inglês; o [artefato ONNX Q4F16](https://huggingface.co/onnx-community/SmolLM2-360M-Instruct-ONNX/tree/fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9/onnx) mede 272 MB. A conversão ONNX deve ter sua licença/distribuição verificada antes de qualquer promoção.

### Ensaios adicionais de candidatos no browser — 27/10/2026

Os candidatos abaixo foram testados em um worktree temporário isolado no head `6d54c041a00ac71fe94803ee6d152f0e648f4f84`, servido em `http://127.0.0.1:4175/`. Somente o manifesto temporário foi alterado; o manifesto da branch continua selecionando Qwen3 0.6B. A seed do mundo foi `3620835298`, Transformers.js/ONNX Q4F16 e WebGPU. O worktree e servidor temporários foram removidos ao terminar; as abas originais nas portas 4173/4174 não foram alteradas.

| Candidato | Evidência observada | Decisão para o browser nesta máquina |
| --- | --- | --- |
| `onnx-community/Qwen3-1.7B-ONNX`, revisão `e1da89f753284b95bd0971c64524f52edc5eb6e3`, Q4F16 | O card ONNX lista peso de 1,43 GB; o browser baixou 1.426 MB e chegou a preparar o runtime, mas falhou com `Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc`. O fallback do mesmo runtime também terminou indisponível. Nenhuma decisão foi gerada; não há latência de inferência a comparar. | Não viável neste dispositivo/configuração; não promovido. A memória de GPU disponível não foi exposta, então isso não prova que falhará em outras classes de hardware. |
| `onnx-community/Qwen2.5-0.5B-Instruct`, revisão `516c8d04add8a80c5228f32102b57953b8d421a9`, Q4F16 | O peso de 483 MB carregou em WebGPU. A interface mostrou uma escolha permitida de buscar alimento em 4,5 s e depois outra de 14,5 s. Nos logs da mesma partida houve pelo menos três saídas recusadas por JSON incompleto/repetição do campo `reason`, com durações de 11,189 s, 8,286 s e 5,642 s; o fallback determinístico assumiu. A simulação estava em 2× e avançou enquanto respostas eram processadas; a interface exibiu pedidos ainda analisando snapshots anteriores, então não considero essa rodada um teste controlado de qualidade estratégica. | Não substituir Qwen3 0.6B: a compatibilidade/velocidade do primeiro resultado não compensa a falha estrutural recorrente nesta amostra. É a família do baseline `qwen2.5:0.5b` do Rei, mas não é comparação direta com GGUF/Ollama: o artefato e runtime aqui são ONNX/WebGPU. |

Essa triagem não satisfaz o benchmark completo de JUL-221 nem compara resultados de prompt idêntico em múltiplas repetições. Ela confirma que, nesta máquina, Qwen3 1.7B não inicializa e Qwen2.5 0.5B Instruct ainda não produz contratos confiáveis de forma consistente. Mantenho Qwen3 0.6B como candidato operacional provisório por ter maior consistência observada até agora, sem concluir que sua política é estrategicamente melhor.

Fontes primárias dos artefatos: [Qwen3 1.7B ONNX](https://huggingface.co/onnx-community/Qwen3-1.7B-ONNX) lista Transformers.js e o peso Q4F16 de 1,43 GB; [Qwen2.5 0.5B Instruct ONNX](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct) documenta uso com Transformers.js e o peso Q4F16 de 483 MB. Os model cards confirmam compatibilidade declarada do artefato, não desempenho nesta máquina.

### Limitações operacionais deste ciclo

A busca de notas compartilhadas do Linear falhou com `Tool get_agent_context not found`; segui o texto vigente de JUL-195 e as issues, código e evidências do repositório. A cota do Consensus continua indisponível até 01/11/2026. SciSpace e a skill Game Studio (`game-playtest`) foram consultados; o playtest manual foi feito no browser real, seed `3620835298`, com o painel de IA ativa e histórico visíveis. O screenshot foi capturado no playtest, mas não foi anexado como arquivo aos issues nesta rodada.
