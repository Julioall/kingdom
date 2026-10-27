# Decisão de runtime e candidato de SLM — JUL-221

**Data:** 27/10/2026
**Decisão:** adiar adoção; manter Qwen3.5 como protótipo experimental do navegador, sem promoção ou encerramento da JUL-221.
**Fonte da comparação Ollama:** `32928fb451545cd630208f1450713f1ea76f83a7`
**Branch:** `test/kingdom-autonomous`

## Pergunta e escopo

O usuário escolheu `qwen3.5:0.8b` e pediu que ele pudesse rodar no navegador sem Ollama; depois autorizou comparar e testar outras opções para escolher a de melhor desempenho. A pergunta desta etapa foi: qual candidato oferece a melhor combinação de contrato, latência, memória e viabilidade real em WebGPU para rei e general, sem confiar em velocidade ou texto convincente isoladamente?

Os testes medem superfícies diferentes. Ollama usou GGUF local; o protótipo web usa ONNX/Transformers.js no Chrome/WebGPU. As métricas de Ollama não predizem a execução do navegador. Referências técnicas consultadas: [cartão ONNX do Qwen3.5](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT), [cartão ONNX do Qwen2.5 0.5B](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct), [guia WebGPU do Transformers.js](https://huggingface.co/docs/transformers.js/en/guides/webgpu), [guia de dtypes do Transformers.js](https://huggingface.co/docs/transformers.js/main/en/guides/dtypes) e [limitações do WebGPU no ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html). Esses documentos confirmam viabilidade de integração e diferenças de suporte/dtype; não provam qualidade do Kingdom.

## Evidência quantitativa

O protocolo foi registrado antes da comparação em `docs/decisions/JUL-221-benchmark-protocol-2026-10-27.md`. Cada modelo recebeu os mesmos 13 cenários, três repetições por cenário, parâmetros pareados e até 192 tokens. O gate de formato/contrato para sequer avançar à avaliação humana foi **≥95%**. O resumo e as respostas completas, com digests e telemetria, estão em `docs/verification/JUL-221-ollama-benchmark-20261027.{md,csv,json}`.

| Modelo Ollama | Respostas no contrato | Mediana | p95 | Falhas | Decisão desta rodada |
|---|---:|---:|---:|---:|---|
| `qwen2.5:0.5b` | 28/45 (62,2%) | 1,07 s | 1,85 s | 17 | Melhor candidato quantitativo, ainda reprovado |
| `qwen3:0.6b` | 18/45 (40,0%) | 1,44 s | 2,79 s | 27 | Reprovado |
| `qwen3.5:0.8b` | 15/45 (33,3%) | 1,93 s | 2,51 s | 30 | Reprovado |
| `qwen2.5:1.5b-instruct` | 9/45 (20,0%) | 1,90 s | 3,23 s | 36 | Reprovado |
| `qwen3:1.7b` | 6/45 (13,3%) | 1,94 s | 2,23 s | 39 | Reprovado |
| `smollm2:135m` | 0/45 (0%) | 0,79 s | 1,07 s | 45 | Reprovado |

Todos tiveram zero timeout e p95 de latência abaixo de 15 s. Nenhum chegou ao limite de formato. Essa métrica mede JSON/contrato, **não** estratégia, acerto do plano, pontuação humana ou execução do `WorldWorker`; não foi feita avaliação cega e portanto não há nota estratégica. O vencedor de latência/contrato (`qwen2.5:0.5b`) só passa 28 das 45 respostas. Não se promove nenhum modelo com esse resultado.

O processo Ollama teve RSS máximo de até 0,30 GiB; a RAM total chegou a 13,90 GiB de 16 GiB e a VRAM global observada variou de 3,92 a 5,10 GiB de 8 GiB. O driver não expôs memória atribuível por processo; o pico global não deve ser interpretado como consumo dos SLMs. Hardware, digest e métricas por resposta constam no JSON.

## Playtest real no navegador

Chrome, mundo de seed `1040553135`, zoom 200%, modelos servidos pelo cache do navegador via WebGPU e Ollama descarregado (`ollama ps` sem modelos). As screenshots estão anexadas a JUL-221 e salvas em:

* `docs/verification/JUL-221-browser-qwen35-no-ollama-20261027.png` — Qwen3.5 ativo, com uma decisão de general aceite (`avançar ao objetivo`, ~7,4 s), decisões do rei visíveis e uma requisição posterior ainda pendente.
* `docs/verification/JUL-221-browser-qwen25-no-ollama-final-20261027.png` — candidato Qwen2.5 ativo durante o teste; o histórico mostra decisões aceitas dos reis, mas várias repetem “buscar alimento para a reserva comum”; uma solicitação do general permaneceu em “pensando” até a sessão ser pausada e a IA desativada. O histórico e a ação do rei não provam que o general concluiu.

Ambos comprovaram que inferência ONNX pode rodar localmente no browser sem Ollama neste dispositivo. Isso não comprova funcionamento em GPU/browser diferentes, primeira carga dentro do limite, fallback CPU/WASM, estabilidade de longo prazo, nem 30 respostas válidas por papel. As observações do playtest não foram agregadas à taxa Ollama.

Uma tentativa reversível de limitar `reason` a 96 caracteres e encurtar instruções foi testada; não resolveu a saída incompleta de Qwen3.5 e uma chamada chegou a 28,6 s com JSON inválido. A alteração foi revertida e não foi mantida. O comportamento de insistir em buscar comida mesmo quando os indicadores agregados não justificam a ordem também exige revisar o contexto/política do rei; não deve ser mascarado pelo schema nem tratado como vitória do modelo.

## Escolha e alternativas

1. **Manter `qwen3.5:0.8b` no protótipo WebGPU, status experimental.** É a escolha explícita original do usuário e já tem integração ONNX/browser observável. A configuração do produto não muda nesta rodada.
2. **Manter `qwen2.5:0.5b` como candidato da próxima rodada.** Ele liderou a comparação Ollama em latência e formato e gerou decisões de rei na amostra de browser. Porém continua abaixo do gate de 95%, repetiu uma política possivelmente inadequada de busca de comida e não concluiu o teste de general. Não há base para substituí-lo como padrão.
3. **Não adotar `qwen3:0.6b` por ter JSON mais frequente que Qwen3.5.** Seu 40% de conformidade é insuficiente e não há playtest equivalente em browser.
4. **Não instalar uma LLM por morador.** O Worker, catálogo autorizado, timeout, validação de estado/ator e fallback continuam sendo a autoridade. A inferência é uma proposta limitada por papel, não execução autônoma.

O resultado de referência do experimento é, portanto, **adiar adoção para rei e general**. Preservar a opção direta de mouse/menu e os controladores/fallbacks existentes. A integração web continua atrás da opção experimental; não fazer mudança para Ollama como runtime do usuário.

## Próxima fatia e fontes de pesquisa

Antes de nova promoção, pontuar corpus cego com a rubrica já registrada, rodar 30 consultas por papel no browser com contagem completa de sucesso/timeout, testar primeira carga/cache/WASM em hardware representativo, medir temperatura/ram/VRAM atribuíveis quando disponíveis e verificar ações no `WorldWorker`. Para o rei, resolver a evidência de repetição de buscar comida contra o estado econômico; para o general, bloquear com teste de cancelamento/timeout e provar que a fila não fica permanentemente em “pensando”. Retomar em JUL-221 depois que JUL-206/JUL-210 definirem e registrarem as bases e limites pertinentes.

Consensus foi consultado, mas recusou novas buscas por quota mensal esgotada até 01/11/2026; SciSpace foi consultado, porém os resultados recuperados nesta sessão não foram suficientemente verificáveis para fundamentar uma escolha de runtime. Game Studio orientou o fluxo de playtest no navegador. Por isso a decisão técnica se baseia principalmente no contrato/replays reproduzíveis, documentação oficial do runtime/modelos e comportamento diretamente observado, sem atribuir causalidade à literatura não verificada. Repetir a consulta do Consensus após a renovação da cota se uma decisão de arquitetura social/estratégica ainda depender de literatura.

## Status das evidências

* Protocolo pré-registrado: sim.
* Comparação Ollama reproduzível e exportada: sim, no SHA `32928fb451545cd630208f1450713f1ea76f83a7`.
* Prova de execução WebGPU sem Ollama neste computador: sim, separada por candidato.
* Gate de formato ≥95%: **reprovado por todos**.
* Rubrica humana cega, cenários `WorldWorker`, 30/papel no browser e fallback browser: pendentes.
* JUL-221 e JUL-195: permanecem em andamento.
