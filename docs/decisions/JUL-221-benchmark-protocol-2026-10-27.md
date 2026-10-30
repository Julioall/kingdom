# Protocolo do benchmark de SLM — JUL-221

**Registrado antes da execução comparativa em 27/10/2026.** Este protocolo mede o serviço local Ollama nos mesmos prompts, opções e máquina; não equipara GGUF/Ollama a ONNX/WebGPU no browser.

## Escopo e método

O runner `scripts/benchmark-ai-models.mjs` exercita as nove situações de JUL-221 e quatro extensões M8: limite de arqueiros disponíveis, autoridade/seleção/versão do mundo, alvo ambíguo e resposta obsoleta após mudança de estado. São três repetições por cenário e modelo. Cada solicitação começa sem histórico; a exceção é a situação de memória, que faz três turnos na mesma sessão. Os cenários compartilham contexto e esquema JSON, com catálogo de ações e atores permitido específico. A temperatura é zero, o `seed` muda de forma pareada entre repetições e o número máximo de tokens é igual.

O artefato guarda prompts, saída integral, tag/digest devolvidos pelo Ollama, opções, validação JSON/contrato, duração do servidor e TTFT observado pelo primeiro fragmento não vazio. Saída limitada a 192 tokens e contexto 2.048 para corresponder ao baseline JUL-211. Uma amostra periódica do processo Ollama agrega CPU/RAM de `ollama*`; `nvidia-smi` registra VRAM/uso/temperatura global e memória de processos atribuível quando o driver a expõe. Falhas de observabilidade são `null`, nunca zero. Tempo frio (`load_duration`) fica separado da inferência após aquecimento. O runner grava JSON completo, CSV por resposta (prompt/saída incluídos) e resumo Markdown.

## Limites definidos antes das medições

Limites operacionais para avançar à avaliação humana, não autorização automática de produção:

* Saída JSON completa e conforme ao contrato: **≥95%** das respostas; cada ID de ação deve pertencer ao catálogo da cena.
* Cenários críticos de autoridade, seleção e resposta obsoleta: **zero** ação executável com ator fora da seleção/autorização ou `worldVersion` antigo. A resposta deve esclarecer, rejeitar ou replanejar quando necessário.
* Cálculo e uso dos fatos: **≥90%** de acerto nos itens rubricados; erro material de recursos, disponibilidade ou alvo reprova o cenário afetado.
* Avaliação humana cega, 0–2 por dimensão (fatos/cálculo, política e papel, viabilidade, tratamento de ambiguidade/risco, clareza em português): média **≥8/10**, nenhum zero em fatos, autorização ou viabilidade.
* Desempenho Ollama: p95 de inferência **≤15 s**, timeout **<1%**, com aquecimento e frio discriminados. Limite do processo Ollama: pico de RSS **≤4 GiB**. Referência de recurso da máquina: RAM total **<14 GiB/16 GiB** e VRAM global **<6 GiB/8 GiB** no pico; valores globais não são atribuídos ao modelo.
* A promoção no browser tem gate independente: browser real, dispositivo/driver, download frio e cache, WebGPU e fallback CPU/WASM, telemetria do Worker, 30 consultas por papel e p95; o benchmark Ollama não o substitui.

Uma resposta com JSON válido não prova boa estratégia. O corpus de saídas precisa ser anonimizado e embaralhado para avaliação cega; até existir pontuação cega revisada, registrar apenas métricas observáveis e manter qualquer candidato experimental. Os limites podem ser revisados para experiências futuras, mas não retrospectivamente após ver resultados.

## Situações e respostas esperadas

As situações fixas são declaradas no script e cobrem defesa da vila, abastecimento com cálculo, sequência de obras, diplomacia, relatos conflitantes, construtores sob ameaça, transporte de alimento, defesa de ponte/formação e memória/continuidade. As quatro extensões M8 medem 50 arqueiros pedidos com 32 disponíveis, seleção/autoridade/versão, ambiguidade entre duas torres norte e descarte de resultado atrasado para estado já alterado.

## Limitações e adoção

O benchmark é uma avaliação sintética do modelo pela API Ollama; não executa as ordens contra `WorldWorker`, não demonstra o gameplay, não pontua adequação por juiz automático e não substitui a comparação com mouse/menu ou as issues JUL-206/210/211. Hardware registrado: Windows x64, Intel Core i3-10105 (4C/8T), 16 GiB RAM, GeForce RTX 5060 com 8 GiB, driver 610.88; Ollama 0.40.11. Registrar SHA da branch na execução. A versão/tag exata do modelo e o digest são lidos do runtime no início.

Nenhum modelo é promovido pelo resultado do runner. Candidatos devem cumprir a rubrica e os gates correspondentes; a integração browser permanece separada e experimental.
