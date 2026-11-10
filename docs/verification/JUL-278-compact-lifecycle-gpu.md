# JUL-278 — Homologação ampliada do transporte compacto

**Baseline:** PR #111 (`dev`) mantém `tile-delta-compact` opcional apenas no Vite DEV; `main` protegida. O inspetor visual já consulta o Worker sob demanda (PRs #108/#109).

## 1. Paridade durante eventos

`tests/compact-actor-lifecycle.test.mjs` testa dois Workers reais com mesma seed (1 e 42): transmissão tradicional versus `tile-delta-compact`. Injeta **eventos de QA** nos dois mundos e exige equivalência completa dos dados de apresentação após `resync` e o próximo dia (`world-delta` ou snapshot), também com RNG igual.

- **Movimento:** posição, orientação, atividade visual de construção, `residentSpritePose` andando/parado e interpolador de movimento com timestamps iguais.
- **Combate:** `recordArrow` real, animação de ataque/defesa, `lastArrowSequence`, efeito de dano via `changePersonHealth`; os dados visuais sobrevivem à remoção da cognição pesada.
- **Nascimento:** `makePerson(..., true)` e `makeAnimal(..., true)` do jogo, identidade/campos de nascimento incrementados nas duas versões. São **spawns guiados pelo teste**, não reprodução emergente por casamento/gestação/abrigo.
- **Morte:** `killPerson(..., 'combat')` com efeitos de morte reais para uma pessoa; desativação de animal como fixture. Verifica `alive:false`, persistência da identidade e retorno completo do inspetor após morrer.
- **Revisões:** `resync` e próximo dia são comparados, preservando IDs, ordem de arrays, posição, ação neural usada pelo sprite, estado e tiles, sem tocar no estado autoritativo.

O teste não cria uma guerra completa nem força uma gravidez natural. A validação com batalhas emergentes e reprodução orgânica ainda é uma etapa adicional.

## 2. Diagnóstico de navegador, CPU e memória

O script `scripts/benchmark-jul278-compact-browser-ab.mjs` usa **o jogo real** em Vite com o mesmo seed e dois modos, alternando a ordem (full/compact, compact/full). Abre o mundo, mede snapshots durante a simulação rodando, sem mudar a lógica do jogo, e coleta:

- FPS, frame p50/p95 e p95 do mapa, segundo o profiler do Kingdom
- request→response p50/p95 do Worker (inclui **simulação, fila e transporte**; não mede apenas serialização), mais latência da consulta real a um personagem selecionado
- total de respostas de simulação e revisões/dias observados
- `performance.memory.usedJSHeapSize` antes/depois na página principal, quando disponível
- tamanho JSON estimado de apenas uma base inicial e a primeira atualização (sem buffers tipados dos tiles)
- renderer WebGL detectado, visibilidade da aba, erros de JavaScript, CPU e navegador

**Atenção:** o Kingdom usa Canvas 2D. O nome retornado por WebGL é apenas um sinal de dispositivo disponível, **não prova** que toda renderização Canvas 2D esteja acelerada por GPU. O heap da página **não inclui** todo o heap do Worker, nem memória de vídeo, browser ou drivers. O script não faz inspeção profunda do Worker heap.

## 3. Rodar no Windows com Chrome e GPU real

No PC de homologação, em um terminal PowerShell no diretório clonado do Kingdom:

```powershell
git checkout dev
git pull
npm ci
npx playwright install chromium
node scripts/benchmark-jul278-compact-browser-ab.mjs --headful=1 --requireGpu=1 --duration=12000 --repeats=3 --seed=42 --output=out/jul278-gpu-local.json
```

Opcionalmente, para apontar a instalação do Chrome local:

```powershell
node scripts/benchmark-jul278-compact-browser-ab.mjs --headful=1 --requireGpu=1 --chrome="C:\Program Files\Google\Chrome\Application\chrome.exe" --duration=12000 --repeats=3 --output=out/jul278-gpu-chrome.json
```

Manter a janela visível, sem extensões, downloads ou outros jogos competindo por GPU; conferir em `chrome://gpu` se o Canvas 2D está acelerado e confirmar a GPU ativa no Gerenciador de Tarefas. Não usar `--requireGpu=1` em runner de CI/headless.

Comparar **três pares ou mais** com a mesma seed, resolução e velocidade e repetir após aquecimento da aba; registrar GPU, driver, memória de vídeo e Hz do monitor. O script falha se detectar `SwiftShader`/software quando `--requireGpu=1`.

**Critério antes de habilitar por padrão:** zero regressões de render, seleção, morte/ressurgimento, combate, introspecção e reset; melhora de bytes e redução consistente do p95 do Worker sem piora relevante do p95 de frames ou heap/GC. Testar posteriormente 50/500/5.000 NPCs em escala real com instrumentação de Worker heap, trace de Chrome e acesso a GPU.

## 4. Ambiente de CI

`jul278-compact-lifecycle.yml` roda o teste de eventos e um A/B com Chromium headless/SwiftShader (`--duration=6500 --repeats=1`), publicando artefatos. Esse A/B serve para verificar **se o diagnóstico funciona e se há crashes**. Não tem duração, GPU ou repetições suficientes para concluir FPS.

**Decisão:** a opção experimental continua desativada por padrão. A máquina de estados neural permanece adiada (JUL-292).
