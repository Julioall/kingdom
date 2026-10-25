# Worker de simulação

## Limites de propriedade

`src/simulation/simulation.worker.ts` instancia `createSimulationWorkerRuntime()` e mantém o único estado mutável do mundo. O Canvas, os controles DOM, o mapa projetado e o inspetor continuam na thread principal. `GameSession` envia pedidos versionados e converte snapshots em uma projeção reutilizável para desenho; essa projeção não é passada de volta ao motor.

A UI não chama `stepDay`. Cada pedido `advance` executa de 1 a 12 dias no Worker e devolve um snapshot. A pausa interrompe o envio do relógio visual, descarta dias ainda não enviados e atualiza o estado de pausa do Worker; um lote já em andamento termina com no máximo três dias. O avanço manual continua permitido durante a pausa. Assim, não há loop independente nem fila longa de dias que continue após a UI pausar.

## Mensagens

Todos os pedidos e respostas usam `{ protocolVersion, requestId, epoch, revision }`. A versão atual é `5`, incluindo decisões para rei e general, o campo de identidade do talhão cultivado na coluna `ids` e a liderança versionada das formações de campanha no estado-base do snapshot. `requestId` correlaciona o resultado, `epoch` identifica a vida atual do mundo, e `revision` avança após uma mutação. Um reset incrementa a época, cancela promessas antigas e substitui a projeção no cliente. Respostas de outra época ou com revisão antiga não substituem o estado atual.

Pedidos aceitos:

| Tipo | Campos | Efeito |
| --- | --- | --- |
| `initialize` | `config`, `seed` | Cria o mundo e devolve o snapshot inicial. |
| `reset` | `seed`, `kingdomAiEnabled` | Substitui o mundo em uma época nova e, se solicitado, reativa a estratégia local por reino. |
| `set-paused` | `paused` | Confirma o estado de pausa controlado pela UI. |
| `advance` | `days` de 1 a 12; `source` `clock` ou `manual` | Avança dias pela sequência normal do motor. O Worker rejeita avanços do relógio depois da pausa, mas permite um passo manual. |
| `dispatch` | `command` | Valida e executa comando de domínio em `commands.js`. |
| `set-kingdom-ai` | `enabled` | Liga ou desliga a fila compartilhada dos reis e generais. |
| `pull-kingdom-ai-request` | `limit` de 1 a 3 | Retira o próximo relatório de rei ou general e entrega ao modelo local compartilhado; pedidos urgentes recebem prioridade. |
| `apply-kingdom-ai-decision` | pedido versionado e decisão | Valida novamente entidade, época, campanha, ordem, validade e ações; aplica plano de reino ou ordem de campanha se ainda forem válidos. |
| `fail-kingdom-ai-request` | pedido versionado | Registra falha e agenda nova tentativa; a estratégia ou campanha por regras continua no comando. |
| `inspect-tile` | `x`, `y` | Consulta um tile no Worker. A tela também pode ler a projeção já recebida. |

As respostas são `snapshot`, `ack`, `kingdom-ai-request`, `query` ou `error`. Reinos e lados de campanha conservam pedidos e ordens isolados; o modelo compartilhado processa uma inferência por vez, com fila limitada. Os reis são consultados a cada 24 dias; o intervalo inicial experimental do general é 12 dias e cai para cinco em alerta de suprimentos, coesão ou rota. O domínio continua validando comandos; opções inválidas ou vencidas não alteram o mundo. O Worker processa mensagens em ordem. A sessão mantém no máximo um pedido de avanço contínuo em trânsito, agrupa até três dias que chegam enquanto o Worker responde e descarta a fila do relógio quando o usuário pausa. A UI também agrupa três dias em 12×; em ritmos menores, envia cada dia logo após o relógio produzi-lo.

## Formato do snapshot

O snapshot separa o estado não espacial (`base`) dos tiles e dos registros visíveis. Eventos e troncos são listas completas: a crônica mantém somente os eventos mais recentes e troncos existentes podem mudar após sua criação.

Cada tile usa colunas tipadas para evitar o custo de copiar milhares de pequenos objetos:

- `scalars`: 17 números por tile, em `Float32Array`.
- `ids`: região, reino, lago, talhão cultivado e fim da recuperação de toco, em `Int32Array`.
- `types`: terreno, classe de solo e tipo de água, em `Uint8Array`.
- `plants`: biomassa de cada espécie em `Float32Array`.

Em 128 × 128 células e 8 espécies vegetais, as colunas de tile somaram **2.342.912 bytes** (cerca de 2,23 MiB) na medição atual: `cropFieldId` identifica o talhão no cliente. Seus quatro buffers tipados são transferidos ao cliente em vez de clonados. O estado de pessoas, animais, estruturas, reinos e economia permanece no campo serializável `base`. A projeção reutiliza objetos de tile entre dias e atualiza seus campos e arrays de planta no lugar; um reset cria uma projeção nova.

O formato de tile é um contrato da UI, não um save. Antes de adicionar uma camada de tiles, atualize `render-snapshot.js`, `protocol.ts` e seus testes. Não use a projeção como input do motor.

## Medição e escala

Use `npm run worker-baseline` para repetir o trecho padrão: semente 42, mapa 128 × 128, cinco dias de aquecimento, 90 dias medidos em três execuções e lotes de três dias. O script executa o runtime do Worker no Node, simula `postMessage` com `structuredClone` e transferência dos quatro buffers e hidrata a projeção principal. Ele exclui o Canvas e o escalonamento real entre threads. O Worker não solicita o objeto de resumo produzido por `stepDay` nos dias intermediários; para comparar o caminho anterior, defina `WORKER_DAILY_SNAPSHOTS=1` no PowerShell antes do script.

No checkpoint histórico de 96 × 96, o medidor com lote de 3 dias registrou 11,93, 12,94 e 12,36 dias/s (mediana **12,36 dias/s**). Na medição atual de 128 × 128, o caminho do Worker sem resumos diários intermediários registrou 11,86, 12,26 e 12,74 dias/s (mediana **12,26 dias/s**); o motor síncrono do mesmo mapa mediu 17,09, 17,77 e 16,41 dias/s (mediana 17,09). As colunas de tiles somaram 2.342.912 bytes, a base serializada 391.809 bytes e o primeiro snapshot serializado 2.736.694 bytes. Esses valores medem simulação, clonagem, transferência e hidratação, não o tempo de quadro completo.

O script cronometra as três etapas. No checkpoint antigo de 96 × 96, 30 snapshots em 90 dias custaram medianas de 6.195 ms no runtime e criação da projeção, 915 ms no clone/transferência e 203 ms na hidratação. No A/B atual de 128 × 128, o caminho anterior levou 5.917,77 ms no runtime/projeção, 1.223,17 ms no clone/transferência e 450,54 ms na hidratação; sem resumo intermediário, levou 5.514,23 ms, 1.269,71 ms e 474,41 ms. A primeira etapa inclui `stepDay` e `createWorldSnapshot`; o baseline síncrono ajuda na comparação, mas não constitui profiling interno dessas funções. A diferença de 6,8% em runtime/projeção não se converte integralmente no throughput total, e os dados de memória do A/B foram inconsistentes.

Para separar as fases internas, `npm run profile-simulation` instrumenta `stepDay` sem compartilhar esse custo com o Worker de produção. O pré-filtro dos castelos/torres e o índice de reinos reduziram os dois recálculos territoriais juntos de 30,07 para 5,23 ms/dia na seed 42 e de 24,68 para 5,08 ms/dia na seed 2026, mantendo tiles e contagens. Após a mudança, pessoas e território somam cerca de 56,5% do custo mediano; pessoas sozinhas ficam perto de 47%. Como essa medição modifica o caminho cronometrado, seus tempos absolutos não devem ser comparados aos baselines sem instrumentação; o detalhamento e os p95 por seed estão em [baseline.md](./baseline.md).

Uma comparação histórica em 96 × 96, com três repetições por configuração, mediu 12,36 dias/s para lotes de 3 dias, 13,17 para lotes de 6 e 13,59 para lotes de 12. O lote maior ganhou 9,9% sobre o de 3 dias, mas multiplicaria por quatro a quantidade de dias que podem terminar antes da próxima resposta de pausa. A UI continua limitada a três dias por avanço; os outros lotes servem apenas para isolar custo de snapshots.

Na medição atual de 128 × 128, após GC, o heap usado foi 5,74 MiB antes da criação, 56,80 MiB após a criação e 74,26 MiB após aquecimento e simulação; o RSS foi 65,25, 170,50 e 544,64 MiB. O medidor mantém runtime e projeção no mesmo processo Node, portanto não representa memória isolada do Worker de navegador. O smoke test anterior no navegador registrou 47 respostas após um reset, com mediana de 175,9 ms, p95 de 201,8 ms e máximo de 304,3 ms; o Chrome não expôs `performance.memory`. Compare leituras de memória apenas com o mesmo runtime e método.

O mapa maior de 288 × 288 ainda não foi validado. Nove vezes mais células que o mapa atual ampliam as colunas, o trabalho de cada dia, a hidratação e a renderização; meça esse cenário antes de afirmar suporte.
