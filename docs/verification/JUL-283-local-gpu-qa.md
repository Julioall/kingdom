# JUL-283 — QA local na GPU real (execução humana obrigatória)

Este roteiro **não foi executado por CI e não constitui aceite**. Requer computador e observação do desenvolvedor.

## Preparação
1. Sincronize a branch `dev` e anote `git rev-parse HEAD`. Não use `main`.
2. `npm install` e `npm run dev:vite` em um terminal.
3. Em outro terminal, preferencialmente no Chrome com aceleração de hardware: `CHROME_PATH=/caminho/para/chrome node scripts/capture-jul283-local.mjs --duration-ms=30000 --output=out/jul283-local`. No Windows PowerShell, atribua `$env:CHROME_PATH` previamente, se necessário. Sem `CHROME_PATH`, Playwright usará seu navegador instalado.
4. O script abre a página na semente 42 com profiler, captura três cenários com 30 s cada (pausado, zoom e simulação ativa), captura erros JavaScript, screenshots e exporta `out/jul283-local/report.json`.
5. Informe sistema operacional, modelo/driver da GPU, navegador, resolução, DPR, SHA, flags de IA/LLM, GPU utilizada e os artefatos no Linear.

## Verificação manual adicional
- Inspecione no DevTools > Performance e Memory: input latency, CPU, GPU, heap/GC, uso do Worker e long tasks. A API de profiler não mede diretamente tempo da GPU.
- Confira seleção e movimentação, personagem controlado, zoom/pan, menus, formações, rei/general, combate, efeitos, áudio e salvamento/recuperação **apenas de saves sintéticos**.
- Execute baseline com mesmo cenário, versão do navegador, resolução, flags e semente, se disponível. Faça 3 rodadas por cenário para distinguir variabilidade.
- Liste erros reproduzíveis, passos, imagens e evidência de rollback. Abra bugfix separado para regressões.

## Critério para fechar
Relatório + screenshots + observações humanas anexados a JUL-283, sem regressão crítica reproduzível ou com correção verificada. Nem um script Playwright headless nem resultados de Linux CI substituem esse aceite humano.
