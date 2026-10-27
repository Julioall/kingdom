# JUL-178 — capacidade de carga antes da caça

Data: 27/10/2026

## Achado e decisão

Uma pessoa com 0,01 unidade de carne ainda podia tentar caçar. Se a ovelha rendesse o limite de 28, a função acrescentava 27,99 à carga e só depois verificava se todo o lote cabia. A ação retornava falha e mantinha a ovelha viva, deixando 28 unidades carregadas sem abate. O teste reproduziu a diferença de 0,01 para 28 na branch de testes antes da correção.

A caça agora calcula o rendimento e valida o espaço disponível antes de gastar recursos na tentativa ou alterar a carga. Se o lote inteiro não cabe, o peão mantém a carga e a presa viva; se cabe, a captura continua com as regras existentes. Isso preserva a relação entre o abate e a carne produzida. A regra não altera crescimento de ovelhas nem alimentação do rebanho.

Uma segunda regressão mostrou que uma fração de 0,01 não era entregue porque a seleção de destino e a operação de entrega usavam um limiar de 0,01. A entrega de carne agora aceita qualquer quantidade positiva e registra a mesma quantidade no estoque comunitário e no subregistro do abrigo. Assim, o trabalhador pode liberar espaço para uma captura futura sem descartar a fração.

Considerou-se aceitar uma captura parcial e descartar o excedente, mas isso exigiria registrar explicitamente a perda e mudaria a recompensa da caça. A verificação prévia preserva o lote sem criar perda silenciosa e permite entregar a carga existente antes de tentar novamente.

## Evidência e fontes

- `tests/livestock-food.test.mjs`: o cenário com carga 0,01 e ovelha de 67 kg falhou no código anterior e passou após a correção; um segundo cenário confirma que o lote completo de 28 é recebido e a ovelha é abatida quando há espaço. Um terceiro reproduziu a fração presa e verifica sua entrega integral. A suíte focada passou 10/10.
- `npm test`: 262/262; `npm run build` (typecheck e build de produção) e `git diff --check` passaram na versão da alteração.
- SciSpace foi consultado sobre atomicidade e invariantes em inventários limitados. Zhang e Kemme, *Transaction Models for Massively Multiplayer Online Games* (2011, [DOI](https://doi.org/10.1109/SRDS.2011.13)), discutem níveis de atomicidade e consistência para ações de jogos distribuídos. O trabalho informa a escolha de preservar a transação; não demonstra o comportamento deste jogo nem define sua capacidade de carga.
- Game Studio já foi consultado para as fatias de simulação e playtest do projeto; esta correção não muda a apresentação visual. Consensus permaneceu sem cota até o reset informado em 01/11/2026. A correção se baseia na reprodução e no teste de conservação local.

## Limites

Este teste cobre a captura e sua carga, não reconcilia todos os inventários diários nem demonstra a matriz de replays requerida por JUL-178. A issue continua aberta até comprovar esses critérios.
