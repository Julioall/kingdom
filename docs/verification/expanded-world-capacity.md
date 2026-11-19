# Kingdom | ampliação do mapa e perfil populacional

## Perfis disponíveis

| Perfil | Terreno | População inicial | Uso |
| --- | --- | ---: | --- |
| Navegador, padrão experimental | 160×160 células | 1.000 (500 por reino) | Testar jogo ampliado com carga moderada |
| Navegador, máximo técnico | 160×160 células | 5.000 (2.500 por reino) | `?population=5000`, apenas estresse |
| Comparação/diagnóstico | 160×160 células | 96 | `?population=96`, custos e regressões |

A área passou de 12.544 para 25.600 células (+104,1%). As
dimensões do mapa estão centralizadas em `src/config/ecosystem.js`
e continuam alinhadas aos blocos regionais de oito células.

No navegador, `?population=N` aceita valores pares entre 96 e 5.000.
O Worker valida o limite, e `GameSession` preserva a escolha
quando um mundo é reiniciado. A API `createWorld(seed)` mantém 96
para que os testes existentes não passem a injetar milhares de NPCs;
`createWorld(seed, {initialPopulation:N})` cria todos os habitantes
no próprio dia zero, antes da formação da guarnição.

A interface seleciona IA híbrida, orçamento adaptativo e transporte
compacto para perfis com 1.000 ou mais NPCs. Sob comparação, podem ser
solicitados `?npcBehavior=legacy`, `?cognitiveBudget=128`
ou `?transport=delta`.

## Nascimento, moradia e provisões

O modo ampliado cria casas rurais completas, com capacidade de 20
habitantes por estrutura, em posições próximas ao reino respectivo.
A construção usa madeira e pedra do tesouro inicial e ocupa posições
válidas. A quantidade cobre a população inicial; o teste de estresse
deve confirmar que a atribuição de residência realmente ocorreu.

Um estoque **finito** de até 30 dias de alimento por pessoa é
provisionado na fundação para dar tempo à economia se estabelecer.
Não há geração mágica diária de comida ou moradia.

A distribuição por casas é feita em ordem de IDs. Para grandes mundos,
a busca de locais vazios usa um conjunto temporário de células e a
atribuição de responsáveis por crianças usa uma busca de mínimo, sem
reordenar milhares de residentes para cada bebê. O estado transitório
não é mantido durante a simulação.

## Resultados até esta revisão

Um perfil anterior deste mesmo PR, antes da expansão de moradia,
**conseguiu** criar 5.000 residentes em 160×160 (seed 42),
2.500 por reino, e avançar um dia; na máquina do runner:
- geração: 2,8 segundos;
- um único `stepDay`: **107 segundos**;
- RSS: **aproximadamente 950 MB**;
- moradores com moradia: **208 de 5.000**.

Esse resultado inviabilizou 5 mil como padrão jogável e motivou
as casas adicionais. **Não extrapolar** tais números como previsão de
desempenho após a expansão habitacional, nem como FPS em navegador.

O benchmark histórico do projeto com 5.000 atores também era
apenas um dia autoritativo em mapa 112×112. A validação multidiária
anterior alcançou 1.000 NPCs, mas ainda no mapa antigo. Por isso
1.000 no mapa novo é **padrão experimental**, ainda pendente de
verificação de estabilidade no dispositivo real.

## Testes

```sh
npm run typecheck
npm test
npm run build
node scripts/audit-expanded-world.mjs --population=1000 --seed=42 --days=1
node scripts/audit-expanded-world.mjs --population=5000 --seed=42 --days=1
```

`.github/workflows/expanded-world.yml` mede normalmente 500, 1.000 e
2.000 habitantes de nascimento. O disparo manual cobre 1.000 ou
5.000. Os artefatos guardam duração, uso de memória, ocupação
de moradias e quantidade real por reino.

A mudança de tamanho altera os hashes dos mundos: a comparação
antiga de igualdade de snapshot entre **112×112 e 160×160**
deve falhar. Não desativar determinismo como um todo. A revisão
precisa exigir equivalência de duas execuções da **mesma seed,
dimensão e população** e reavaliar separadamente CPU/GPU/Worker.

## Portas para sair de draft

- Abrir com seed 1, 42 e 2026, sem estruturas, reis ou moradores
  em terreno impróprio.
- Reproduzir criação e primeiro dia em 500/1000/2000 habitantes,
  usando relatórios reais de memória e CPU.
- Repetir 1000 habitantes por 30/90/180 dias, avaliar comida,
  obras, impostos, moradia, agricultura, água e mortalidade.
- Testar navegador headful real, mini mapa, câmera, viewport,
  simulação do Worker e FPS medido.
- Repetir 5.000 somente como carga de estresse e nunca
  afirmar que essa população é sustentável pela evidência de um dia.

Este PR permanece em **draft**, sem merge na main.
