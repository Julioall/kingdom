# Revisão da integração de combate e magias na dev

Data: 30/10/2026. PR [#55](https://github.com/Julioall/kingdom/pull/55). Base de integração: `dev` em `e3709b2`; implementação revisada em `7e3531d`.

## Resultado

Combate manual, magias dos sacerdotes, impactos, animações e desbloqueios por treino/combate passaram na revisão local integrada. A base recente de comércio, defesa territorial, alarmes de torre, áudio e fechamento dos modais foi preservada. A publicação deve usar a base `dev`, sem atualizar `main`.

Seis conflitos foram conciliados por comportamento: imports/eligibilidade de combate, prioridade e distribuição dos defensores de fronteira, eventos de guerra e alarme, fechamento dos painéis e geometria dos pergaminhos. Testes confirmam que defesa territorial e controle manual continuam coexistindo.

Foram corrigidas duas premissas frágeis nos cenários novos da `dev`: o coletor/comerciante deve ser adulto e estar voltado ao recurso observado; a geração atual podia selecionar uma criança ou um adulto olhando para o lado oposto. O cenário unitário de magia recebeu tiles neutros para executar a nova checagem territorial. Nenhuma asserção funcional de coleta, comércio ou elegibilidade foi removida.

O teste visual foi atualizado para a fita de 47 px pedida pelo usuário. O corpo dos pergaminhos mantém 50 px de respiro nos extremos dos painéis de Reinos/Crônicas, scroll contido e a geometria responsiva da `dev`. Os scripts de magias/impactos aceitam outro endereço para testar o checkout isolado, evitando testar acidentalmente o servidor antigo da pasta original.

## Evidências

- `npm ci --no-audit --no-fund`: instalação pelo lockfile.
- `npm test`: **576/576 aprovados**, sem skips; `browser-ui-evidence/dev-review/full-tests-final.txt`.
- `npm run build`: TypeScript e Vite aprovados; 520 PNGs convertidos para WebP sem perda; `build-final.txt`.
- `npm run audit:food -- --days 30 --seeds 42 --repeat-seed 42`: repetição determinística, sem diferenças; `food-replay.json`. Executado após a integração da lógica; alterações posteriores foram de estilo, testes e scripts de QA.
- `verify-pixel-hud-browser.mjs`, desenvolvimento e produção: desktop 1440×900, tablet 1024×768, mobile 390×844 e mobile pequeno 320×640; 11 checks por viewport desktop/tablet e 13 por mobile, sem erros de página. Música cancelada ao trocar o estado da página é registrada como `ERR_ABORTED`, sem recurso ausente ou falha de runtime.
- QA nativo de magias com 100 veteranos, três arremessos mantendo a vida intacta e sangue em ataque básico: sem erros de página. JSONs e imagens selecionadas em `browser-ui-evidence/dev-review/`.
- Capturas de configurações, crônicas e viewport pequeno foram inspecionadas visualmente. Não houve vazamento de texto ou sobreposição dos controles pelos painéis revisados.

## Escopo preservado e pendências

As exclusões locais preexistentes de assets e arquivos de trabalho da pasta original não entraram na integração. O build foi executado num checkout com os assets versionados completos.

XP individual por habilidade continua pendente na JUL-193. A revisão não declara resolvido o custo de batalhas grandes nem o congestionamento inicial já rastreado em #54; medições de FPS desta rodada, executada junto a testes/build, não são um benchmark de desempenho.
