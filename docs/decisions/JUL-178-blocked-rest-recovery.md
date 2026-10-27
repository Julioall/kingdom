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
- SciSpace foi consultado sobre navegação de agentes até regiões acessíveis. *Time-bounded adaptive A* (2012, [DOI](https://doi.org/10.5555/2343776.2343839)) discute planejamento de caminhos em jogos; não valida o raio de entrada, a política de descanso nem a logística alimentar deste projeto. O traço do jogo e os testes são a evidência da correção.
- Game Studio orientou o playtest e a separação entre simulação e apresentação em fatias anteriores. Consensus seguia sem cota até 01/11/2026.
- O teste controlado não demonstra sozinho a sobrevivência na seed 42, nem fecha a auditoria de suprimentos em campanha. Replays e análise da morte são necessários antes de afirmar o efeito no mundo integrado.
