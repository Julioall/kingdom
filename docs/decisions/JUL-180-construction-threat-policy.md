# JUL-180 — resposta local a ameaças em obras

Data: 26/10/2026<br>
Branch de trabalho: `codex/jul195-integration`

## Decisão

Interromper o trabalho quando uma ameaça de combate observável alcança o raio de cerco e mover o trabalhador por uma rota alcançável que respeita terreno, estruturas, ocupantes, fronteiras e uma margem de segurança em relação ao inimigo. Uma flecha ativa apontada ao trabalhador prioriza abrigo sob a copa já existente. A evacuação libera imediatamente o slot físico; o ID do trabalhador, a reserva já paga e o progresso continuam ligados ao mesmo projeto para recuperação.

A política individual compara risco local, oportunidade de progresso e valores aprendidos de `build` e `migrate`. Ela escolhe `flee`, `seek-cover`, `wait` ou `retry-build`; registra a decisão e atualiza um valor por ação após observar separação, dano e progresso. O retorno exige duas observações diárias sem ameaça. Uma rota bloqueada por quatro dias libera o slot e permite substituição; a equipe não cancela nem cobra novamente a obra.

Na revisão do diff da branch para PR, limitei a busca da rota de evasão às 32 melhores posições seguras por decisão: o mapa pode oferecer milhares de destinos, e tentar todos quando a região está desconectada multiplica buscas de caminho sem limite útil. Os incidentes da obra continuam limitados aos 40 mais recentes também quando o trabalhador abandona uma obra capturada, destruída ou concluída.

## Alternativas consideradas

1. **Só pausar a obra durante o cerco.** Preserva progresso, mas deixa o trabalhador exposto; os testes antigos de JUL-180 demonstravam justamente essa lacuna.
2. **Cancelar a designação da pessoa e redistribuir imediatamente.** Facilita a escalação, mas elimina o vínculo necessário para que o trabalhador retorne à mesma obra após a histerese.
3. **Adicionar um planejador global de fuga e uma nova cabeça neural.** Aumentaria o escopo de navegação/treinamento para responder a um estado que já pode usar a navegação física e a preferência existente entre `build` e `migrate`.
4. **Escolha aplicada:** uma política local pequena, baseada em ameaças conhecidas, na movimentação já usada pelo jogo e em evidência explícita de decisão/resultado. O teste cobre rochas, bloqueio de rota, retomada, troca de trabalhador e destruição da obra.

## Fontes consultadas e limites

- JUL-180, critérios de fuga, proteção, retomada, reserva e evidência de política: [issue](https://linear.app/julio-alves/issue/JUL-180/m61-construcao-resiliente-fuga-replanejamento-e-retomada).
- JUL-179, auditoria pós-merge usada para escolher esta sequência: [issue](https://linear.app/julio-alves/issue/JUL-179/m60-auditar-beta-pos-merge-e-mapear-lacunas-reais-do-gameplay).
- Game Studio `game-playtest`: fluxo especializado de playtest em navegador para validar estado visual e capturas do jogo.
- SciSpace retornou Zhou, Ying; Zhang, Zi-min; Cui, Jian (2017), *EvacAgent: A Building Emergency Evacuation Simulation Model Based on Agent*, DOI [10.1145/3080845.3080872](https://doi.org/10.1145/3080845.3080872). O resumo descreve seleção de rota baseada no conhecimento individual do ambiente, em vez de acesso a um ótimo global; usamos isso como referência de desenho para preservar observabilidade local, não como validação do comportamento de Kingdom.
- SciSpace também encontrou a dissertação de M. Ahmed Rusho (2023), *Agent-Based Modeling of Near Miss Incidents by Integrating Construction Site Dynamics with Enriched Worker Behavior*, DOI [10.25148/etd.fidc010265](https://doi.org/10.25148/etd.fidc010265). É contexto de modelagem de obras, não evidência empírica transferível ao jogo.
- Consensus estava sem cota de buscas (30/30; reset anunciado para 1/11/2026). O resultado e a indisponibilidade estão registrados na atualização da issue. O servidor da Linear retornou `Tool get_agent_context not found` mesmo com o argumento `task` exigido pelo esquema, então a anotação compartilhada não pôde ser consultada.
- Também não foi possível gravar a descoberta do fixture no contexto compartilhado: `record_agent_learning` retornou `Tool record_agent_learning not found`. A observação verificada está preservada aqui: `cellAt` usa `WIDTH`/`HEIGHT` globais de `ecosystem.js`, portanto o fixture usa o grid configurado completo; confirmado pela implementação e pelos testes focados.

## Limites desta fatia

A política observa soldados rivais em campanha, alvos de combate e ações de flecha ainda ativas. Ela não estima ameaça futura de campanhas fora do alcance local, não introduz uma simulação balística adicional e não altera as regras de combate. O abrigo usa copa vegetal existente e rota real; não cria estação, bioma nem mecânica ecológica sazonal.

## Verificação e limites observados

- O replay final do código desta fatia foi aberto em `http://127.0.0.1:5174/?seed=42&paused=1`, chegou ao dia 295 e manteve a crônica legível, o mapa visível e os controles de simulação acessíveis. Os postos de fronteira foram concluídos nos dias 67 e 77; a crônica também registrou campanha e perda por invasão no dia 259.
- Não houve mensagem de retirada no replay limpo final. Um replay interativo anterior mostrou retirada nos dias 64 e 68, mas precedeu a correção final que remove o evacuado da escala ativa. Essa captura não é evidência do SHA final. Fuga, slot liberado, substituição, histerese, retorno, custo e progresso são exercitados pelos 11 testes focados no código final.
- Não anexei screenshot ao Linear: a aba do Linear no navegador abriu uma tela “Create a workspace”, e o navegador recusou a URL `data:` usada para persistir a captura. A tela final foi inspecionada visualmente na sessão e a crônica observada foi transcrita no relatório de verificação. Não usei outra rota para contornar a recusa.
- `node --test tests/construction-threat-audit.test.mjs`: 11/11 aprovados após a revisão (incluindo retenção de 40 incidentes). `npm test`: 165/165 e `npm run build`: typecheck, Vite e conversão lossless passaram no SHA anterior à revisão; repetir no SHA final da branch antes da PR.

Essas evidências demonstram a regra local e a continuidade normal de construções em runtime. A ausência de retirada no replay final limita a observação visual específica da transição de fuga; não é apresentada como ocorrência visual reproduzida no SHA final.
