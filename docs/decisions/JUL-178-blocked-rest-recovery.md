# JUL-178 — aproximação e recuperação quando o descanso não avança

Data: 27/10/2026

## Reprodução

Na seed 42 do SHA `11c2c4025accd3cf1e8c037bd5d89b8f4e90e529`, o soldado Davi X permaneceu em `(62,26)` do dia 260 ao 294, com energia zero e estado “indo descansar na casa”. A entrada da casa 35 era `(61,25)`, a distância era 1,414 e o tile da entrada colidia com a casa. A campanha estava em retirada com ração de campo zero; a reserva pessoal caiu até zero e o soldado morreu de fome no dia 295. O estoque comunitário era alto, mas isso por si só não prova que estivesse acessível ao soldado em campanha.

Ao pedir rota para um destino obstruído, o roteador sem raio explícito considera chegada em até 1,5 célula. O descanso só aceita até 1,25. Nesse ponto diagonal, `moveOne` retornava falso porque considerava a rota encerrada, enquanto `restPersonInHouse` recusava o descanso e mantinha o alvo. Assim, nem se movia nem recuperava energia.

## Decisão

A movimentação para descanso agora usa o mesmo raio 1,25 da entrada. Se uma tentativa de movimento não avança — por rota inviável ou bloqueio momentâneo — o alvo é liberado para que a pessoa descanse no local e possa tentar novamente no futuro. O descanso ao ar livre recupera energia pela regra existente; não produz alimento, teleporta o personagem ou abre caminho através de obstáculos.

Foram consideradas duas alternativas: ampliar a distância de entrada para 1,5, que poderia admitir descanso em posições diagonais sem demonstrar acesso à entrada; e manter a espera sem recuperação, que reproduziu o bloqueio. O raio alinhado preserva a regra de acesso e a recuperação local evita um ciclo de energia zero quando a rota não avança.

## Evidência e limites

- `tests/home-rest-routing.test.mjs` reproduziu as duas falhas antes da correção: posição diagonal não avançava e rota totalmente bloqueada mantinha o alvo sem recuperação. Depois, verifica aproximação ao raio real e descanso externo para soldado e civil, sem movimento ou criação de ração.
- Testes focados de descanso e sobrevivência: 8/8; `npm test`: 264/264; `npm run build` (typecheck e build de produção) e `git diff --check` passaram.
- Replay de 365 dias da seed 42 no código `949b21e2fc97cb7bdeadc25acfaee46e1f4382aa`, repetido: estado `2bc825f87bf1b5f673ca071b01cce5e65622ec9bdc558c4e8b2cc6f01117590c` e crônica `ecb1d608fdd54061b54bd4e494a1669ca9667f3f4ae1e2e4ab7b80106b03bacf` coincidiram. Não houve mortes humanas; dois animais silvestres morreram de fome. O replay anterior tinha uma morte humana por fome e uma em combate. A mudança também altera trajetórias e decisões do mundo, portanto essa comparação não prova isoladamente a causa de cada diferença. Estoques comuns finais foram 8.955 e 21.838,14; o estoque inicial era zero e as contagens diárias são posteriores a cada passo. Relatório: `docs/verification/JUL-178-rest-recovery-365-seed42-20261027.json`.
- Trace da mesma seed no SHA `1694da146e9bd2eacbd939c96030d3e7efd11278`, executado com `node scripts/trace-rest-recovery.mjs --seed=42 --person=87 --days=365 --from=240 --output=docs/verification/JUL-178-rest-trace-365-seed42-20261027.json`: Davi entrou na casa 35 no dia 271, recuperou energia e permaneceu vivo ao dia 365 com saúde 84,12. O trace também mostra reserva pessoal zero em vários dias enquanto sua campanha 181 estava em retirada com ração de campo zerada; depois ele entrou na campanha 226. A correção de descanso não comprova que sua alimentação foi adequadamente reposta durante a retirada, e o abastecimento nessa transição precisa de investigação própria.
- SciSpace foi consultado sobre navegação de agentes até regiões acessíveis. *Time-bounded adaptive A* (2012, [DOI](https://doi.org/10.5555/2343776.2343839)) discute planejamento de caminhos em jogos; não valida o raio de entrada, a política de descanso nem a logística alimentar deste projeto. O traço do jogo e os testes são a evidência da correção.
- Game Studio orientou o playtest e a separação entre simulação e apresentação em fatias anteriores. Consensus seguia sem cota até 01/11/2026.
- O teste controlado e a ausência de mortes humanas na seed 42 não fecham a auditoria de suprimentos em campanha. É necessário investigar a reposição durante a retirada, repetir as demais seeds e verificar acesso antes do aceite da JUL-178.
