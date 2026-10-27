# JUL-177 — smoke test de browser — 27/10/2026

## Ambiente

- Branch: `test/kingdom-autonomous`.
- Checkout no início do smoke: `c143044` (runtime sem alterações desde `7c67efe794cb5aae1b7be5d132f737b77fe806a0`).
- Aplicação local: `http://127.0.0.1:5177/`, navegador Chromium embutido, viewport 1280×720.
- Teste em aba isolada; o jogo começou com dois reinos e 96 pessoas.

## Cenários executados

1. **Boot e estado acionável:** a tela terminou de carregar com mapa, controles, calendário, painel de reinos e estado global visíveis. O relógio avançou do dia 13 para o dia 37 durante o smoke, antes de pausar.
2. **Pausa e velocidade:** “Pausar simulação” passou para “Retomar simulação” e o dia parou em 37. O controle alterou 1× para 2× enquanto pausado.
3. **Mapa e zoom:** o mapa iniciou em 50%; “Enquadrar mapa em 200%” ampliou a ilha para uma visualização legível. Lagos, vegetação, construções e os dois assentamentos continuaram visíveis.
4. **Painéis:** abrir “Reinos” e selecionar Valedouro mostrou comida, ouro, população, satisfação, moradia e contadores de incidentes. “Crônicas” abriu eventos legíveis de manutenção de fortificações, mantendo área suficiente do mapa à vista.
5. **Console:** coleta CUA de logs de nível `error` e `warn` retornou lista vazia.

## Interpretação e limites

O boot, a atualização contínua do dia, pausa, velocidade, zoom, seleção de reino e crônica passaram. `src/app/session.ts` cria `simulation.worker.ts` como Worker de módulo; o progresso do relógio no browser é coerente com esse caminho. Esta verificação não instrumentou diretamente mensagens/thread do Worker, nem é um replay determinístico. As capturas foram inspecionadas visualmente durante o smoke; nenhuma mudança visual foi feita neste commit.

O primeiro mapa aparece pequeno no zoom inicial de 50%, mas o controle de enquadramento é acessível e o mapa fica legível em 200%. Isso é uma observação de apresentação, não bloqueia o smoke e não foi alterado nesta etapa.
