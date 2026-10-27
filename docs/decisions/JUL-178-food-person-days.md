# JUL-178 — Unidades de alimento em pessoa-dias

Data: 27/10/2026

## Decisão

Uma unidade armazenada de comida vegetal representa **um pessoa-dia**: alimento suficiente para uma pessoa por um dia. O consumo diário é 1 para adultos, dependentes e soldados, em paz ou campanha. `foodReserve` passa a ser lido diretamente como dias restantes; por exemplo, 30 significa 30 dias e o teto atual de 100 significa 100 dias.

Carne continua como estoque físico separado. Sua conversão nutricional existente permanece explícita em 2,5 pessoa-dias por unidade de carne. Sementes, ração animal e biomassa em pé continuam em suas próprias unidades. O potencial da roça é uma estimativa de colheita futura; a comida só entra no estoque quando colhida e entregue. O registro de frutos/carne em abrigo continua sendo subregistro/localização do estoque compartilhado, nunca um saldo adicional.

No mercado, quantidade de comida e preço passam a ser lidos em dias de alimento; o preço atual em ouro por unidade permanece, portanto passa a ser ouro por pessoa-dia. O ciclo de sementes, o rendimento físico da roça e o limite de carga não mudam nesta decisão.

## Por que essa escala

No código anterior, 1 unidade de comida adicionava 0,72 ponto à reserva. Adultos gastavam 0,78 ponto/dia (1,083 unidade física/dia), dependentes 0,42 (0,583 unidade/dia) e soldados em paz 0,351 (0,488 unidade/dia). Assim, 1.000 unidades não podiam ser interpretadas diretamente como 1.000 dias de alimentação. Agora, o estoque, a reserva pessoal, os buffers civis e as rações militares compartilham a mesma conta pessoa-dia.

Para 50 pessoas por 180 dias, o alvo passa a ser 9.000 unidades. Um lote de 10.000 unidades integralmente colhido equivale a 200 dias para 50 pessoas, antes das sementes retidas e de qualquer perda logística. O rendimento da roça segue limitado pela quantidade de sementes e pela área plantada; não foi fixado em 10.000.

O baseline repetido de 253 dias, seed 42, no SHA `bf9ad54ab371ec972a15de442955e623ffb9e92c` teve hash de estado `b357ddd9e9b11b31852e54ab24cf9e39ffe5c6d447455260bb70277b6475b28a` nas duas execuções, sem mortes humanas por fome. A demanda diária estimada ao fim era 48,75 e 47,08 unidades para populações de 51 e 49, respectivamente. Com a unidade normalizada, as mesmas populações requerem 51 e 49 pessoa-dias/dia. Isso é um aumento de 2,25 e 1,92 unidades na métrica de demanda usada pelo buffer; o replay após a mudança verificará impacto na produção, reservas e campanhas. Evidência baseline: `docs/verification/JUL-178-food-unit-baseline-253-seed42-20261027.json`.

## Alternativas avaliadas

- **Manter “pontos” e só renomear a interface:** preservaria as fórmulas, mas 1.000 unidades continuariam sem significar 1.000 dias; não atende à escala solicitada.
- **Manter descontos de crianças e soldados:** exigiria exceções para estimar reservas, mercado e rações. A regra comum de 1 pessoa-dia elimina essas conversões sem dar comida gratuita; cada pessoa continua podendo ficar sem acesso e morrer de fome.
- **Alterar o valor nutricional da carne:** rejeitado nesta fatia. A conversão 2,5 já existe e pode permanecer como fator separado e visível.

## Pesquisa e orientação de jogo

- O SciSpace localizou Giedelmann-L, Guerrero e Solano-Charris, *System dynamics approach for food inventory policy assessment in a humanitarian supply chain* (2022), [DOI 10.1016/j.ijdrr.2022.103286](https://doi.org/10.1016/j.ijdrr.2022.103286). O estudo compara políticas centralizadas e descentralizadas de estoque, considerando falta, excesso e distribuição de perecíveis. Ele apoia acompanhar estoque e acesso por localização; não prescreve pessoa-dia como unidade de gameplay.
- O Consensus foi consultado, mas recusou nova busca porque o limite mensal de 30 consultas só reinicia em 1/11/2026. Essa indisponibilidade não bloqueia a mudança; a decisão se apoia na aritmética do código e nos replays determinísticos do projeto.
- O Game Studio está disponível nesta sessão como skill de fluxo, sem uma ferramenta de design separada. A revisão de interface seguirá `game-playtest`: conferir o jogo no navegador, rótulos do HUD/inspeção e captura de tela.

## Validação

O teste direcionado de 67 casos passou após normalizar consumo, ajuda social, roça, mercado, abrigo, carne, guarnição e campanhas. O build passou. A suíte completa encontrou duas expectativas antigas; ambas foram atualizadas para a semântica nova: escolha de uma coleta próxima que já supre um dia e quantidade de ajuda em pessoa-dias.

Pendente: repetir suíte completa, executar matriz de replays/repetição, inspecionar a interface no navegador e registrar SHA/resultados finais nesta decisão e na JUL-178. Não há salvamento persistente do mundo para migrar; as únicas referências a `localStorage` neste checkout são preferências de IA e áudio.
