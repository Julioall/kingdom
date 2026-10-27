# Recuperação de falha OrtRun/WebGPU — 27/10/2026

O usuário relatou `BufferManager::Download`, `map_async_result.status` e falha de `OrtRun()` na decisão do rei. Depois informou que o erro parou ao fechar um de dois projetos abertos. Essa correlação é compatível com contenção de recursos quando ambos executam modelos na GPU; não prova esgotamento de VRAM nem identifica uma falha de driver. Os logs da aba disponível durante a investigação já não continham a ocorrência original.

Foram corrigidos problemas verificáveis no tratamento da falha:

- O worker serializa inicialização e inferência. Cancelar a resposta não autoriza uma segunda inferência enquanto a anterior ainda executa no ONNX Runtime.
- A liberação assíncrona das sessões é aguardada antes de carregar o fallback; rejeição da liberação não mascara o erro principal.
- A recuperação em WASM usa os grafos q4 do mesmo modelo e revisão fixados, em vez de reutilizar fp16/q4f16. A listagem do repositório fixado foi consultada e contém `embed_tokens_q4`, `decoder_model_merged_q4` e `vision_encoder_q4`, incluindo dados externos. Esses arquivos podem exigir download próprio quando ainda não estão em cache.
- A recuperação recebe um limite finito separado de 120 segundos; novas decisões em CPU usam 90 segundos, mantendo 30 segundos na GPU. Atualizações repetidas de status não renovam indefinidamente a janela de recuperação.
- Falha também na recuperação invalida e encerra o worker, rejeita operações pendentes e desativa a IA com mensagem de contingência, evitando reutilização automática de uma sessão danificada.
- A fatia de tokens de saída também é liberada após decodificação.

O backend principal continua WebGPU. O fallback determinístico continua sendo a proteção da simulação se a recuperação de inferência não for possível.

Validação: 30 testes direcionados de IA/contexto/modelo passaram, incluindo execução do código real do worker em um harness com backend simulado, concorrência de mensagens, descarte assíncrono, erro GPU seguido de CPU, erro fatal duplo, limpeza de tensores e prazo de recuperação. Typecheck aprovado. A falha física da GPU não foi provocada novamente, pois o usuário informou que ela já cessara ao fechar o outro projeto. Esses testes não comprovam que o driver ou dois modelos concorrentes ficaram estáveis.

Referências: código instalado de `@huggingface/transformers` 4.3.1 (`PreTrainedModel.dispose` devolve uma Promise), [documentação WebGPU](https://huggingface.co/docs/transformers.js/guides/webgpu), [dtypes](https://huggingface.co/docs/transformers.js/main/en/guides/dtypes) e [modelo fixado](https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX-OPT/tree/9a4c21d8f724176b0a7edaaed36303044451886e/onnx).
