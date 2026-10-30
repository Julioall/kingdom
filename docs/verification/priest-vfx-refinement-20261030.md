# Refinamento de conjuração e VFX — 30/10/2026

Atualiza a implementação inicial descrita em `priest-tactical-magic-20261030.md`, após os ajustes visuais e de ritmo solicitados no jogo.

- Magias de área fixam o centro no chão ao começar. A posição e a elegibilidade dos ocupantes são consultadas na ativação; o alvo original pode sair ou morrer sem arrastar/cancelar a área. Buffs individuais aplicados continuam acompanhando seus portadores.
- Preparo: `max(1200 ms, tempo inicial × 1,8)`. Cura Simples 1,2 s; Cura em Área 1,53 s; Grande Cura 3,96 s; Santuário 2,7 s. Recarga individual conta a partir do fim do preparo; recuperação compartilhada de 1,5 s evita alternância contínua entre magias.
- Sacerdotes usam a animação `heal` em loop durante a conjuração, retornando a `idle` na conclusão. O sprite antigo `heal-effect` foi removido da apresentação, sem remover a animação do personagem.
- Círculos aparecem no preparo, intensificam brilho/pulsação e produzem um clarão local de até 650 ms. Depois, nenhum círculo permanece. Partículas de efeitos e Santuário persistem até sua própria expiração; a área permanece funcional sem seu círculo.
- Os perfis explícitos em `spell-styles.js` adaptam as famílias Arcano, Rúnico, Invocação e Debuff do laboratório fornecido, incluindo suas runas angulares e símbolos centrais. Há 16 combinações de geometria, contagem de anéis e glifos, sem escolha aleatória. Cores e rotações também diferem.
- A seleção usa o módulo nos pés e antes do sprite. Marcadores de conflito dos NPCs foram removidos apenas do desenho; a lógica de alvos permanece. Hover normal é ciano; vermelho aparece apenas no hover de mira do jogador durante controle manual.
- Partículas mantêm o tamanho reduzido das iterações anteriores. O último ajuste aumenta a grade de detalhe de 16 para 24 amostras por unidade e os níveis de transparência de 32 para 48, preservando o tamanho. Quantidade desejada: 21 → 32 em círculos, 11 → 17 em personagens/zonas; orçamento global 1.200 → 1.800, dividido entre emissores visíveis.
- Selos são rasterizados a 8× e reutilizados em cache limitado a 64 imagens/16 milhões de pixels. A filtragem na redução preserva as linhas finas, sem aplicar blur ao mapa ou aos sprites.

## Validação

57 testes focados passaram (magias, apresentação, integração com armas e controles), mais TypeScript. Incluem área fixa, animação na preparação/finalização, expiração sem círculo, partículas persistentes, 16 perfis distintos e orçamento de emissão. A suíte completa de 519 testes registrada no relatório inicial é uma medição anterior; não foi repetida para cada ajuste visual.

`node scripts/verify-magic-styles-browser.mjs` gera uma galeria nativa dos 16 selos, com os quatro estilos, sem erros de página. Captura e perfis: `browser-ui-evidence/magic/spell-styles.png` e `spell-styles.json`.

`node scripts/verify-magic-browser.mjs --visual-only` executou a batalha com 100 soldados e Worker real, sem erros de página. Nesta execução: aproximadamente 36,2 renderizações/s e p95 do mapa 37,7 ms; medição local, sem garantia de FPS. Resultado em `visual-report.json`, captura em `vfx-detail.png`. O modo visual valida esta alteração de renderização; não declara que o trecho posterior de controle manual do teste completo foi revalidado. O teste completo passou na entrega inicial; tentativas intermediárias após os ajustes de tempo encontraram timeout ao iniciar manualmente a Grande Cura.

As capturas da galeria foram inspecionadas para confirmar símbolos, cores, traços e diferenças de anéis. As capturas de batalha foram inspecionadas para conferir posicionamento no chão e ausência das antigas marcações automáticas de conflito.
