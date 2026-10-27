# Decisão: modelo estratégico no navegador — 27/10/2026

## Decisão

Usar **Qwen3 0.6B ONNX quantizado em Q4F16 como candidato provisório** para as propostas estratégicas do rei e do general no navegador. A escolha é limitada ao conjunto testado diretamente em WebGPU. Não demonstra que Qwen3 seja o melhor modelo geral do Kingdom nem conclui JUL-221: ainda falta avaliação de general, diálogos, p95 e classes de hardware.

O app baixa os pesos sob demanda, usa o cache do navegador e não exige Ollama. WebGPU é a rota observada nesta máquina; CPU/WASM continua como fallback de carregamento. Uma inferência que exceder 30 s encerra o Worker, aplica o plano determinístico e deixa a IA desativada até o jogador reativá-la.

## Comparação observada

| Candidato | Ativação no browser | Respostas observadas | Desempenho e limite |
| --- | --- | --- | --- |
| `onnx-community/Qwen3-0.6B-ONNX`, revisão `58ca03a5e7b354b480b1a82b34bde8dc7b854cc0`, `q4f16` | Baixou o arquivo de pesos de 570 MB e inicializou em WebGPU; estimativa total do cache: 579 MB | No ensaio pareado e pausável da seed `3620835298`, quatro decisões (dias 13, 19, 37 e 41) passaram pelo contrato JSON e escolheram uma ação permitida. Todas escolheram “buscar alimento para a reserva comum”; a repetição pode refletir as opções e a escassez do cenário, não prova qualidade estratégica. Uma segunda execução observou mais quatro decisões válidas; entre as latências exibidas pelo jogo estavam 6,9 s e 4,0 s. | Uma decisão exibiu 8,9 s. Uma quinta chamada permaneceu pendente por mais de 40 s e foi cancelada ao desativar a IA. Hardware, VRAM, RAM e p95 não foram expostos pelo playtest. O timeout foi então adicionado e coberto por teste unitário; não se afirma que o caso de 40 s foi reexecutado com o novo limite. |
| `onnx-community/Qwen3.5-0.8B-ONNX-OPT`, revisão `9a4c21d8f724176b0a7edaaed36303044451886e`, `q4f16` | Baixou/preparou cerca de 664 MB e inicializou em WebGPU | Foram observadas 4 saídas recusadas pelo validador e 2 decisões válidas. | Latência individual comparável não foi registrada; as consultas iniciais demoraram aproximadamente 40–60 s. A proporção pequena não é benchmark de qualidade. |
| `onnx-community/SmolLM2-360M-Instruct-ONNX`, revisão `fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9`, `q4f16` | Baixou 272 MB e inicializou em WebGPU. | No seed `1444968414`, uma saída do rei e outra do general foram recusadas por não serem objetos JSON completos. No ensaio pareado `3620835298`, o histórico continuou vazio e três pedidos foram vistos até o dia 61, incluindo um ainda pendente; nenhum foi aceito. O fallback determinístico permaneceu responsável pelas ordens. | Latência comparável não foi obtida. O model card oficial limita o uso principalmente a inglês, uma desvantagem para prompts e explicações em português. |

Ambos foram executados pelo mesmo adapter Transformers.js/Worker e pelo mesmo contrato de saída, em uma única máquina e seed observada. Não foram medidos tokens/s, TTFT, CPU/RAM de processo, VRAM, temperatura, prompt tokens, p95 ou o perfil sem WebGPU. Não comparar diretamente estes números com GGUF/Ollama.

## Por que esta escolha

O model card do [Qwen3 0.6B ONNX](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/tree/58ca03a5e7b354b480b1a82b34bde8dc7b854cc0) documenta uso via `pipeline('text-generation', ...)` em Transformers.js; a revisão também contém o artefato `model_q4f16.onnx` de 570 MB. O [Qwen3.5 0.8B ONNX OPT](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT/tree/9a4c21d8f724176b0a7edaaed36303044451886e) é suportado pelo runtime, mas na amostra testada teve mais saídas incompatíveis e maior download.

A decisão segue a orientação de avaliar a política em cenários repetíveis, separando planejamento de execução: [Tribes](https://doi.org/10.1609/aiide.v16i1.7438), [Hierarchical Macro Strategy Model](https://doi.org/10.1609/AAAI.V33I01.33011206) e [Resource-Aware Strategic Planning](https://doi.org/10.3390/info17100963). Esses estudos não medem estes modelos, esta implementação ou este hardware. A cota do Consensus permaneceu indisponível; não usei a literatura como prova de latência.

## Alternativas e limite da adoção

1. **Manter Qwen3.5 0.8B**, conforme a preferência inicial. Rejeitado como candidato atual porque o playtest produziu quatro saídas inválidas e latência incerta.
2. **Usar Qwen3 0.6B provisoriamente.** Escolhido para o runtime browser, mantendo o estado experimental e o fallback. A amostra não prova o comportamento do general nem a qualidade das ordens de cultivo.
3. **Voltar ao Ollama ou promover uma família maior.** Adiado: o objetivo de execução direta no browser não requer servidor instalado e nenhuma avaliação pareada dos baselines Ollama foi realizada.

Não fechar JUL-221, JUL-211, JUL-178 ou JUL-224 com esta evidência. Antes de adoção final: testar os cenários de rei e general com entradas idênticas e gabarito/rubrica prévios; medir pelo menos 30 consultas por papel, mediana/p95, taxa de JSON válido, ação executável e timeout; repetir em hardware WebGPU distinto e CPU/WASM; registrar licença e limites de distribuição do artefato ONNX. O timeout de 30 s e o fallback reduzem o dano de consultas lentas, mas não fazem o modelo mais rápido.

## Fontes e arquivos

- Model cards e arquivos ONNX vinculados acima; revisões e arquivos registrados em `src/ai/model-manifest.js`.
- Playtest CUA em `http://127.0.0.1:4174/`, seed `3620835298`; Qwen3 foi ativado, decidiu quatro vezes e uma consulta posterior ficou pendente por mais de 40 s. A captura visual mostrou o painel “IA ativa no navegador · qwen3:0.6b · WebGPU”.
- `node --test tests/browser-ai-engine.test.mjs tests/ai-calendar-observations.test.mjs`: 10/10 aprovados; a suíte `npm test`: 227/227; `npm run typecheck` e `npm run build`: aprovados. O build produz o Worker de inferência separado (602 kB) e o runtime WASM (26,86 MB), baixados quando necessários.
- `tests/browser-ai-engine.test.mjs`: cancelamento, mensagens correlacionadas e encerramento em timeout.
- Consensus indisponível por quota até 01/11/2026, conforme contexto da JUL-195. A decisão depende dos ensaios locais, não de uma comparação publicada.

## Método da comparação e evidências externas

SciSpace encontrou trabalhos que reforçam avaliar ação executável e resultado verificável em execuções repetidas, e separar erro de raciocínio de falha de formato: [GameWorld (arXiv:2604.07429)](https://arxiv.org/abs/2604.07429) e [Where Small Language Models Break](https://doi.org/10.5281/zenodo.21496991). São referências metodológicas; nenhuma mede os candidatos deste ensaio, Qwen em WebGPU ou o hardware desta máquina. A busca também retornou [TinyLLM](https://doi.org/10.48550/arXiv.2511.22138), um estudo de uso de SLMs para ferramentas em edge devices; seus resultados não substituem este contrato do Kingdom.

O [model card do SmolLM2 360M](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct) afirma que os modelos SmolLM2 entendem e geram principalmente inglês; o [artefato ONNX Q4F16](https://huggingface.co/onnx-community/SmolLM2-360M-Instruct-ONNX/tree/fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9/onnx) mede 272 MB. A conversão ONNX deve ter sua licença/distribuição verificada antes de qualquer promoção.

### Limitações operacionais deste ciclo

A busca de notas compartilhadas do Linear falhou com `Tool get_agent_context not found`; segui o texto vigente de JUL-195 e as issues, código e evidências do repositório. A cota do Consensus continua indisponível até 01/11/2026. SciSpace e a skill Game Studio (`game-playtest`) foram consultados; o playtest manual foi feito no browser real, seed `3620835298`, com o painel de IA ativa e histórico visíveis. O screenshot foi capturado no playtest, mas não foi anexado como arquivo aos issues nesta rodada.
