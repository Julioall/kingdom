# Kingdom no GitHub Pages

A versão pública é compilada automaticamente a partir da branch `main` com
`npm run build`, usando Vite e `GITHUB_PAGES_BASE=/kingdom/`.

- Site: https://julioall.github.io/kingdom/
- Workflow: `.github/workflows/deploy-pages.yml`
- Assets: `scripts/prepare-pages.mjs` corrige URLs absolutas de assets
  que são construídas dinamicamente no código; os assets da compilação
  passam pelo conversor WebP já existente.
- `dev` não aciona o deploy, apenas o CI de desenvolvimento.
- A simulação e o Worker de jogo são executados no navegador.
  O GitHub Pages é hospedagem estática: ele **não** executa o servidor
  `src/ai/ollama-service.mjs`. Funcionalidades de IA que exijam
  Ollama local não estão disponíveis no site sem uma solução própria.

## Ativar o Pages uma vez

Um administrador deve abrir **Settings → Pages → Build and deployment** no
repositório e escolher **Source: GitHub Actions**. Depois, em **Actions → Deploy
Kingdom to GitHub Pages**, executar **Run workflow** (branch `main`) se o
primeiro deploy tiver falhado por falta dessa configuração.

Após a ativação, novos commits em `main` publicam automaticamente uma nova
versão. Para fazer uma compilação de verificação em outra máquina:

```sh
npm ci
GITHUB_PAGES_BASE=/kingdom/ npm run build
GITHUB_PAGES_BASE=/kingdom/ node scripts/prepare-pages.mjs
```
