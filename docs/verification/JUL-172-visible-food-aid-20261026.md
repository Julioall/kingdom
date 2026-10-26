# JUL-172 — ajuda alimentar baseada em observação local

Data: 26/10/2026
Branch: codex/jul195-integration
Commit de código: bb3d78f — feat(JUL-172): gate food aid on visible need
HEAD do replay: 6447ad6e7761041eb763b04293c3c5531891ed26

## Cenário controlado

Os testes usam a percepção atual para escolher o destinatário. O avistamento expõe somente o sinal booleano foodDistress abaixo de 48 pontos; não expõe foodReserve numérico. O sinal some quando o agente deixa de ver a pessoa, mesmo que a posição continue na memória.

- Ajuda comunitária: operação de estoque finito, saldo debitado, reserva do destinatário creditada; fato social, memória direta e crença de confiabilidade só surgem após a transferência.
- Ajuda pessoal: transferência do saldo real do doador, limitada pela capacidade do destinatário; ledger relacional usa o montante efetivamente movido.
- Falha: estoque vazio, pessoa visível sem sinal de necessidade ou destinatário fora da percepção não alteram estoque, reservas, confiança ou evidência.
- Focal: node --test tests/social-aid.test.mjs — 4/4.

## Replay orgânico

Comando: npm run audit:social -- --days 30 --seeds 42 --repeat-seed 42 --output docs/verification/JUL-172-visible-food-aid-replay-30-20261026.json

- stateAndChronicleMatch: true
- state SHA: 25249d59786d44d382ae5bf9cbaf31d3746e6ae6e4550648a13631d1f5935f5f
- chronicle SHA: c6a551b98b806f28f377b7d4db8544dc6a712dd79314280266873cbcf1cb7086
- Dia 30: 96 pessoas vivas, nenhuma morte, reserva alimentar média 65,15.
- Últimas ações dos vivos incluíram share para 2 agentes, mas o auditor não registra o número de fatos food_aid_transferred; não atribuo esses dois estados a ajuda confirmada. Este replay demonstra determinismo e ausência de regressão de sobrevivência no horizonte curto, não adoção espontânea bem-sucedida.

## Gates no HEAD 6447ad6e7761041eb763b04293c3c5531891ed26

- npm test — 97/97, 59,32 s.
- npm run build — typecheck e build passaram, 99 módulos; aviso já conhecido para bundle acima de 500 kB.
- git diff --check — passou após correção de whitespace nos documentos.

Sem mudança visual; screenshot não aplicável.

## Critérios de JUL-172 ainda pendentes

- Pedido explícito de ajuda que possa ser aceito ou recusado.
- Resolução atômica de encontros incompatíveis e suspensão em emergência.
- Informação de água conhecida com procedência, confiança direcional/familiaridade e regressão de coesão.
- Demonstração integrada de ponta a ponta no inspetor e replay orgânico com contador de ajuda confirmada.

