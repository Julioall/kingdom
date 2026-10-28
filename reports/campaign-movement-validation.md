# Validação da movimentação de campanha

Cenário: mundo gerado com seed 42, população e terreno originais; relógio iniciado no dia 99 para acionar a campanha de fronteira. Foram executados 60 passos completos da simulação, até o dia 159. Não foram reposicionadas tropas nem removidos obstáculos.

| Observação | Antes | Depois |
| --- | ---: | ---: |
| Batalhas acumuladas no dia 130 | 0 | 1 |
| Batalhas acumuladas no dia 140 | 0 | 6 |
| Batalhas acumuladas no dia 159 | 3 | 15 |
| Soldados com rota bloqueada no dia 130 | 17 | 0 |
| Soldados com rota bloqueada no dia 159 | 4 | 0 |
| Ordens cujo destino era água no dia 100 | 5 | 0 |
| Guerreiros vivos que já haviam atacado no dia 159 | 10 | 25 |
| Lanceiros vivos que já haviam atacado no dia 159 | 2 | 13 |
| Arqueiros vivos que já haviam atacado no dia 159 | 3 | 8 |

As posições agora usam terreno conectado e transitável perto do objetivo. Aliados da mesma campanha podem ceder passagem; destinos exatos inacessíveis admitem aproximação por uma posição transitável. O contato local inicia combate sem esperar a formação inteira. Lanceiros mantêm distância compatível com seu alcance, e curandeiros procuram pacientes próximos.

Houve dois bloqueios locais na amostra do dia 140 após a correção; nenhum nas amostras dos dias 150 e 159. O teste demonstra a resolução desse cenário, sem garantir ausência de congestionamentos em todo mapa possível.

A campanha continua priorizando ordens militares sobre a política neural individual. Estas alterações corrigem o controle tático e a navegação; não implementam treinamento neural de combate.

Validação: build concluída e 90 testes passaram em campanha, formações, serviço militar, cerco, navegação, cura, recursos de combate e worker. O teste longo de recrutamento automático foi excluído desta bateria; ele havia passado na execução anterior.

Reprodução: `node scripts/diagnose-campaign-movement.mjs`. Dados completos: `campaign-movement-before.json` e `campaign-movement-after.json` nesta pasta.
