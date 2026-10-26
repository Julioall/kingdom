# JUL-195 — revisão da PR #4 e integração no branch de testes

Data: 26/10/2026<br>
PR: [#4](https://github.com/Julioall/kingdom/pull/4)<br>
Branch de destino: `test/kingdom-autonomous`

## Revisão

O diff de produção foi revisado por área: transições e retenção de evidências sociais, transferência alimentar e livro de campanha, contato/obstrução de golpes, política de construção sob ameaça, limpeza dos projetos concluídos e apresentação de combate/inspetor. Os testes associados cobrem essas transições e os fluxos de Worker. A PR não tinha reviews ou threads inline anteriores.

Não encontrei um defeito bloqueador de correção nos fluxos desta fatia. Há um risco de horizonte longo a medir: `SOCIAL_FACT_LIMIT` limita fatos, mas a lista `commitments`, planos terminais em cada pessoa e fingerprints em `idempotency` não têm o mesmo limite. A retenção aberta é necessária para compromissos e evidência; não reduzir dados antes de medir e preservar idempotência. Isso não invalida o slice testado, mas a memória serializada deve ser medida pelo gate JUL-194/M6.15 antes de alegar estabilidade de longo prazo.

## Evidência revisada

- HEAD revisado: `35b02484baea0c0f9038ed276a69f10a22ba66c6`; base: `70f731163c09ac553915b576c8e0cfee9c2f2a07`.
- No HEAD revisado: `npm test` 166/166; typecheck, build e `git diff --check` aprovados.
- GitHub Actions run #40: dois check runs concluídos com sucesso no mesmo HEAD (instalação limpa, typecheck, testes, replay determinístico e build).
- Playtests registrados em `JUL-172`, `JUL-180` e `JUL-181`; a captura da ação de combate está nos artefatos da sessão de navegador. A evidência de inspeção salarial é coberta por teste determinístico; o replay visual não produziu esse evento selecionável.
- O relatório de auditoria alimentar ainda registra fome em horizonte longo; por isso JUL-178 e JUL-162 continuam abertas.

## Decisão e alternativas

Integrar esta fatia no branch de testes usando merge commit, preservando os commits individuais por issue e a cadeia de evidência. O merge é limitado a `test/kingdom-autonomous`; `main` não é alterada. A PR é uma integração incremental e não declara concluídos JUL-173, JUL-178, JUL-162/163/164 ou M6.15.

Alternativas consideradas:

1. Deixar a fatia isolada até terminar a meta inteira: rejeitada, pois o branch de teste é o ponto de integração pedido e os gates do slice estão verdes.
2. Fazer squash: rejeitada, pois apagaria a separação dos commits por issue.
3. Integrar em `main`: excluída pelo escopo autorizado.

O próximo passo mantém a meta ativa, mede o risco de retenção em replay e continua a correção causal de acesso alimentar. Nenhuma issue fica concluída sem demonstrar seus critérios completos.
