# Organização dos assets

Os recursos são organizados pelo uso no jogo. Autor e pacote não definem pastas de mídia. Um pacote permanece agrupado somente quando existe uma dependência técnica, como uma dependência de terceiros com arquivos relacionados.

Os componentes de interface são código próprio do projeto. Painéis e medidores usam módulos ES com nomes funcionais, sem uma marca de biblioteca ou variáveis globais.

## Estrutura

```text
public/assets/
  catalog.json
  sprites/
    characters/       # militares, moradores e bonecos de treino
    animals/
    buildings/        # construções por paleta e estágios de construção
    terrain/          # terrenos e água
    vegetation/       # árvores, arbustos, tocos e cultivo
    resources/        # madeira, carne, rochas, minérios e suas animações
    environment/      # nuvens
    decorations/
    effects/          # poeira, impacto, morte e parry
  ui/
    branding/
    buttons/
    cursors/
    frames/
    hud/
    icons/
    indicators/
    ribbons/
  audio/
    music/
    sfx/              # ambiente, combate, personagens, construção, magia etc.
      manifest.json
src/ui/components/       # componentes próprios de painéis e medidores
src/vendor/              # reservado a dependências de terceiros, quando necessário
docs/assets/             # notas de origem preservadas dos recursos integrados
```

Paletas, ações e variantes podem ter subpastas quando o carregamento ou a animação dependem delas. Formatos de áudio alternativos ficam no mesmo contexto semântico; o manifesto identifica OGG e MP3 de cada som. Isso preserva o fallback de reprodução.

## Regras de integração

1. `public/assets/` contém apenas mídia utilizada e seus catálogos. Componentes próprios ficam em `src/ui/components/`; `src/vendor/` é reservado a dependências de terceiros, quando existirem.
2. Integrar somente os arquivos necessários. Não copiar o pacote inteiro nem manter uma segunda árvore `assets/` com cópias dos mesmos recursos.
3. Registrar cada arquivo em `public/assets/catalog.json`, indicando seu consumidor. Um novo arquivo precisa de um uso verificável no jogo; cadastrá-lo não substitui essa revisão.
4. Animações são declaradas em `src/ui/animation-manifest.js`. Efeitos sonoros usam exclusivamente `public/assets/audio/sfx/manifest.json`; não manter outro manifesto com o mesmo mapeamento de eventos.
5. `src/ui/asset-paths.js` resolve os nomes lógicos dos componentes para as categorias da interface. Painéis e medidores são módulos ES próprios, importados diretamente, sem APIs globais em `window`.
6. Ao mover ou remover um recurso, atualizar o consumidor, o catálogo, os testes e as ferramentas afetadas. Verificar variantes carregadas dinamicamente, paletas, estados de animação e formatos alternativos antes de declarar um arquivo sem uso.
7. Origem e informações fornecidas com os arquivos ficam nos metadados e em `docs/assets/`, sem influenciar o caminho usado pelo renderer.

## Validação obrigatória

`npm run assets:check` verifica o inventário, arquivos não cadastrados, referências de animação, limites dos quadros, resolução de URLs da interface e arquivos de áudio registrados. O comando também faz parte de `npm run build`.

Após o build, `npm run verify:images` compara os pixels dos PNGs com os WebP publicados. O otimizador atualiza o catálogo de produção para apontar aos WebP. Alterações nos caminhos da interface ou dos sprites exigem playtest no navegador para detectar 404, falhas de carregamento e diferenças visuais.

Relatórios, capturas e resultados dessas verificações permanecem nas pastas locais ignoradas ou nos artefatos do CI.
