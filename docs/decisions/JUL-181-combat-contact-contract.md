# JUL-181 — contrato entre geometria de combate e apresentação

Data: 26/10/2026  
Branch de trabalho: `codex/jul195-integration`

## Decisão

O `AttackAction` permanece a fonte única de verdade para contato. A animação e os efeitos consomem o evento imutável do Worker e mostram o ponto e o instante confirmados pela simulação. Um alvo só recebe dano depois de uma interseção varrida comprovada; erro de alcance, desvio, alvo destruído e obstrução não chamam a função de dano.

Armas de chão e flechas baixas consultam o terreno e os hitboxes físicos já usados pelo mundo. Água e rocha bloqueiam o trajeto no plano de combate; árvores, minerais e estruturas usam seus volumes de colisão existentes. Um disparo elevado pode cruzar obstáculo baixo quando sua elevação de trajetória excede 0,65 unidade. Uma estrutura que é o alvo designado não obstrui seu próprio contato. Ataque de espada continua usando arco varrido; lança usa segmento finito e arco usa trajetória com primeiro impacto.

Cada ação expõe `geometry` e `timing` (`windupStartMs`, `releaseMs`, `activeEndMs`, `contactMs`, `recoveryStartMs`, `completionMs`). O resultado registra hitbox do alvo, posição e ponto real de contato ou a obstrução. A apresentação de depuração é opt-in com `?combatDebug=1`: desenha volume/arco, trajetória até a mira, hitbox e impacto, sem alterar RNG nem regras.

## Alternativas consideradas

1. **Manter somente a distância e o contato varrido atual:** a geometria não consultava obstáculos; ataques podiam confirmar dano do outro lado de rocha.
2. **Usar caixas visuais de sprites como colisão:** misturaria a arte ao contrato de simulação e causaria discrepâncias entre renderização e Worker.
3. **Criar um raycaster balístico/physics engine novo:** ampliaria custo e duplicaria colisão já usada pelo movimento.
4. **Escolhida:** testar o segmento ou o ponto de contato contra volumes físicos existentes e terreno, preservando o modelo determinístico e oferecendo diagnóstico visual opcional.

## Fontes e limitações

- JUL-181 define contato por trajetória, alvo móvel, torre, obstáculo e sincronização do evento.
- SciSpace encontrou Normoyle, A.; Jörg, S. (2014), *Trade-offs between responsiveness and naturalness for player characters*, DOI [10.1145/2668064.2668087](https://doi.org/10.1145/2668064.2668087). O estudo informa o cuidado em sincronizar resposta e movimento apresentado; não determina hitbox de Kingdom nem calibra tempos numéricos.
- SciSpace encontrou Eg, R.; Raaen, K.; Claypool, M. (2018), *Playing with Delay: With Poor Timing Comes Poor Performance, and Experience Follows Suit*, DOI [10.1109/QOMEX.2018.8463382](https://doi.org/10.1109/QOMEX.2018.8463382). A relação observada entre atraso de interação, desempenho e experiência serve como justificativa para usar o instante de contato da simulação também no feedback visual, não como validação do balanceamento.
- Consensus esgotou as 30 buscas do mês e informou reset em 1/11/2026.
- `get_agent_context` e `record_agent_learning` continuam indisponíveis no servidor Linear (`Tool ... not found`); a decisão e as fontes ficam versionadas aqui e na issue.
- O `game-playtest` do Game Studio foi aplicado para validar boot, controles e apresentação real no navegador. O overlay de depuração não cria biomas nem mecânica ecológica sazonal.
