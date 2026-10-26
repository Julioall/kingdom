# JUL-181 — verificação de contato e apresentação de combate

Data: 26/10/2026
Branch: `codex/jul195-integration`

## Testes

- `node --test tests/combat-contact.test.mjs tests/combat-integration.test.mjs`: 34/34 aprovados no código final; inclui as oito direções das três classes, desvios e misses sem dano, terreno/estrutura como obstrução, tiro elevado de torre, defesa, custo/cooldown, contatos de fortificação e impacto no instante/ponto do contato confirmado.
- `npm test`: 148/148 aprovados em 83,63 s no código final deste commit, incluindo replay do Worker de produção até o dia 192 com 17 ações de combate e uma campanha.
- `npm run build`: `tsc --noEmit`, Vite (107 módulos) e otimização lossless de 489 PNGs passaram; assets de 8,03 MiB para 5,27 MiB.

## Playtest de navegador

- Execução local em `http://127.0.0.1:5174/?seed=42&combatDebug=1&paused=1`; a tela inicial abriu normalmente com mapa, controles e HUD acessíveis.
- A execução seed 42 em velocidade 3× chegou ao dia 152 em campanha ativa. A 200% de zoom, `combatDebug=1` desenhou a curva/volume do ataque, a hitbox e o ponto real de contato; a captura da sessão mostra o evento `#17 structure` em aproximadamente 228,9 ms, sobre a torre sob ataque. O HUD, o mapa e a crônica permaneceram utilizáveis. O console do navegador retornou zero `error`/`warn`.
- A captura foi inspecionada visualmente e permanece na aba de playtest. Não foi anexada ao Linear: o acesso do Linear via IAB abriu “Create a workspace”, e a política do navegador recusou a persistência da captura por URL `data:`. Não usei outra rota para contornar a recusa.

## Limites

- Consensus indisponível por quota mensal. SciSpace consultado; fontes, uso restrito e alternativas estão em `docs/decisions/JUL-181-combat-contact-contract.md`.
