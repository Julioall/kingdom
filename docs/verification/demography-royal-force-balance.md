# Economia familiar, envelhecimento rápido e autonomia militar

## Visão

O pawn deve financiar a própria sobrevivência e sua família. O rei não tem política de fertilidade nem alvo de tamanho populacional: recebe impostos, compra insumos reais no mercado para a manutenção do reino e decide sobre defesa e contratações militares. O crescimento populacional resulta das condições de vida que os personagens conseguem obter.

## Duração da vida

Cada dia da simulação equivale a um dia de idade biológica do personagem. Não há aceleração do clima ou do calendário:

- 0–239 dias: criança dependente, precisa de cuidado.
- 240–364 dias: adolescente, independente para sustento e trabalho civil.
- 365–729 dias: adulto, pode formar família e se alistar.
- 730–899 dias: idoso.
- Dia 900: morte natural, salvo morte anterior por fome, doença, combate etc.

A interface acompanha a idade gradualmente e informa a fase da vida. Os 200 habitantes iniciais do navegador permanecem distribuídos em dois reinos, com 80% militares e 20% civis apenas no primeiro dia. 500 habitantes continua sendo uma opção de teste.

## Caminho econômico do pawn

1. O pawn coleta frutos, extrai madeira e pedra, reúne minerais ou trabalha na roça. A oferta pessoal ao mercado já permite vender carga física de alimento, madeira, pedra e ferro, transferindo recursos e moedas de contas existentes. A roça entrega colheita ao armazém comunitário, e a venda de metais monetários tem regras próprias: não se transforma minério em moeda automaticamente.
2. A carteira pessoal pode comprar comida para suprir a necessidade. Com renda suficiente e acesso aos estoques reais de madeira e pedra do mercado, o pawn pode encomendar sua casa. A compra transfere 8 de madeira e 2 de pedra do estoque do mercado para a obra, com pagamento da carteira, sem subsídio do rei.
3. A casa particular é uma obra física, não nasce pronta. O dono deve conseguir chegar ao local e trabalhar nos dez dias de construção. Só após a conclusão ela passa a ser sua moradia.
4. Um casal com confiança observável pode compartilhar uma moradia existente, privada ou comunitária, se houver vagas **para os dois e um futuro filho**. Um novo nascimento só ocorre quando ambos têm idade, saúde e energia adequadas, reservas de comida reais suficientes e nenhum filho ainda dependente. A criança recebe doze dias de alimentação retirados das reservas dos próprios pais.
5. Depois que o filho atinge 240 dias, ele já não é dependente. Os pais podem considerar outro nascimento se tiverem condições de alimentação e casa com vaga. Não existe cota real de nascimentos nem ordem do rei para aumentar população. Se a economia falhar, o número de habitantes pode cair.

## Reino e militares

- O tesouro pode comprar madeira e pedra do mesmo mercado dos pawns quando existirem edifícios danificados e faltarem materiais de reparo. A despesa é real; sem dinheiro ou insumos, o reino não consegue comprar.
- A composição militar não segue uma porcentagem rígida: a revisão mensal considera o custo da folha, alimentos, vagas, disponibilidade civil, ameaças e as preferências individuais. Adultos sem riqueza pessoal e com aptidão física podem manifestar interesse em salário militar.
- Voluntários elegíveis podem ser contratados quando houver orçamento e guarnição a recompor. Em guerras, o rei pode requisitar pessoal para defender o território. A seleção preserva um mínimo de trabalhadores civis.
- Os salários continuam debitados do tesouro conforme o sistema já existente. Durante forte escassez econômica e sem campanha ativa, há dispensa gradual; nenhuma pessoa é removida do mundo e nenhum salário devido desaparece.

## Limites honestos

Esta entrega utiliza as atividades e os mercados existentes, mas **ainda não transforma automaticamente todas as cadeias produtivas em empregos remunerados**: a produção em roças comunitárias é depositada no estoque coletivo, e minério de ouro/prata/cobre não é automaticamente convertível em moedas. Isso deverá ser abordado com registros de propriedade, venda e pagamento conservativos; nenhuma riqueza pode ser criada a partir de um comando sem fonte.

A construção particular usa o sistema de estruturas em projeto, com localização válida. Se não houver materiais, local, saúde ou dinheiro, não haverá compra ou obra.

## Verificação

```bash
node --test tests/resource-based-birth-policy.test.mjs tests/kingdom-demography-force-policy.test.mjs tests/residential-birth-capacity.test.mjs tests/person-age-scale.test.mjs
npm test
npm run typecheck
npm run build
```

Cenários a reexecutar em 200 e 500 pessoas, com diversas seeds: 30, 90, 240, 365, 730 e 900 dias. Medir sobrevivência das crianças, renda efetivamente ganha nos mercados, materiais disponíveis, casas concluídas, recrutamentos voluntários e por requisição, saldo do tesouro, mortalidade e conservação de moedas. Uma falha em 900 dias pode ser estrutural: não se deve inserir bebês, comida ou ouro para esconder o problema.

**Critério de aceite:** personagens percorrem as fases de vida e suas decisões respeitam comida, abrigo e renda reais. CI verde é necessária, mas não basta para declarar equilíbrio econômico de longo prazo.
