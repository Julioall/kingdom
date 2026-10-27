# Playtest do Qwen3.5 no navegador — JUL-221

**Data:** 27/10/2026 · **branch:** `test/kingdom-autonomous` · **HEAD-base antes das alterações locais:** `6067e6e59f24ee3252596548ca2723d9ce282a67` · **ambiente:** Vite temporário em `http://127.0.0.1:4178/`, mundo isolado, seed exibida `2039756209`.

## Configuração experimentada

O manifesto aponta para `onnx-community/Qwen3.5-0.8B-ONNX-OPT`, revisão `9a4c21d8f724176b0a7edaaed36303044451886e`, via `Qwen3_5ForConditionalGeneration` e `AutoProcessor` de Transformers.js. Foram testadas três combinações: `q4f16` em todos os componentes falhou ao criar sessão em `/model/pos_embed/emb_00_Quant`; embeddings/decoder Q4 com encoder visual FP16 abriu os pesos, mas não a sessão em `/model/embed_tokens/Gather_Quant` (`GatherBlockQuantized(1)`); embeddings FP16, decoder Q4F16 e encoder visual FP16 carregou e gerou no WebGPU. O modelo passou a mostrar latência e dispositivo na decisão aceita. O operador aparece no catálogo oficial do WebGPU EP, mas isso não garante que qualquer combinação de grafo/dtype funcione neste runtime/dispositivo.

## Resultado observado

No mundo isolado no browser real, o jogo confirmou duas decisões aceitas pelo general e expôs a proveniência: Valedouro em 16,1 s e Corvânia em 15,8 s, ambas identificadas como `WebGPU`. As decisões do rei também aparecem no histórico do mundo, mas não obtive telemetria individual suficiente para contá-las como medições de latência por papel. As decisões de general são evidência de geração real: o status de aceitação inclui duração e dispositivo e o Worker só inclui esses campos na resposta do modelo; o fallback determinístico não os fornece.

O navegador estava concorrendo com uma comparação Ollama na mesma GPU e a simulação continuou enquanto respostas eram processadas. São duas chamadas observacionais, não 30 por papel nem um p95 estatístico. Ambas ficam acima do limite pré-registrado de p95 ≤15 s; a amostra é insuficiente para concluir reprovação/promoção, mas sinaliza que não devemos prometer resposta rápida. O download frio do conjunto completo também não foi medido: variantes do decoder/encoder estavam no cache de ensaios prévios e a interface mostrou 509 MB para o novo arquivo de embeddings FP16.

As tentativas anteriores, antes desta combinação válida, caíram no fallback determinístico e não são inferências positivas. A partida ficou isolada da aba do usuário; o estado do browser demorou para responder aos comandos durante as gerações e chegou a avançar enquanto uma solicitação aguardava.

## Decisão e limitações

Qwen3.5 0.8B é agora uma candidata **tecnicamente funcional no browser nesta máquina**, usando embeddings FP16/decoder Q4F16/encoder visual FP16 e sem Ollama. Continua experimental: a baixa amostra, latência ~16 s e ausência de medição fria/resource attribution não demonstram que seja a melhor opção. A rota anterior Qwen3 0.6B e os baselines Ollama permanecem comparadores. Não promover até completar os gates de qualidade e desempenho por papel.

Antes de promoção, falta concluir a comparação dos seis modelos Ollama, rubricar as saídas anonimizadas, medir pelo menos 30 consultas por papel no browser sem outra carga GPU, p95, CPU/RAM/VRAM atribuível, cache/download frio, fallback CPU/WASM e classe distinta de hardware. Também é necessário validar que a exportação ONNX e os arquivos de licença permitem a forma de distribuição planejada.

## Fontes

- Model card oficial do [Qwen3.5 0.8B ONNX](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX), que documenta embeddings/decoder Q4 e encoder visual FP16. A [tabela do WebGPU EP](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md) lista `GatherBlockQuantized`; isso não garante que o grafo e a versão runtime fixados pelo app consigam abrir a sessão.
- A documentação Transformers.js de [dtypes por módulo](https://huggingface.co/docs/transformers.js/v3.8.1/en/guides/dtypes) mostra `embed_tokens: fp16` como combinação suportada em outro modelo; essa alternativa ainda precisa ser testada para Qwen3.5.
- Protocolo e limiares registrados antes da medição em `docs/decisions/JUL-221-benchmark-protocol-2026-10-27.md`.
