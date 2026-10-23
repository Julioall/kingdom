# Plano de implementação

Este documento descreve a base que já existe e organiza as próximas correções. Recursos futuros não devem ser considerados prontos só porque aparecem em uma tela ou existem como dados iniciais.

## Base ativa

- `index.html` inicia a aplicação por `src/app/bootstrap.ts`; Vite serve o jogo por HTTP e empacota o worker local da IA.
- `src/ui/game.js` apresenta o jogo em Canvas 2D e consulta a simulação pela interface de `src/simulation/`.
- O cenário padrão tem mapa de 96 × 96 células e dois reinos, cada um com governante, moradores, estruturas, quatro torres e dois soldados.
- `src/simulation/engine.js` mantém os módulos existentes agrupados para os consumidores atuais.
- `src/simulation/systems.js` controla a ordem do dia em quatro fases: ambiente, sociedade, recursos e mercado, fechamento do dia.
- `src/simulation/kingdoms/` controla território, construções, recrutamento e patrulhas. Castelos e torres determinam a influência territorial.
- A IA WebLLM é opcional e executada em worker. As pessoas usam as redes neurais individuais já existentes quando a IA compartilhada não está ativa.

## Responsabilidades do avanço diário

`stepDay(world)` é o coordenador do dia, não o lugar onde ficam as regras detalhadas:

1. `updateEnvironment`: atualiza clima, desgaste das estradas, solo e água, plantas e animais; recalcula território para as decisões daquele dia.
2. `updateSociety`: atualiza as pessoas, incluindo suas necessidades, movimentos e ações.
3. `updateResourcesAndMarkets`: atualiza troncos soltos, decomposição e preços de mercado no ciclo mensal.
4. `advanceCalendar` e `resolveEndOfDayConsequences`: atualiza a data, refaz o território após ações e construções, resolve incursões e registra o relatório periódico.

`tick(world, days)` repete esse mesmo avanço diário. O relógio de apresentação e a interpolação visual ficam na aplicação e não mudam o calendário da simulação.

## Trabalho pendente

1. Corrigir falhas demonstradas no cenário atual de dois reinos antes de ampliar o mapa ou a população.
2. Tornar mais consistente a interface entre a UI e os comandos da simulação, evitando alterações diretas de regras e estoques pela tela.
3. Conectar produção, consumo, mercado, comércio e impostos às operações centrais de inventário.
4. Integrar decisões de governantes com observações limitadas, política determinística de contingência e validação de respostas atrasadas.
5. Implementar e validar ordens, missões, defesa e consequências políticas antes de expandir a escala.
6. Acrescentar persistência versionada e restauração do estado completo.
7. Depois da validação, avaliar a expansão para quatro reinos e medir desempenho no mapa maior.

## Verificação local

Comandos disponíveis no projeto:

```powershell
npm run build
npm run dev
```

O build verifica a resolução dos módulos e a compilação do worker. Os testes de simulação existentes podem ser executados separadamente com `npm test`; esta refatoração não altera as regras e não substitui a validação de comportamento no navegador.
