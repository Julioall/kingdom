# Validação militar: marcha → travessia → reagrupamento → formação → contato

## Escopo
O protocolo combina duas evidências independentes:

1. **Jornada controlada de três, quatro ou cinco unidades:** soldados reais
   do motor Kingdom executam `moveOne` e `planSquadTactics` sobre terreno
   físico com ponte de dez células de extensão e **apenas uma célula de
   largura**. Não há deslocamentos diretos depois da montagem inicial.
   O relatório mede entradas, saídas, espera, integridade das fileiras,
   formações, aproximação, ações de combate e possibilidade de deadlock.
2. **Replay integral de guerra:** `scripts/replay-medieval-battle.mjs`
   cria a guerra entre os dois reinos e simula dias reais por `Sim.stepDay`,
   com reforços explícitos até 50 soldados por reino. O artefato HTML mostra
   posições reais, unidades, flancos, reserva, fases, mortes e alvos. Esse
   segundo cenário não força uma ponte; portanto NÃO é validação automática
   da travessia específica do primeiro.

Os relatórios têm resultados **observados**, sem declarar fases ausentes
como sucessos. Um arquivo JSON com a trajetória diária permite identificar
onde houve atraso e qual unidade ficou estacionada.

## Comandos

```sh
node --test tests/military-unit-journey.test.mjs
node scripts/audit-medieval-unit-journey.mjs --seed=42 --units=3,4,5 --days=150 --output=out/military-journey.json
node scripts/replay-medieval-battle.mjs --seed=42 --force-size=50 --days=75 --interval=3 --output=out/medieval-battle-five-units.html
```

GitHub Actions: `.github/workflows/military-journey.yml` coleta
`medieval-five-unit-journey` para inspeção.

## Portas de aceitação e métricas

| Etapa | Sinal medido | Política |
| --- | --- | --- |
| Marcha | `march`, posições e `marching` | Soldados precisam receber ordens reais |
| Travessia | `bridgeEntered`, `maxCrossed`, liberação da retaguarda | Nenhum movimento por terreno ilegal, colisão ou teleporte |
| Reagrupamento | `reformed`, fase `reforming`, `rankIntegrity` | Sem troca de comandante imaginária |
| Formação | `battleFormation`, tipos `shield_wall`/`spear_line`, flancos e reserva | A transição deve ocorrer em solo aberto e usar posições reais |
| Contato | `contact`, `maxEngaged`, dano e criação de ações de combate | Não basta registrar um inimigo distante como batalha |
| Segurança | `overlaps`, `illegalTerrain`, `jumps`, `blockedDays` | Erros físicos = zero |
| Repetibilidade | `digest` | Mesma seed e parâmetros = hash idêntico |

O teste automatizado inicialmente exige segurança física, pelo menos
uma travessia real e determinismo. O relatório expõe **todas as etapas**
e seus valores ausentes. Só podemos afirmar a sequência completa quando
`rearGuardCleared`, `reformed`, `battleFormation` e `contact` forem
observados de fato nas três dimensões de tropas.

## Limites e riscos

- A jornada controlada **não** executa a economia, recrutamento ou atualização
  de uma guerra completa. O replay separado cobre a campanha completa.
- A política anterior de 40 células de comprimento máximo por segmento e
  segurança de movimentos continua valendo. Não desativar proteção para
  satisfazer artificialmente o replay.
- A issue #54 continua requerendo reprodução independente da seed 42.
- Não afirmar 144 FPS sem medição no navegador.
- A disciplina de flancos, arqueiros, clérigos e reservas exige observação
  do artefato HTML e auditoria dos motivos de cada transição.

Se uma fase não aparecer, este relatório deve guiar a correção do sistema,
não transformar o teste em uma animação roteirizada.
