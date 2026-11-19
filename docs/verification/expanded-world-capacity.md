# Kingdom: mapa ampliado e 5.000 habitantes no navegador

## Entrega e escopo

- Mapa autoritativo aumentado de **112 × 112** (12.544 células) para
  **160 × 160** (25.600 células), mantendo divisões regionais de 8 células,
  câmera/minimapa e seed determinística.
- No navegador, o jogo solicita **5.000 habitantes iniciais** ao Worker,
  distribuídos entre os dois reinos (2.500 por reino).
- A chamada `createWorld(seed)` sem opções mantém o cenário controlado
  de 96 residentes para testes históricos e A/B. A chamada
  `createWorld(seed, {initialPopulation: 5000})` cria a população máxima
  imediatamente, sem injeção tardia.
- Perfis de redução na URL: `?population=96`, `?population=500`,
  `?population=1000`; apenas números **pares entre 96 e 5.000**.
  `?population=5000` é o perfil máximo.
- Para os 5.000 iniciais, usa IA híbrida, transporte compacto e
  `cognitiveBudget=adaptive` por padrão, mantendo `?npcBehavior=legacy`,
  `?transport=delta` e `?cognitiveBudget=128` para comparar políticas
  e diagnosticar problemas.
- A geração em massa usa um índice transitório de ocupação e sorteio de
  posições determinístico perto das respectivas capitais, evitando
  milhares de verificações repetidas de `people.some`.
- A escolha dos responsáveis por crianças preserva a seleção por
  proximidade/desempate sem ordenar uma lista de milhares para cada filho.

## Limite de evidência e segurança

**5.000 NPCs** é o maior estresse publicado pelo projeto até agora, e
foi validado originalmente em uma simulação autoritativa de **apenas um
dia no mapa de 112 × 112**, com replays híbridos. O novo mapa de 160 × 160,
5.000 habitantes iniciais, o navegador e a economia em longo prazo
**não estão homologados automaticamente por essa evidência**.

O novo workflow `.github/workflows/expanded-world.yml` tenta gerar o
mapa com 5.000 habitantes reais e avançar um dia, registrando duração,
memória, quantidade efetiva, moradores por reino, moradia atribuída,
sobreposições no surgimento e execução do dia.

O jogo original inicia com poucas casas, para 48 pessoas por reino.
A geração de 5.000 sem ampliar a política urbana/econômica deixa
potencialmente milhares sem moradia. **Isso é uma limitação explícita,
não uma civilização equilibrada ou sustentável.** O arquivo de auditoria
conta os habitantes com `homeId`, e a implantação requer validação
separada de habitação, empregos, alimentos, água, mortalidade,
economia e distribuição espacial durante 30/90/180 dias.

## Verificação

```sh
npm test
npm run typecheck
npm run build
node scripts/audit-expanded-world.mjs --population=5000 --seed=42 --days=1
```

Portas adicionais:
- Criar sementes 1/42/2026 sem falhas de assentamentos, minerais,
  habitantes ou rampa.
- Repetir uma seed máxima e comparar hashes determinísticos.
- Testar navegador Chromium real e em hardware do usuário com zoom,
  minimapa, viewport, 5.000 NPCs, simulação ativa e FPS observado.
- Registrar tempo p95 e RSS de 30/90/180 dias, não extrapolar
  o único dia de estresse.
- Inspecionar inicialmente moradia, água, alimentação, exército,
  ordem social e remuneração antes de declarar o novo perfil
  **pronto para produção**.

Este PR é uma proposta de capacidade máxima, em **draft**, sem merge
automático na `main`. A próxima ação é inspecionar a CI e reparar
as limitações observadas antes da promoção do perfil.
