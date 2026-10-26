# JUL-178 — Auditoria alimentar e conciliação de campanha

## Decisão

Manter a ecologia restrita ao ciclo de disponibilidade de alimentos e sobrevivência. Não aumentar biomassa, inventar biomas ou adicionar mecânicas ecológicas sazonais: a auditoria de produção mostra alimento vegetal disponível no horizonte longo, mas mortes por fome e muitos adultos-dia com reserva baixa. O próximo diagnóstico deve tratar acesso, execução de coleta, proteção de reservas civis e ração distribuída em campanha antes de alterar oferta ecológica.

Foi acrescentada uma visão contábil por lado de campanha para distinguir comida mobilizada, reabastecimento do tesouro/comunidade, consumo em campo, ração debitada da reserva pessoal, retorno e saldo final. Ela é instrumentação; não cria ou muda alimento. JUL-178 continua aberta porque a contabilidade fecha, mas a sobrevivência não atende o critério.

## Pergunta, fonte e limites

* Pergunta prática: a biomassa total basta para demonstrar acesso alimentar por pessoa e estoque disponível em campanha? A resposta da simulação é não: estoque agregado final pode coexistir com reservas pessoais baixas e mortes por fome.
* SciSpace encontrou Koh et al. (2019), “Examining disparities in food accessibility among households in Columbus, Ohio: an agent-based model”, DOI [10.1007/S12571-019-00900-7](https://doi.org/10.1007/S12571-019-00900-7). O estudo destaca a diferença entre disponibilidade agregada e acesso entre domicílios. É contexto conceitual; seu modelo de transporte urbano não prova uma causa nem solução para Kingdom.
* A skill Game Studio `game-playtest` orienta manter a simulação/headless como evidência funcional e validar no navegador mudanças visuais. Esta instrumentação é headless e não altera o playfield. O conector MCP de Game Studio não está disponível nesta sessão.
* Consensus estava sem cota até 01/11/2026. O campo de contexto do Linear falha com `Tool get_agent_context not found`; a consulta a SciSpace, o código e os replays foram usados como as demais fontes disponíveis.

## Alternativas consideradas

1. Aumentar regrowth/biomassa para eliminar fome agregada. Rejeitada por enquanto: no seed 1 a biomassa vegetal final foi 140.963,34 e ainda houve três mortes humanas por fome; essa medida não comprova acesso individual.
2. Criar sazonalidade ecológica ou biomas para explicar escassez. Rejeitada pelo escopo desta auditoria e pelos critérios da meta: estações ficam como troca visual de tiles.
3. Considerar a auditoria aprovada pelo saldo final ou pelo número de campanhas encerradas. Rejeitada: cada passo diário inspeciona estoques e as contas de campanha conciliam, mas sementes 1 e 987 ainda registram fome humana e as reservas passam muito tempo abaixo de 20.
4. Corrigir imediatamente a política de coleta com um peso/heurística sem reproduzir a causa. Adiada: os traços mostram comportamento com mudança de alvo e pequenas coletas, mas ainda não isolam se o déficit dominante vem de acesso, política, cuidado ou logística. A próxima fatia deve trazer cenário controlado e métrica causal antes de ajustar a política.

## Evidência reproduzível

Audit source revision `2a1acded1ddb6a5f27f7d00fb00e513bc70cbe0a`; comando:

```text
npm run audit:food -- --days 730 --seeds 1,42,987,2026 --repeat-seed 42 --output docs/verification/JUL-178-campaign-ledger-730-20261026.json
```

O comando concluiu sem erro. O auditor checou os saldos todos os dias: 2.920 passos de replay para quatro seeds e mais 730 da repetição. A seed 42 repetiu com o mesmo hash de estado `12dffa1572f4e5550d39a6f057bd95f015a63d10a5cdd10329399ff2b3bd3280` e o mesmo hash de crônica `0a1d8d746ea4a9a16288f2767395252f7c2e12f795b6755d96eef9a5388d1b09`. Nenhum estoque diário inválido acionou o auditor.

| Seed | Mortes humanas por fome | Mortes de animais selvagens por fome | Adultos-dia com reserva <20 | Lados de campanha / sem livro | Lados sem conciliação |
|---:|---:|---:|---:|---:|---:|
| 1 | 3 | 1 | 34.328 | 12 / 0 | 0 |
| 42 | 0 | 8 | 36.094 | 14 / 0 | 0 |
| 987 | 1 | 6 | 35.002 | 20 / 0 | 0 |
| 2026 | 0 | 0 | 29.253 | 18 / 0 | 0 |

Em todos os 78 lados registrados nos quatro runs e na repetição, cobertura do ledger é completa, diferença de fonte de reabastecimento é zero e saldo de comida de campo é zero; os estoques foram verificados não negativos a cada dia. Os testes direcionados anteriores cobrem transferência atômica, estoque/carga limitada e ração de campanha. Isso não cobre ainda os cenários controlados de estoque zerado, cuidador morto, fronteira fechada e choque de acesso especificados na issue.

## Próxima validação

Preservar os traços individuais existentes em `docs/verification/`. Criar uma matriz controlada que compare política atual com acesso/recurso isolado, sem alterar a ecologia, e medir mortes humanas por fome, adultos-dia abaixo de 20, transferência por origem/destino, cuidado e custo de campanha. Só fechar JUL-178 quando todos os critérios de aceite da issue estiverem demonstrados.
