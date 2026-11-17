# NPC hot path sampling

A CI Performance V2 mostrou que ~90% do custo de `societyAndNpcActions` foi registrado como `npcOtherActorWork` num ensaio de 3 seeds × 7 dias. Este relatório, sozinho, **não identifica qual função dentro desse laço** causa a despesa.

A função `src/simulation/observability/cpu-profile-summary.js` transforma o formato de amostragem V8 em uma lista de funções com `self samples`, sem dependências do navegador e sem alterar o mundo autoritativo.

## Execução local

```sh
mkdir -p out/npc-profile
node --cpu-prof --cpu-prof-dir=out/npc-profile --cpu-prof-name=npc.cpuprofile \
  scripts/benchmark-simulation.mjs --days=7 --warmup=2 --repeats=1 --seeds=42 \
  --output=out/npc-profile/benchmark.json
node scripts/summarize-cpu-profile.mjs \
  --input=out/npc-profile/npc.cpuprofile --output=out/npc-profile/hotspots.json
```

A workflow `Kingdom NPC CPU hotspots` guarda o `.cpuprofile` original e o resumo em artefato. O perfil é **opt-in**: a execução normal do jogo não ativa CPU sampling.

## Como tomar decisões

- Só alterar uma função depois de verificar a linha, o número de chamadas e as características da seed.
- Para movimento, priorizar reutilização de caminhos e índices, sem quebrar passagens, perseguições ou bloqueios.
- Para comércio, evitar varreduras globais e manter contratos de posse/transação atômicos.
- Para IA, preservar informações percebidas, razões, consequências e qualidade de decisão. Acelerar reduzindo tudo a escolhas aleatórias não atende à fantasia de Kingdom.
- A/B com seeds 1/42/2026 e seeds reservadas; hashes autoritativos iguais para otimizações puras, custo/resultado para políticas modificadas.
- CPU sampling do Node não mede a GPU nem o FPS de 144 Hz. Repetir benchmarks com warm-up e cenários de população e guerra.
