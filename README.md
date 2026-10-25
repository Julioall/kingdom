# Kingdom

Simulação de dois reinos, seus moradores, território e ecologia, executada no navegador.

## Executar localmente

```sh
npm install
npm run dev
```

`npm run dev` inicia o Vite e o serviço de IA local. O Ollama precisa estar instalado e aberto. Confira os modelos com `npm run ai:prepare -- --check`; `npm run ai:prepare -- --pull` baixa somente os modelos que faltam. Os pesos ficam no armazenamento do Ollama e o registro de digest local fica em `.local/`, fora do Git.

Para validar o build de produção com o mesmo serviço local, execute `npm run build` e depois `npm run preview`.

O [plano de integração da IA](docs/ai-integration-plan.md) organiza os testes e a implementação de Qwen no rei, SmolLM2 no general e controladores locais para comandantes, soldados e cidadãos.

O [plano de NPCs e interações sociais](docs/npc-social-plan.md) propõe memória, crenças, relações, compromissos e planos individuais, com entregas e critérios de validação separados da implementação atual.

A [direção de arte](docs/art-direction.md) descreve o estilo, as proporções e as paletas medidas dos assets atuais para orientar novos recursos.

Para comparar Qwen 2.5 0,5B e SmolLM2 135M/360M como rei ou general, execute o benchmark descrito em [docs/ai-benchmark.md](docs/ai-benchmark.md). O relatório inclui precisão, latência, memória e consumo de CPU local.
