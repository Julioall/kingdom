# Assets

Ao trabalhar com recursos visuais ou áudio, seguir [docs/architecture/assets.md](docs/architecture/assets.md).

- Organizar mídia por função no jogo em `public/assets/`, sem divisões por autor ou pacote.
- Manter pacotes agrupados somente por dependência técnica; código de terceiros fica em `src/vendor/`. Componentes próprios ficam em `src/ui/components/`, sem marcas aleatórias ou APIs globais.
- Registrar arquivos e consumidores em `public/assets/catalog.json`. Não adicionar pacotes inteiros ou cópias de recursos sem consumo real.
- Atualizar referências, variantes dinâmicas e testes ao mover arquivos. Executar `npm run assets:check` e o build; validar no navegador quando alterar caminhos de mídia.
- Manter capturas, logs e relatórios gerados fora dos arquivos versionados de produção.
