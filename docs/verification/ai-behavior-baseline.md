# Kingdom — baseline observável de decisões e comportamento

A avaliação das IAs precisa separar **decisão válida**, **consequência estratégica** e **custo de simulação**. Nenhum dos três é substituto automático dos demais. Um rei pode aprovar uma ordem válida que resulte numa derrota por falta de mantimentos.

## Executar

```bash
npm run bench:ai -- --days=45 --seeds=1,42,2026 --interval=5 --output=out/ai-behavior.json
npm run bench:ai -- --days=90 --seeds=7,31,1234 --interval=10 --output=out/ai-heldout.json
```

O script cria mundos da mesma seed usando o motor autoritativo sem renderização, avança os dias sem snapshots de tela e registra:
- Estratégia e mudanças diárias de objetivo de cada reino.
- Moradores vivos, civis, soldados e soldados feridos.
- Recursos **do tesouro**, distinguidos da produção privada, estoque comunitário e mercados.
- Satisfação, prestígio, coesão comunitária, campanhas e guerras.
- Solicitações, propostas, aprovações, rejeições e fallbacks do adaptador opcional de decisões de rei/general.

A contagem de mudanças de objetivo é diária, inclusive entre checkpoints. O histórico detalhado é amostrado a cada `--interval` dias para diminuir o JSON.

## Cuidado com a interpretação

- As IAs determinísticas são as políticas padrão. Eventos do adaptador de decisões `strategicAI` podem estar ausentes porque o adaptador está desabilitado, **não** porque o rei deixou de pensar ou agir.
- Os arrays de eventos do adaptador retêm no máximo 120 registros. `acceptedRate` é apenas a taxa **dentre desfechos retidos e conhecidos**. Não deve ser apresentada como taxa histórica de qualidade ou sucesso militar.
- Os relatórios não leem crenças ocultas de NPCs para decidir ações. São uma camada externa **de observabilidade**, e sua avaliação não altera o estado da partida.
- Em mundos antigos, campos opcionais ausentes são exibidos como `null` ou zero nos locais identificados. Este baseline **não** define compatibilidade de saves.
- A qualidade política e militar requer comparar seeds independentes, decisões justificadas, custo, retenção/população, diplomacia, suprimentos, baixas e resultados de guerra. Um objetivo trocado com frequência não é necessariamente bom planejamento.
- O benchmark é CPU/sem navegador. Não prova 144 FPS, qualidade visual ou tempo de resposta a comandos do jogador.

## Próximo gate

Para comparar controladores/estratégias diferentes, executar cenário inicial idêntico com cada política, registrar sequência de ordens e estados finais e guardar seeds de treino separadas das não vistas. Adicionar métricas de atribuição por evento de campanha só depois que a causa puder ser traçada a ordens e custo verificável, evitando concluir causalidade de uma correlação de gráficos.
