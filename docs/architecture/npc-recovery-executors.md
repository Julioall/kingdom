# Kingdom: recuperação e retorno da guarnição

Um controlador de NPC deve apenas selecionar a atividade; executores de ação aplicam mudanças no estado autoritativo de forma rastreável. Este módulo é o primeiro extrato dos antigos `if/else` de atividades dentro de `individuals/actions.js`.

## Responsabilidade

`src/simulation/individuals/recovery-actions.js` contém três executores:

- `executeFieldRecovery(world, person)`: soldado cansado na campanha procura o comandante de sua unidade quando separado por mais de oito células. Quando próximo, descansa no campo sem abandonar a formação, recuperando energia, ferimento e saúde dentro dos limites anteriores.
- `executeHomeRecovery(world, person)`: morador ou soldado tenta descansar em uma construção válida; se não houver, pode descansar ao ar livre. Preserva necessidade de deslocamento, recuperação, consumo de um dia e retorno após ferimentos em obra.
- `executeGarrisonReturn(world, person, militaryCenter)`: retorna ao centro válido, liberta a torre ocupada pelo arqueiro quando aplicável e atualiza o estado visual de recuperação.

As funções **não** selecionam novas ordens, recursos, serviços militares, relações políticas nem suprimentos. O controlador principal decide a prioridade com as guardas atuais; o código extraído só executa consequências já determinadas.

### Invariantes

1. Nenhuma decisão política/econômica e nenhum comando do general é criado por esses executores.
2. Um soldado ferido não deve voltar para casa só por cansaço leve se a campanha exige que permaneça na formação.
3. Recuperação não cria alimento, ouro, soldados nem desconta uma taxa fictícia.
4. A torre deixa de apontar para o arqueiro que foi enviado à guarnição.
5. Efeitos médicos continuam passando por `changePersonHealth`, preservando histórico de eventos de saúde e alterações futuras do sistema.
6. `person.state` e `person.lastLesson` continuam sendo descrições legíveis; as transições de prioridade pertencem à máquina de estados e às necessidades existentes.
7. Testes de paridade de ações, benchmarks V2/V3 e a suíte completa devem passar antes da integração. O objetivo aqui é estrutural, não uma alegação de FPS.

A próxima separação deve tratar transporte, suprimentos e produção econômica antes de remover dependências ecológicas.
