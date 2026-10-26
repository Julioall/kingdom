# JUL-172 — replay integrado e playtest

## Reproduzir

- Replay orgânico e sua repetição: `npm run audit:social -- --days 30 --seeds 42 --repeat-seed 42 --output docs/verification/JUL-172-social-replay-integrated-30-seed42-20261026.json`
- Cobertura integrada com a apresentação do jogo: `node --test tests/social-slice-integration.test.mjs`
- Testes sociais completos: `node --test tests/social-evidence.test.mjs tests/social-meetings.test.mjs tests/water-indication.test.mjs tests/social-aid.test.mjs tests/social-inspector.test.mjs tests/social-slice-integration.test.mjs`

## Resultados

- Testes direcionados: **35/35**. A integração repetiu o mesmo mundo controlado e comparou fatos, memórias e recursos antes de verificar o texto do inspetor.
- Suíte completa: `npm test` — **128/128**, sem falhas, em 95,7 s.
- Build: `npm run build` — `tsc --noEmit`, Vite (107 módulos) e otimização dos assets passaram.
- O replay orgânico do seed 42 repetiu estado (`29416dc9f1ec49265682e5d7683947060981c7382a2dcdbb94a26b903446f4a8`) e crônica (`c6a551b98b806f28f377b7d4db8544dc6a712dd79314280266873cbcf1cb7086`) em 30 dias.
- O motor registrou 3 conversas e 11 transferências de ajuda alimentar; não houve indicação de água nem pedido de ajuda nesse horizonte. A amostra não é evidência de taxa populacional.
- Playtest browser com `?seed=42&paused=1`, simulação pausada no dia 78 e zoom enquadrado em 200%: o inspetor do morador Ravi O mostrou três fatos “Observado diretamente”: partilhas de alimento nos dias 27, 31 e 35. A captura está em `JUL-172-social-inspector-replay-20261026.png`.
- A fixture integrada cobre os quatro efeitos até o mesmo renderer de produção: conversa confirmada, referência de água relatada com coordenadas observadas, ajuda aceita com recursos movidos e pedido recusado sem transferência. Os testes unitários mantêm as guardas de visibilidade, alcance, emergência, arbitragem diária, confiança direcional e idempotência.
- A verificação do playtest e o teste integrado não mudam o estado do produto nem alteram o replay natural. `git diff --check` fica limpo após a inclusão somente dos cinco arquivos desta fatia; os cinco relatórios locais preexistentes permanecem fora do commit.

## Revisão de código

Não foi necessária mudança de gameplay. A regressão é de integração de evidência: mantém a fixture controlada pequena e explícita, chama os resolvers de produção e testa as linhas renderizadas que o inspetor real usa. Consulte [`JUL-172-social-slice-validation`](../decisions/JUL-172-social-slice-validation.md) para fontes, alternativas e limites.
