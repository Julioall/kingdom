# Verificação militar: coluna adaptativa em gargalos

## Problema observado no código

O planejador tático separava unidades em profundidade diante de uma frente estreita,
mas a geometria **interna** de `squadSlot` continuava com três arquivos para cada
grupo de dez soldados. Isso projetava soldados para fora de pontes e portões de
uma célula, mesmo quando o objetivo de campanha era acessível.

Outro problema: o ritmo do comandante considerava qualquer subordinado a mais
de 6,5 células como atrasado. Numa coluna correta de nove seguidores em arquivo
único, os últimos postos são naturalmente mais distantes.

## Entrega inicial

- O terreno local do comandante é avaliado a cada planejamento de campanha,
  independentemente da largura da frente de batalha final.
- Em gargalo, a formação passa para `column` com **um arquivo** de seguidores.
- Fora do gargalo, a coluna volta a três arquivos.
- O comandante não pausa apenas porque a fileira ordenada é longa: sua guarda
  de ritmo considera o erro do posto esperado nos gargalos.
- Sem teleporte, novas rotas paralelas, bônus de dano ou mudança na autoridade
  do Worker. A detecção local reutiliza o diagnóstico de abertura de terreno
  que já existia no sistema de campanhas.

## Testes automatizados

```sh
node --test tests/battlefield-choreography.test.mjs
node --test tests/squad-tactics.test.mjs tests/movement-passage.test.mjs
npm test
npm run typecheck
npm run build
```

Os testes de coreografia verificam arquivo único em estreitamento local,
identidade/ordem dos postos, ausência de falso disperso em formação longa,
retorno a três arquivos em terreno aberto e estreitamento do objetivo final.

## QA no navegador ainda necessário

1. Simular passagem de uma tropa de dez soldados por uma ponte de uma célula.
   Com `?battleDebug=1`, registrar capturas antes, durante e depois.
2. Confirmar que nenhum membro atravessa água, pedra, cerca, árvore ou outro
   soldado, e que o grupo se abre novamente após a saída.
3. Repetir com duas unidades em sentidos opostos, portão fortificado,
   retirada sob pressão e morte do comandante.
4. Medir tempo de travessia, movimentos bloqueados, coesão real, perdas de
   membros, oscilações, CPU do Worker e determinismo por seed.
5. Reproduzir separadamente o congestionamento da issue #54 (seed 42). Esta
   correção de largura dos postos **não** prova resolução de impasses de
   prioridade entre atores ou de passagem em corredor ocupado.

## Próxima etapa

Ajustar a política de **negociação de passagem entre unidades completas**,
incluindo travessia em sentidos contrários, prioridade de retirada/urgência,
espera em área segura e liberação ordenada dos postos. Exigir testes reais
de 30/90/180 dias e batalhas com 100/500/5000 NPCs, sem alegar FPS não medido.
