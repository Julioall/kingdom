# Espera por abrigo, patentes residuais e alimento no fim da simulação

Data: 25/10/2026.

## Causas e correções

1. Qualquer carga forçava `deliver`, mesmo sem comunidade ou depósito conhecido. Uma pessoa independente com madeira ou frutos podia ficar aguardando abrigo até suas necessidades se tornarem críticas. A entrega agora exige um plano válido. Sem destino, a pessoa pode cuidar das necessidades e migrar conservando a carga.
2. A carga tinha prioridade até a sede e a fome se tornarem emergências. Transportadores civis agora procuram água abaixo de 40 e alimento pessoal abaixo de 24 quando há fontes conhecidas. A coleta pessoal interrompe a coleta comunitária durante essa recuperação.
3. Sem casa, o descanso acabava logo após ultrapassar 24 de energia. Isso criava um ciclo curto de espera e descanso perto desse valor. O descanso ao ar livre continua até 72, com interrupções para necessidades pessoais.
4. Uma única coleta pequena iniciava uma viagem de entrega. Coletores com ordem comunitária, alimento próximo e condições pessoais seguras agora consolidam cargas entre 6 e 24 unidades, conforme a distância do depósito. A coleta se encerra quando o recurso próximo deixa de estar disponível ou outras necessidades exigem atenção.
5. A colheita podia remover mais biomassa do que cabia na carga de alimento. O limite disponível é aplicado antes de retirar biomassa. Rações emergenciais podem consumir alimento, frutos e carne carregados, descontando a quantidade física e respeitando o valor nutricional da carne.
6. Desmobilizar um general alterava `role`, mas preservava `militaryRank` e vínculos de comando. A desmobilização, a saída do reino e a atualização militar agora limpam os campos ativos. O desenho da placa também exige soldado vinculado a um reino existente.
7. Entregas de carne de indivíduos independentes podiam usar um abrigo destruído ou acessar `community.name` quando a comunidade pessoal era nula. O destino é validado e o registro usa a comunidade que recebeu a carga. Ração animal pode entrar na reserva comunitária quando ainda não há curral.

## Replay antes e depois

Comando: `node scripts/diagnose-late-survival.mjs`. Semente padrão 42, 2.100 dias, sem snapshots diários. Foram mantidos mapa e população inicial. O processo anterior foi iniciado antes das alterações; o processo final carregou todas as correções de comportamento.

| Medida | Dia 2.000 antes | Dia 2.000 depois | Dia 2.100 antes | Dia 2.100 depois |
| --- | ---: | ---: | ---: | ---: |
| Pessoas vivas | 79 | 81 | 76 | 80 |
| Aguardando abrigo | 26 | 0 | 14 | 0 |
| Generais com função/reino incompatível | 5 | 0 | 5 | 0 |
| Alimento pessoal abaixo de 24 | 60 | 36 | 56 | 34 |
| Água abaixo de 22 | 27 | 13 | 25 | 6 |

Fontes: `late-survival-before.jsonl` e `late-survival-final.jsonl`. `late-survival-after.jsonl` registra uma versão intermediária anterior aos lotes de coleta e ao consumo de carga comestível.

As alterações mudam a trajetória da partida; as contagens descrevem esta semente e não garantem os mesmos resultados em outros mundos.

## Abastecimento ainda pendente

O desaparecimento das esperas não resolve toda a escassez. No dia 2.100 corrigido, o reino 25 tinha cerca de 0,22 unidade no estoque comunitário e o reino 26 tinha zero. Ambos tinham zero alimento no tesouro e no mercado. Ainda havia 34 pessoas com reserva pessoal abaixo de 24.

A validação ampla de sobrevivência até o dia 253 também falhou: exige zero mortes por fome, mas ocorreu uma morte adulta. O diagnóstico separado de dependentes não registrou morte infantil nesse intervalo. Essa falha permanece aberta; não foi alterada a expectativa do teste para escondê-la.

O próximo trabalho no abastecimento precisa medir produção, consumo e transporte por reino, capacidade dos campos e quantidade de trabalhadores efetivamente coletando para a reserva. A recuperação dos estoques não foi comprovada nesta entrega.

## Validação

- 11 regressões novas cobrem os casos de espera, sede, fome, descanso sem casa, lotes de transporte, conservação de alimento, depósitos e placa militar.
- 88 testes focados de sobrevivência, serviço militar, estratégia e campanhas passaram.
- Dois testes adicionais de população/reprodução determinística e ocupação visível passaram: total final de 90 testes focados aprovados.
- Os testes de população foram alinhados à configuração já existente de 50 moradores por reino. A ocupação exclui pessoas descansando dentro de construções, que ficam fora do campo visível.
- A execução ampla de migração encontrou a falha de fome prolongada descrita acima. Não foi obtida uma suíte ampla totalmente aprovada.
- `npm run build` passou. O Vite mantém o aviso do bundle principal acima de 500 kB.
