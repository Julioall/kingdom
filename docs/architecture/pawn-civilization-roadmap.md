# Kingdom: arquitetura de civilização emergente
**Proposta de evolução, 19 de novembro de 2026**

## Princípio central
O mundo **não ganha** população, riqueza, moradias, governo ou capacidade de combate só porque passou um prazo ou alcançou um número de habitantes. O Kingdom nasce de decisões locais de agentes que têm necessidades, informação limitada, habilidades adquiridas, inventários físicos, relações sociais e responsabilidade por seus dependentes.

**Hierarquia de agregação**: **indivíduo > família > comunidade > reino > exército/território**.

É uma cadeia de dependências, não uma ordem central de produção. Cada subsistema responde pelas decisões do seu nível e os níveis superiores só têm poder sobre recursos que realmente lhes pertencem.

## Regras de posse, agência e causalidade

| Camada | Quem decide? | Recursos pertencem a | Permissões, limites e evidência |
| --- | --- | --- | --- |
| Indivíduo | Pawn e seu controlador | Inventário, carteira, ferramentas, habilidades, memória | Pode colher, pescar, mineirar, construir, negociar ou migrar; cada ação precisa de trabalho, acesso, energia e recurso físico |
| Família | Dois adultos e cuidadores reais | Moradia, estoques domésticos e obrigações individuais | Pode formar casal, repartir despesas, criar filhos, transmitir habilidades observadas; um nascimento precisa de casa vaga, alimento e cuidados reais |
| Comunidade | Famílias e lideranças reconhecidas | Estoques, áreas de uso e obras coletivas | Organiza trabalho público, ajuda mútua, agricultura, armazenamento, troca de excedentes; não pode gastar a carteira privada sem acordo |
| Reino | Comunidades que instituíram um governo | Tesouro tributado e bens públicos | Pode cobrar tributo acordado, comprar recursos no mercado, manter obras e contratar soldados; não pode ordenar partos nem criar ouro |
| Forças militares | Pawns alistados e comando | Equipamento pago pelo reino, soldo devido a cada pessoa | Treino requer centro e instrutores; torres e expedições exigem meios materiais, reservas, legitimidade e contexto político |

### Ciclo de vida (um dia simulado = um dia biológico)
- Dias 0–239: dependente que precisa de cuidadores e pode observar trabalhos.
- Dias 240–364: adolescente independente que começa atividades civis, busca renda, abrigo e relações.
- Dias 365–729: adulto apto a construir família e a se voluntariar ou ser requisitado para serviço militar.
- Dias 730–899: idoso que mantém conhecimentos e relações, podendo ensinar mesmo que reduza trabalho físico.
- Dia 900: morte natural, sem impedir mortes antecipadas por escassez, ferimentos ou guerra.

**Herança de conhecimento**: observação de trabalho executado por alguém próximo, com identidade do mentor, ação observada, dia e progresso limitado à experiência do mentor. Não copiar pesos neurais, experiências secretas ou informações que a criança não poderia ter presenciado. Na adolescência a aprendizagem adquirida passa a influenciar sua própria produção, escolha profissional e eficiência. Para trabalhos que não foram ensinados, ela aprende do zero.

## Portões para evolução

### I. Indivíduo autossuficiente
Deve demonstrar repetidas jornadas com alimento, água e saúde adequados e trabalho produtivo efetivamente observado. Reservas recebidas no nascimento ou um tesouro comunitário não provam autonomia. Pode sobreviver por subsistência, mesmo sem mercado e sem moeda.

**Teste principal**: um pawn num mundo ainda sem reinos mantém-se por 30–90 dias coletando comida, buscando água e administrando energia; indicadores não se mantêm positivos se ele parar de produzir.

### II. Família durável
Dois indivíduos capazes podem construir/ocupar moradia, formar casal por vínculo de confiança e criar dependentes; parceiros devem sobreviver sem consumir recursos inexistentes. O recém-nascido recebe alimentação de contas reais. O filho adquire habilidades por convivência e atinge independência aos 240 dias. Os pais só consideram outro filho quando não houver criança ainda dependente e houver espaço e comida.

**Teste principal**: dois pawns passam da subsistência individual à formação de casal e um filho completa 240 dias. Medir alimento recebido da família vs. da comunidade, compra ou construção da casa, atividade produtiva e habilidades aprendidas. Sem moradia, comida ou cuidadores, a transição falha de modo explicável.

### III. Comunidade produtiva
Mais de uma família estabelece acordos de convivência e trabalho, participa de uma área habitada e produz excedentes. **Troca direta de bens deve vir antes da moeda**; mercado formal e salários são especializações posteriores. Roça, lenha, pedra, minério, ferramentas e casas pertencem a pessoas ou à comunidade conforme contratos verificáveis.

**Teste principal**: pelo menos duas famílias economicamente viáveis realizam troca conservativa entre patrimônios diferentes; mantêm armazém compartilhado, divisão de trabalho e cuidados com menores. A comunidade sobrevive se um membro migra ou morre.

### IV. Fundação legítima do reino
Uma ou mais comunidades adota uma instituição pública por acordo e evidência registrada (`civicCharter` com comunidade(s), data, fonte de decisão e liderança). O tesouro surge de tributos ou contribuição **transferida** dos participantes, nunca é criado com saldo fundador numa partida de origem. O rei recebe autoridade sobre bens públicos, impostos, diplomacia e manutenção, não sobre a reprodução.

**Teste principal**: sem comunidades prósperas ou sem acordo não existe reino. Após acordo, o rei compra madeira/pedra que vendedores colocaram no mercado para reparar uma obra pública; a soma dos inventários e das moedas permanece conservada.

### V. Especialização militar e disputa territorial
O reino precisa ter orçamento, reserva civil, trabalhadores, capacidade de pagamento e fonte de treinamento antes de construir quartel. Soldados são pawns identificáveis, com treinamento, equipamento, patente, comida, salário e tempo de serviço. Torres requerem construção efetiva, patrulha e manutenção. Só então intenções políticas justificadas por observações (segurança, fronteira, conflito, tratados) podem determinar defesa, expansão ou campanha.

**Teste principal**: nenhum alistamento sem candidato, alimento e pagamento. Nenhuma torre constrói-se gratuitamente. Campanhas causam perdas humanas e econômicas rastreáveis; o reino precisa conseguir sobreviver sem destruir o trabalho civil que o sustenta.

## Modo de origem vs. modo militar atual

A `main` atual ainda instancia reinos, castelos, torres, mercados, tesouros e militares **no dia zero**. Isso serve de *cenário pronto* para testar batalhas, não prova evolução emergente. A migração correta é introduzir explicitamente um `civilizationStart: 'pioneers'` separado, com pessoas e ecologia existentes, mas sem castelo, rei, tesouro ou exército iniciais. A sequência de fundação precisa surgir por regras e decisões verificáveis. Não remover o cenário legado até que o modo de origem tenha sobrevivido a replays determinísticos.

O diagnóstico experimental `trackCivilization: true` **não cria instituições**. Registra até 30 dias de evidências de trabalho, sobrevivência e vendas reais e avalia portões `sobrevivencia → individuo → familia → comunidade → reino → defesa_organizada`. Um castelo sem carta de fundação não satisfaz o portão `reino`. Estes são indicadores de teste, não disparadores automáticos.

## Implementado nesta PR incremental
- Ensino observado dentro da família, identificado por mentor, tipo de atividade e dia; habilidade adquirida continua após adolescência.
- Registros individuais limitados de sustento, colheita e comércio, com opção de ativar no motor para auditoria.
- Avaliação **sem efeitos colaterais** dos portões de maturidade, famílias, comunidades, instituições e quartéis.
- Testes que rejeitam autossuficiência só por ter reservas iniciais e rejeitam fundação apenas por possuir castelo.

## Trabalho ainda necessário, na ordem em que destrava o seguinte

1. **Mundo pioneiro funcional:** iniciar sem instituições, registrar consumo, trabalho e estoque pessoal, controlar inflação/escassez, e sobreviver 90 dias.
2. **Moradia e economia doméstica pré-moeda:** abrigo artesanal financiado por carga real; guarda de bens, propriedade, herança material, convivência, segurança e responsabilidades parentais.
3. **Dupla geracional:** 2 adultos sustentam 1 criança até 240 dias; educação, órfãos, morte dos pais, sucessão e possibilidade de recompor a família. Replays de 900 e 1.800 dias em seeds diversas.
4. **Comunidades sem reino:** permitir criação e manutenção de grupos de famílias não afiliadas, trocas diretas, agricultura remunerada ou partilhada conforme acordo, mercado posterior, lealdade e aprendizado por aprendizagem profissional.
5. **Instituições e rei:** carta de fundação, contratos de tributos, obras e prestação de contas, escolha e sucessão da liderança.
6. **Era militar como consequência:** quartéis, classes militares, custos contínuos, projetos de torres, inteligência política, diplomacia e, finalmente, campanha territorial.

**Critérios de qualidade contínuos**: conservação de alimento, minério, madeira, pedra e moeda; ausência de teletransporte de material; decisões baseadas em informação local; determinismo por seed; população não surgindo artificialmente; custos permanentes mensuráveis; performance em 200 e 500 pawns; resistência a guerras, fome, migração e morte de um dos adultos. A simulação pode fracassar: falha auditável é preferível a sobrevivência falsa.
