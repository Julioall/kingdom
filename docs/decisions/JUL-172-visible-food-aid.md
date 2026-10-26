# JUL-172 — ajuda alimentar baseada em observação local

Data: 26/10/2026
Issue: [JUL-172](https://linear.app/julio-alves/issue/JUL-172/s2-implementar-encontros-compartilhamento-de-informacao-e-ajuda)

## Pergunta e evidência no código

Como um morador pode escolher quem ajudar sem conhecer as reservas privadas de toda a comunidade? Antes desta fatia, a ação share consultava todos os IDs de membros vivos, escolhia a menor reserva pessoal e registrava ajuda diretamente, embora a percepção local guardasse apenas pessoas visíveis, posição e distância. Isso fazia uma decisão individual usar informação global.

## Fontes e limites

- Game Studio / arquitetura atual: manter a simulação determinística no Worker e a percepção separada do Canvas. A inspeção e os testes do próprio projeto continuam sendo a evidência funcional.
- SciSpace: Saha e Sen, “Local Decision Procedures for Avoiding the Tragedy of Commons” (2003), [DOI 10.1007/978-3-540-24604-6_30](https://doi.org/10.1007/978-3-540-24604-6_30), descrevem decisões sobre recurso comum usando informação local. É motivação arquitetural; não define a percepção ou os limiares de Kingdom.
- SciSpace: Kayser e Armbruster, “Social optima of need-based transfers” (2019), [DOI 10.1016/j.physa.2019.04.247](https://doi.org/10.1016/j.physa.2019.04.247), analisam transferências por necessidade em uma rede e alertam que a política ótima de curto prazo pode piorar vulnerabilidade de longo prazo. Não importei seu algoritmo nem thresholds.
- SciSpace: Kouremetis e Garfield, “Altruism as a mechanism for resource management” (2013), [DOI 10.1109/SECON.2013.6567415](https://doi.org/10.1109/SECON.2013.6567415), reportam que o efeito de partilha depende da oferta relativa à demanda e do algoritmo usado. Isso motiva conservar recursos e validar a transferência real, sem tratar altruísmo como geração de alimento.
- Consensus foi consultado nesta execução e informa que as 30 buscas mensais foram usadas; a cota reinicia em 01/11/2026.
- As notas compartilhadas do Linear continuam indisponíveis: a ferramenta declarada devolveu “Tool get_agent_context not found”. O código e as issues são a fonte operacional.

## Alternativas e decisão

| Alternativa | Avaliação | Decisão |
| --- | --- | --- |
| Escolher globalmente o membro com menos reserva | Facilita atender quem mais precisa, mas vaza estado privado e ignora distância | Rejeitada |
| Expor a reserva numérica da pessoa na percepção | Torna a decisão fácil de testar, mas revela mais do que a necessidade da ação exige | Rejeitada |
| Expor um sinal qualitativo transitório de sofrimento alimentar apenas enquanto a pessoa é vista; revalidar a transação e usar o inventário finito | Preserva escolha local, permite ajuda concreta e não revela o valor exato | Escolhida |
| Exigir pedido explícito recebido por encontro social | É um modelo de comunicação mais completo e poderá sustentar recusa/interação; aumenta a superfície e fica para uma fatia posterior de JUL-172 | Adiada |

O sinal foodDistress representa uma necessidade observável quando a reserva está abaixo de 48 pontos. Ele existe apenas no avistamento atual; posições lembradas não carregam o sinal. O agente seleciona um destinatário visto, e performShare revalida visibilidade, vida, comunidade, proximidade e saldo no momento do movimento. A transferência continua limitada pelos helpers de inventário; evento, crença do destinatário e confiança só são registrados depois de alimento mover.

## Escopo e validação desta fatia

Esta decisão corrige apenas a escolha local de destinatário e o registro de ajuda efetivamente transferida. Não fecha encontros incompatíveis, pedido/recusa, emergência que interrompe encontro, referência de água, nem adoção integrada a políticas do rei; esses critérios permanecem abertos em JUL-172.

- Teste focal em 26/10/2026: node --test tests/social-aid.test.mjs — 4/4.
- Suíte completa no HEAD 6447ad6e7761041eb763b04293c3c5531891ed26: npm test — 97/97, 59,32 s.
- npm run build no mesmo HEAD: typecheck e build passaram; Vite transformou 99 módulos. Permanece o aviso conhecido de bundle acima de 500 kB.
- Replay social de 30 dias na seed 42 repetiu estado e crônica: state SHA 25249d59786d44d382ae5bf9cbaf31d3746e6ae6e4550648a13631d1f5935f5f, chronicle SHA c6a551b98b806f28f377b7d4db8544dc6a712dd79314280266873cbcf1cb7086. O relatório vê duas pessoas com share como última ação, mas não contabiliza transferências de ajuda; portanto, não prova ajuda bem-sucedida em uma execução orgânica.
- Evidência e critérios ainda abertos: docs/verification/JUL-172-visible-food-aid-20261026.md.

