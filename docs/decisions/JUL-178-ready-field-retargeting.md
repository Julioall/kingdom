# JUL-178 — redirecionamento de coleta para roça pronta

Data: 27/10/2026

## Decisão

Quando o Rei mantém uma ordem urgente de segurança alimentar, uma roça madura deve se tornar o destino do trabalhador que ainda está procurando alimento silvestre. Na revisão de governança, ordens ativas `secure-shared-food` sem uma roça pronta válida passam a apontar para a roça pronta mais próxima.

O trabalhador conserva a carga que já está levando: tarefas com alimento, fruta ou carne carregada não são redirecionadas até o depósito. Ordens que já apontam para um campo pronto e ainda produtivo também permanecem. A mudança não cria comida, não altera rendimento/crescimento do campo e não cancela a coleta de frutos quando nenhuma roça está disponível.

## Evidência que motivou a mudança

No replay anual da seed 2026 (`docs/verification/JUL-178-replant-365-final-20261027.json`), a revisão do dia 350 mostrava estoque comunitário de 2.831, uma roça pronta com aproximadamente 9.450 unidades no campo e um trabalhador ainda designado a `secure-shared-food` sem `foodFieldId`. No dia 365, o estoque havia caído para 2.185; só 57,1 unidades tinham sido colhidas e cerca de 9.942,9 permaneciam em pé. O Rei já escolhera replantar e mantinha a ordem de coleta, mas a ordem não incorporava a nova produção pronta.

A JUL-178 atualizada em 27/10 também registra que os bons resultados de 365 dias não encerram a auditoria: a continuidade precisa ser demonstrada em 730 dias e em ambos os reinos; os replays históricos de 730 dias esgotaram o primeiro lote sem replantio/estoque. A atualização do coeficiente de raiz cultivada (`growth=180`, `max=420`, `rootReserve=0`) substitui a expectativa antiga do teste sazonal, sem transformar cultivo em regeneração livre.

## Alternativas consideradas

- **Esperar a tarefa expirar:** preserva o alvo antigo, mas pode deixar todo um lote pronto parado por vários dias e falhou no traço acima.
- **Cancelar imediatamente toda ordem de forrageio:** rejeitada porque interromperia trabalhos válidos e não respeitaria alimento já em trânsito.
- **Retarget condicional na revisão de governança:** escolhida. Redireciona apenas ordens reais de segurança alimentar quando há campo maduro, mantém cargas em trânsito e mantém o campo existente enquanto ainda tem produção.

## Validação

O teste de governança cobre os dois ramos: trabalhador sem carga é redirecionado para o campo pronto; trabalhador com comida carregada conserva sua atribuição até a entrega. Testes focados: 17/17; suíte completa: 259/259; `npm run build` e `git diff --check` passaram.

O commit de código `c9b53e4371b49dfbaece51c237e130e661705785` foi então revalidado com `npm run audit:food -- --days 365 --seeds 2026 --output docs/verification/JUL-178-replant-retarget-365-seed2026-20261027.json`. O replay determinístico terminou em 117,76 s com estado `cfa2ec3e1d6581b2405c62c32175f87f2a86448ca37f9159fd14b01fbcdb939b` e crônica `83accdc8dbcf6ed93f112c54849f82086eb5160e117974d19d8eb0befbe8eb52`. As duas roças foram semeadas novamente: Valedouro 2 ciclos, Corvânia 3; a produção cultivada retirou 40.317,57 e entregou 38.820,67 unidades. Os estoques comuns terminaram em 9.479,47 e 13.307,57; em ambos os reinos, `daysBelow300=0` e mortes humanas por fome foram 0. As 12 mortes por fome foram todas de animais silvestres.

O resultado demonstra que a nova ordem alcança e colhe os talhões, inclusive com mais de uma semeadura no ano. Não demonstra, porém, a meta contínua de 180 dias de buffer: Valedouro ficou 254 dias e Corvânia 197 dias abaixo desse alvo, embora a reserva combinada mínima tenha permanecido em 106,52 e 104,65 dias, respectivamente. Havia 16 pessoas por reino com reserva individual abaixo de 20 ao fim do replay. Por isso, a correção remove um bloqueio real da lavoura, mas não fecha a auditoria alimentar nem a meta de manter o buffer cheio.

## Fontes e limites

- Issue e discussão JUL-178: https://linear.app/julio-alves/issue/JUL-178/auditar-conservacao-e-logistica-de-alimentos-coleta-cultivo-caca-civis
- Relatórios e trace local: `docs/verification/JUL-178-replant-365-final-20261027.json`, `docs/verification/JUL-178-starvation-trace-365-seed2026-20261027.json` e `docs/verification/JUL-178-replant-retarget-365-seed2026-20261027.json`.
- Game Studio foi consultado na avaliação anterior da experiência de jogo; esta mudança é somente de política de simulação, sem alteração visual, portanto não requer screenshot de playtest.
- SciSpace foi consultado anteriormente sobre ciclos de cultivo; a fonte apoia distinguir crescimento e colheita, mas não define coeficientes para Kingdom. Consensus continua temporariamente sem cota até 01/11/2026. O conector Linear `get_agent_context` foi chamado e respondeu que a ferramenta não está disponível.
