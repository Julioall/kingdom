# Kingdom

Simulação de dois reinos, seus moradores, território e ecologia, executada no navegador.

## Executar localmente

```sh
npm install
npm run dev
```

`npm run dev` inicia o Vite e o serviço de IA local. O Ollama precisa estar instalado e aberto. Confira os modelos com `npm run ai:prepare -- --check`; `npm run ai:prepare -- --pull` baixa somente os modelos que faltam. Os pesos ficam no armazenamento do Ollama e o registro local de digest fica em `.local/`, fora do Git.

Para validar o build de produção com o mesmo serviço local, execute `npm run build` e depois `npm run preview`.
