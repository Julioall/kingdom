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

O teste automatizado exige segurança física, ao menos uma travessia real
e determinismo. Além disso, a **CI específica de aceitação** executa
`scripts/check-medieval-journey.mjs` após gerar os replays. Ela falha
explicitamente se alguma dimensão de exército não demonstrar todas as
etapas na sequência correta.

`reformed` só vale quando **todos os integrantes cruzaram** e cada unidade
apresenta `rankIntegrity >= 0.65`. `battleFormation` exige, depois disso,
uma frente de lanças/escudos e pelo menos duas unidades fora da coluna.
`contact` exige uma ação real de combate **após** a formação. As ordens
de formação e escaramuças antecipadas ficam em `earlyObservations`, não
contam como conclusão do processo.

A CI guarda os arquivos mesmo quando a aceitação falha.

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

## Primeiro resultado observado: seed 42, 150 dias

A execução inicial na revisão `4842390b` do PR #144 mostrou:

| Unidades | Soldados na outra margem | Contato armado real | Colisão/terreno/teleporte |
| --- | ---: | --- | --- |
| 3 | 30/30 | Sim, primeiro no dia 122 | 0 / 0 / 0 |
| 4 | 18/40 | Não | 0 / 0 / 0 |
| 5 | 21/50 | Não | 0 / 0 / 0 |

A redução de `rankIntegrity` persistiu especialmente nas unidades
retardatárias. O controlador ainda trocava a posse da ponte quando não
havia um ocupante dentro e o pelotão continuava incompleto. **Não foi
aprovado o cenário de quatro e cinco unidades.**

Duas hipóteses foram implementadas experimentalmente e testadas:
manter a fileira única enquanto qualquer seguidor ainda estivesse na
ponte e inserir um ponto de reunião temporário após a saída do corredor.
A execução revelou piora da progressão física (apenas 4 soldados
atravessaram no teste controlado de 150 dias). **Ambas foram retiradas**
da branch de validação; o código de navegação voltou ao estado
comprovado no PR #143, enquanto o auditor foi preservado.

O próximo trabalho não é afrouxar a colisão ou fingir chegada: precisa
negociar a progressão ordenada dos postos entre várias unidades sem
bloquear os seguidores atrás do próprio comandante, e deve ser
comparado novamente contra este replay.
