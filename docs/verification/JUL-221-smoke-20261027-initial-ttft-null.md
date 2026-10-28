# Resultado bruto do benchmark Ollama JUL-221

Data UTC: 2026-10-27T11:18:38.963Z
SHA inicial: indisponível
Hardware: Intel Core i3-10105 · 4C/8T; 16 GiB RAM; NVIDIA GeForce RTX 5060 · 8 GiB · driver 610.88 · Windows x64; OS Microsoft Windows 11 Pro 10.0.26200 build 26200
Ollama 0.40.11; 13 cenários; 1 repetições; medição via http://127.0.0.1:11434.

| Modelo/tag | Digest | Consultas | JSON/contrato válidos | Mediana (s) | p95 (s) | Erros | Timeouts | TTFT mediana (s) | CPU Ollama % sistema | RAM pico Ollama (GiB) | VRAM global pico (GiB) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| qwen3.5:0.8b | de63045f29755d4721c09d54c9b45c2dadb644f4fd7d604d4cac90d96049971c | 15 | 5/15 | 2.20 | 2.81 | 10 | 0 | 0.00 | 0.4 | 0.04 | 4.63 |

As saídas completas, prompts, opções, telemetria e limitações estão no JSON que acompanha este resumo.

Estes números não incluem nota de estratégia; compare apenas após revisão humana cega pela rubrica registrada em `docs/decisions/JUL-221-benchmark-protocol-2026-10-27.md`.
