# Kingdom — foco em economia, política, guerra e comportamento das IAs

**Data:** 2026-11-17  
**Status:** direção de produto definida, migração técnica incremental  
**Base:** `main` de 2026-11-17; este documento prevalece sobre as prioridades ecológicas e de compatibilidade de saves do GDD 0.2, sem invalidar sua história técnica.

## Fantasia central

O jogador **governa como rei** e **pode comandar como general** quando necessário. O mundo não para esperando ordens: reinos rivais, comandantes e população agem com autonomia. As decisões deixam evidências observáveis e consequências econômicas, políticas e militares. A direção de ambientação é a escala de estratégias e batalhas de *Kingdom*, com personagens, nomes, ambientação e arte originais.

## Novo escopo

| Pilar | Ações do jogador e dos agentes | Métricas que importam |
| --- | --- | --- |
| Economia | Produzir, empregar, comprar/vender, estocar, transportar, tributar, financiar exércitos | Estoques por proprietário, preços, produção líquida, salário, fome, déficit e custo de campanha |
| Política | Governar, delegar, negociar, formar alianças, recompensar, reprimir ou reformar instituições | Confiança, lealdade, legitimidade, deserção, paz, alianças, revolta e estabilidade |
| Guerra | Mobilizar, treinar, marchar, formar, flanquear, recuar, abastecer, atacar e ocupar | Efetivo real, coesão, moral, baixas, suprimentos, ocupação e tempo por missão |
| IA e relações | Observar informação parcial, definir objetivos, justificar decisões, coordenar ordens e lembrar consequências | Decisão válida, causalidade, consistência, custo, resultados e relações entre atores |

### Despriorizado ou substituível

- **Compatibilidade com saves antigos:** não é critério de aceitação. Versões futuras podem invalidar saves anteriores. Persistência nova deverá ter versão própria; não prometer migração automática.
- **Ecologia detalhada:** clima, hidrologia, regeneração botânica distribuída e ciclos de fauna deixam de ser pilares do produto. Não expandir esses sistemas.
- **Sobrevivência ambiental microssimulada:** substituir gradualmente por fontes econômicas de alimentos e matérias-primas **finitas e auditáveis**; logística, posse e consumo continuam importantes.
- **Simulação de NPC por detalhe irrelevante:** reduzir avaliações rotineiras em favor de agenda de eventos e prioridades (ameaça, fome, comércio, ordem, oportunidade), preservando causalidade.

**Dependências:** não desligar plantas, animais ou hidrologia de forma indiscriminada antes de trocar seus fornecedores de alimento/materiais no sistema econômico. Isso criaria fome artificial, economia quebrada e regressões sem sentido. Primeiro introduzir fontes produtivas simples e medir conservação de recursos; então substituir etapas do ambiente, em pequenas alterações com testes.

## Arquitetura-alvo (sem reescrita total)

```text
Interface DOM (trono, conselho, ordens, inspeção)
              |
       Renderizador 2D
  (Canvas atual / PixiJS candidato)
              |
      Snapshots e eventos
              |
      Simulation Worker
         |          |
    comandos     estado autoritativo
         |          |
    economia — política — guerra
                  |
       atores e políticas de IA
                  |
   eventos, crônica, avaliação e replay
```

1. **Simulação soberana:** economia, política, guerra e IA alteram estado somente no Worker, por comandos validados. Renderizador não cria soldados, comida ou vitórias.
2. **Camadas independentes:** renderer, HUD, simulação, entrada, observabilidade. Hoje `src/ui/game.js` concentra responsabilidades demais; extrair progressivamente entrada/câmera, renderização de terreno, personagens, combate e controles de tempo.
3. **Dados e algoritmos:** manter ou melhorar índices espaciais, caches por revisão, atualização dirigida por eventos e buffers contíguos/typed arrays onde benchmarks justificarem. Usar estruturas de dados adequadas antes de adicionar bibliotecas.
4. **Bibliotecas candidatas:** avaliar **PixiJS** para renderização acelerada e sprites em lote. Comparar FPS, p95 de CPU do desenho, memória, tempo de inicialização, uso de GPU, facilidade de depuração e fidelidade visual com o Canvas existente **antes** de migrar. Não adicionar Phaser/ECS/physics engine apenas por moda; os comandos e o combate já têm regras próprias.
5. **IA auditável:** relatórios e decisões continuam limitados ao que cada ator conhece. Registrar intenção → informação observada → ordem → custo → execução → desfecho. Comparar políticas usando seeds fixas e também não vistas.

## Estratégia de desempenho: meta 144 FPS

144 quadros por segundo equivalem a uma janela de **6,94 ms por quadro**; a frequência efetiva depende do monitor, dispositivo, GPU, browser e carga. Não apresentar 144 FPS como resultado até medir num monitor compatível.

### Experimentos de renderização

- Baseline: `?seed=42&profile=1` (limite tradicional de 60 desenhos/s).
- Teste em 144 Hz: `?seed=42&profile=1&renderHz=144`.
- Sem limite artificial de pintura: `?seed=42&profile=1&renderHz=display`.
- Controle com mundo pausado: acrescente `&paused=1&effects=fixed`.
- Medir **RAF FPS e desenhos de mapa/s separadamente**; FPS de `requestAnimationFrame` não é prova de 144 desenhos completos nem de GPU dentro do orçamento.
- Comparar câmera parada, pan/zoom, população 100/500/5000, combate e interface aberta com mesmas seeds, DPR, resolução e escala de mundo.
- Diagnosticar p50/p95/p99 dos intervalos e CPU de quadro, p95 do desenho, GPU, pausas longas, heap, tempo de aplicação de snapshot, Worker, largura de banda de transporte e formação/treino de IA. Repetir e inverter a ordem A/B.

### Condições de promoção

1. Mesma simulação autoritativa por seed/comandos nas alterações **puramente visuais**.
2. Navegador real: nenhuma regressão visível em sprites, seleção, zoom, projéteis, grupos, pontes e cercos.
3. Sem crescimento de memória sem limite, filas de Worker descontroladas ou atrasos de input.
4. Renderização em 144 Hz só vira padrão depois de atingir p95 de intervalo de frame compatível com 6,94 ms em hardware-alvo definido; presets adaptativos para hardware mais fraco.

## Ordem de entrega

**P0 — observabilidade e gargalos reais.** Manter `main` estável. Usar branch experimental, taxa de desenho configurável, caches de candidatos visíveis, testes unitários e perfis comparáveis. **O primeiro PR não afirma ganho medido de FPS.**

**P1 — economia mínima coerente.** Produção setorial, disponibilidade de estoques, transporte, comércio, impostos, soldo e financiamento; substituir ecologia só após os fluxos fecharem sem geração fictícia.

**P2 — política e IAs.** Relatórios com memória, relações, compromissos, tomada de decisão com custos e justificativa; cenários reproduzíveis, métricas de ação válida e consequências.

**P3 — guerra legível.** Hierarquia rei → general → comandante → soldados; frentes, reservas, manobras, logística e resultados persistentes. Não prometer multidões sem profiling.

**P4 — render acelerado se justificado.** Protótipo PixiJS **comparativo** em uma cena militar e uma cidade, preservando o mesmo modelo de entidades; só migrar componentes após evidência.

## Fora do escopo agora

Migração integral de engine, multiplayer, compatibilidade histórica de saves, novos biomas, realismo de clima/hidrologia, LLM para cada cidadão e cópia de personagens ou visuais protegidos de *Kingdom*.
