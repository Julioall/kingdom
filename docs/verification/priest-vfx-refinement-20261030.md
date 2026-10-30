# Refinamento de conjuração e VFX — 30/10/2026

Atualiza a implementação inicial descrita em `priest-tactical-magic-20261030.md`, após os ajustes visuais e de ritmo solicitados no jogo.

- Magias de área fixam o centro no chão ao começar. A posição e a elegibilidade dos ocupantes são consultadas na ativação; o alvo original pode sair ou morrer sem arrastar/cancelar a área. Buffs individuais aplicados continuam acompanhando seus portadores.
- Preparo e custo são explícitos por magia, conforme a tabela atualizada abaixo. Recarga individual conta a partir do fim do preparo; recuperação compartilhada de 1,5 s evita alternância contínua entre magias. A recuperação de mana permanece em 10 por dia (30 em repouso), mas fica suspensa durante a conjuração; o limite continua em 200.
- Sacerdotes abrem a animação `heal` uma vez e repetem somente os quadros 4–7 durante a preparação. Na ativação, liberam os quadros 8–11 e retornam ao estado normal. O trecho usa o relógio da magia, sem reiniciar a cada dia; interrupção não reproduz a finalização. O sprite antigo `heal-effect` foi removido da apresentação, sem remover a animação do personagem.
- Círculos aparecem no preparo, intensificam brilho/pulsação e produzem um clarão local de até 650 ms. Depois, nenhum círculo permanece. Partículas de efeitos e Santuário persistem até sua própria expiração; a área permanece funcional sem seu círculo.
- Toda ativação, inclusive de área, emite partículas em cada destinatário vivo registrado no evento, sem círculos individuais. Buffs/debuffs mantêm suas auras pelo efeito. O Santuário também mantém partículas em seus ocupantes aliados atuais; sair da zona remove a aura. O selo e o clarão de área continuam presos ao ponto do chão.
- Os perfis explícitos em `spell-styles.js` adaptam as famílias Arcano, Rúnico, Invocação e Debuff do laboratório fornecido, incluindo suas runas angulares e símbolos centrais. Há 16 combinações de geometria, contagem de anéis e glifos, sem escolha aleatória. Cores e rotações também diferem.
- A seleção usa o módulo nos pés e antes do sprite. Marcadores de conflito dos NPCs foram removidos apenas do desenho; a lógica de alvos permanece. Hover normal é ciano; vermelho aparece apenas no hover de mira do jogador durante controle manual.
- Partículas mantêm o tamanho reduzido das iterações anteriores. O último ajuste aumenta a grade de detalhe de 16 para 24 amostras por unidade e os níveis de transparência de 32 para 48, preservando o tamanho. Quantidade desejada: 21 → 32 em círculos, 11 → 17 em personagens/zonas; orçamento global 1.200 → 1.800, dividido entre emissores visíveis.
- Selos são rasterizados a 8× e reutilizados em cache limitado a 64 imagens/16 milhões de pixels. A filtragem na redução preserva as linhas finas, sem aplicar blur ao mapa ou aos sprites.
- O limite de instâncias visuais passa a 512 para acomodar a ativação em 100 destinatários junto de três status por unidade e auras territoriais. O orçamento de partículas permanece em 2.700, compartilhado entre os efeitos visíveis. Testes confirmam que todos os 100 alvos recebem partículas e que selos não acompanham os personagens.

### Ajuste posterior: chamas e turbulência

A pedido do usuário, círculos e personagens passaram a emitir partículas ascendentes em modo `flame`, com turbulência 1,1 e duas ondas sobrepostas. A dispersão converge gradualmente no alto; cada partícula diminui e desaparece ao subir. O tamanho-base reduzido foi preservado. Quantidade desejada: 48 por círculo e 26 por personagem/zona; orçamento global 2.700. Glifos de partículas são reutilizados em cache de até 256 imagens, com transparência aplicada no desenho.

Os dez testes de apresentação e o TypeScript passaram. Nova execução visual com 100 soldados não apresentou erros de página, mas mediu aproximadamente 24 renderizações/s e p95 do mapa de 51,5 ms. O aumento de densidade não é anunciado como melhoria de desempenho; o cenário de batalha continua pesado nesta máquina. Dados atuais em `visual-report.json`.

## Ajuste de mana e preparo

| Magia | Mana | Preparo |
|---|---:|---:|
| Cura Simples | 24 | 2 s |
| Cura em Área | 48 | 3,6 s |
| Grande Cura | 100 | 6 s |
| Regeneração | 32 | 2,8 s |
| Fortitude | 40 | 3,1 s |
| Velocidade | 38 | 2,6 s |
| Armas Abençoadas | 52 | 4,2 s |
| Proteção Mágica | 46 | 3,8 s |
| Fraqueza | 36 | 3,3 s |
| Lentidão | 34 | 2,4 s |
| Exaustão | 44 | 3,5 s |
| Maldição | 62 | 4,8 s |
| Veneno | 42 | 3,4 s |
| Purificação | 36 | 2,2 s |
| Dissipação | 50 | 4 s |
| Santuário | 80 | 5,2 s |

Os 16 tempos são distintos. O inspetor mostra preparo e custo. Testes verificam pagamento único, ausência de efeito antes da conclusão e suspensão/retomada da recuperação de mana. Foram aprovados 53 testes focados em magias, armas, controles e recursos, além de TypeScript.

Uma passagem de nove cenários de 100 soldados (seeds 42/7/99; 30 s; com/sem sacerdotes) foi registrada em `balance-mana-preparation.json`. Nas composições com oito sacerdotes, ocorreram 36–41 conjurações por cenário, com 1.768–2.248 mana gasta e 3.474–4.947 HP curados. Não se trata de garantia de equilíbrio em campanhas longas. QA visual com 100 soldados passou sem erros de página; os valores locais de renderização continuam sem garantia de FPS universal.

## Validação

57 testes focados passaram (magias, apresentação, integração com armas e controles), mais TypeScript. Incluem área fixa, animação na preparação/finalização, expiração sem círculo, partículas persistentes, 16 perfis distintos e orçamento de emissão. A suíte completa de 519 testes registrada no relatório inicial é uma medição anterior; não foi repetida para cada ajuste visual.

`node scripts/verify-magic-styles-browser.mjs` gera uma galeria nativa dos 16 selos, com os quatro estilos, sem erros de página. Captura e perfis: `browser-ui-evidence/magic/spell-styles.png` e `spell-styles.json`.

`node scripts/verify-magic-browser.mjs --visual-only` executou a batalha com 100 soldados e Worker real, sem erros de página. Nesta execução: aproximadamente 36,2 renderizações/s e p95 do mapa 37,7 ms; medição local, sem garantia de FPS. Resultado em `visual-report.json`, captura em `vfx-detail.png`. O modo visual valida esta alteração de renderização; não declara que o trecho posterior de controle manual do teste completo foi revalidado. O teste completo passou na entrega inicial; tentativas intermediárias após os ajustes de tempo encontraram timeout ao iniciar manualmente a Grande Cura.

As capturas da galeria foram inspecionadas para confirmar símbolos, cores, traços e diferenças de anéis. As capturas de batalha foram inspecionadas para conferir posicionamento no chão e ausência das antigas marcações automáticas de conflito.
