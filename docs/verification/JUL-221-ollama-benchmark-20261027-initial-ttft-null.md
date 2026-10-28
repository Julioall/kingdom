# Resultado bruto do benchmark Ollama JUL-221

Data UTC: 2026-10-27T11:20:06.083Z
SHA inicial: indisponível
Hardware: Intel Core i3-10105 · 4C/8T; 16 GiB RAM; NVIDIA GeForce RTX 5060 · 8 GiB · driver 610.88 · Windows x64; OS Microsoft Windows 11 Pro 10.0.26200 build 26200
Ollama 0.40.11; 13 cenários; 3 repetições; medição via http://127.0.0.1:11434.

| Modelo/tag | Digest | Consultas | JSON/contrato válidos | Mediana (s) | p95 (s) | Erros | Timeouts | TTFT mediana (s) | CPU Ollama % sistema | RAM pico Ollama (GiB) | VRAM global pico (GiB) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| qwen3:0.6b | 7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435 | 45 | 18/45 | 1.33 | 2.96 | 27 | 0 | 0.00 | 0.4 | 0.05 | 6.64 |
| qwen2.5:1.5b-instruct | 65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b | 45 | 9/45 | 1.86 | 3.24 | 36 | 0 | 0.00 | 0.4 | 0.04 | 7.16 |
| qwen3:1.7b | 8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7 | 45 | 6/45 | 4.24 | 6.11 | 39 | 0 | 0.00 | 0.2 | 0.10 | 7.24 |
| qwen3.5:0.8b | de63045f29755d4721c09d54c9b45c2dadb644f4fd7d604d4cac90d96049971c | 45 | 15/45 | 2.89 | 4.60 | 30 | 0 | 0.00 | 0.2 | 0.04 | 7.34 |
| qwen2.5:0.5b | a8b0c51577010a279d933d14c2a8ab4b268079d44c5c8830c0a93900f1827c67 | 45 | 28/45 | 1.41 | 2.75 | 17 | 0 | 0.00 | 0.7 | 0.31 | 6.41 |
| smollm2:135m | 9077fe9d2ae1a4a41a868836b56b8163731a8fe16621397028c2c76f838c6907 | 45 | 0/45 | 1.15 | 2.32 | 45 | 0 | 0.00 | 0.5 | 0.05 | 5.79 |

As saídas completas, prompts, opções, telemetria e limitações estão no JSON que acompanha este resumo.

Estes números não incluem nota de estratégia; compare apenas após revisão humana cega pela rubrica registrada em `docs/decisions/JUL-221-benchmark-protocol-2026-10-27.md`.
