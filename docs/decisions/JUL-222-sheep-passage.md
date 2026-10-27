# JUL-222 — passagem do condutor de ovelha

Data: 27/10/2026  
Estado: implementação commitada; a issue só será fechada após CI remoto no SHA integrado.  
Issue: [Bug — soldado fica bloqueado por peão conduzindo ovelha](https://linear.app/julio-alves/issue/JUL-222/bug-soldado-fica-bloqueado-por-peao-conduzindo-ovelha)

## Reprodução registrada

A captura enviada pelo jogador mostra o estado “rota de campanha bloqueada” no dia 79, mas não contém seed nem SHA. Para obter uma reprodução repetível, foi montado um corredor de uma célula com uma baia lateral e a mesma combinação de unidades no estado de condução:

| Campo | Reprodução controlada antes da correção |
| --- | --- |
| Seed / dia | `222` / dia `5` |
| SHA do código | `6ff605b4d9862e78963eb4c6d06b889e0a236b4c` |
| Soldado | id `99001`, `(32, 40)`, destino `(38, 40)` |
| Peão condutor | id `99002`, `(33, 40)`, destino `(39, 40)`, atribuição `lead_sheep` ativa |
| Ovelha | id `99003`, `(33.25, 40.15)`, conduzida pelo peão |
| Geometria | corredor `x=29..40, y=40`; baia de passagem em `x=33..39, y=39` |

Antes da correção, o primeiro passo do soldado retornava `false`: o condutor não podia ceder porque a atribuição ativa e `lead_sheep` estavam ambos na lista de ações ocupadas. No sentido oposto, o soldado de campanha não cedia a passagem a um civil com ovelha; e, quando o condutor mudava de tile por um handoff, a posição da ovelha só era sincronizada no próximo ciclo de ação.

## Comportamento escolhido

- Um condutor com uma ovelha válida pode ceder temporariamente enquanto executa `lead_sheep`. O handoff preserva a atribuição e move a ovelha no mesmo passo do condutor.
- Um soldado pode ceder a um condutor amigável no próprio território quando não está montado em torre, não atacou recentemente, tem pelo menos 28 de vida e 12 de energia. Isso preserva a segurança de unidades em combate e o território de patrulha; o `campaignId` não é descartado.
- Unidades continuam usando tiles caminháveis, hitboxes e a lógica existente de portões. A passagem não teleporta unidades e não cancela nem cobra novamente trabalho.

## Alternativas consideradas

| Alternativa | Decisão | Justificativa |
| --- | --- | --- |
| Permitir que qualquer civil empurre qualquer soldado | Rejeitada | Tiraria unidades de combate de posição sem relação com a passagem. A exceção fica limitada ao condutor conhecido de ovelha, no mesmo reino e em território amigável, sem ataque recente. |
| Cancelar a condução ou a marcha para destravar a rota | Rejeitada | Perderia a tarefa original e poderia soltar a ovelha ou interromper a campanha. O handoff é lateral e temporário. |
| Mover a ovelha uma tile depois, no próximo ciclo da simulação | Rejeitada | Deixaria o par espacialmente inconsistente durante o cruzamento e poderia produzir sobreposição com quem acabou de passar. |

## Implementação e validação

`src/simulation/individuals/movement.js` reconhece o par condutor/ovelha, permite o handoff seguro nos dois sentidos e atualiza a posição da ovelha após cada passo real do condutor. `tests/movement-passage.test.mjs` cobre:

1. soldado que vem atrás, passa pelo condutor e deixa o condutor retomar a entrega;
2. condutor que encontra um soldado de campanha, passa, e o soldado retoma a campanha;
3. saída pelo portão do curral e desvio quando a rota externa tem um tile bloqueado;
4. smoke de 125 dias sem recursão infinita.

Nos dois casos compartilhados, os testes verificam limites de deslocamento por passo, ausência de sobreposição entre hitboxes do soldado, peão e ovelha, ausência de oscilação, preservação das tarefas e chegada ao destino.

O playtest em navegador importa os módulos reais de movimento e colisão do projeto. Os três cenários passaram em `6`, `10` e `7` passos. A captura completa está em [reports/JUL-222-passage-playtest-20261027.png](../../reports/JUL-222-passage-playtest-20261027.png) e também será anexada à issue.

Commit de implementação: `0abec55` (`fix(JUL-222): yield passage to shepherds`). Validação local na revisão: `node --test tests/movement-passage.test.mjs` passou (`4/4`); `npm test` passou (`233/233`); `npm run build` passou com typecheck e produção Vite. O status do CI remoto será registrado depois que este commit for integrado à branch da PR.

## Limites

A reprodução exata do save do dia 79 segue impossível sem a seed original. O cenário controlado isola e reproduz a condição de bloqueio no SHA identificado acima. O playtest não substitui o save do jogador nem valida campanhas em combate ativo; o handoff militar é deliberadamente desabilitado quando o soldado atacou recentemente ou saiu de seu próprio território.
