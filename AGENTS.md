# AGENTS.md

## Regras de Comportamento para LLMs e Agentes Locais

Ao atuar neste projeto, todos os agentes devem adotar o seguinte comportamento padrão:

1. **Inspeção Baseada na Realidade (Runtime Beats Docs):** Antes de assumir que o ambiente de runtime se comporta da forma sugerida, verifique os imports, configurações e arquivos locais na branch `main`. A realidade do repositório se sobrepõe a anotações esquecidas.
2. **Isolamento de Alterações:** Mudanças que afetem UI devem ser testadas/pensadas isoladas das mudanças que afetam o Worker.
3. **Segurança e Estratégia de Workspace (pnpm):**
   - Modificações envolvendo gerenciamento de pacotes (`pnpm-workspace.yaml`, `package.json` raíz) exigem altíssimo escrutínio e aprovação explícita, pois quebram as ligações vitais entre `packages/`, `apps/` e `services/`.
   - **Instalação Unificada:** Em monorepos configurados com `pnpm-workspace.yaml`, **nunca** utilize instalações isoladas (`pnpm --dir <subpasta> install`), pois isso rompe a vinculação de pacotes internos (`workspace:*` ou `file:..`). Sempre execute `pnpm install` diretamente na raiz.
   - **Proteção de Build (pnpm@11+):** Caso a instalação pare com o erro `[ERR_PNPM_IGNORED_BUILDS]` (ex: em pacotes como `sharp`, `sqlite3` ou `esbuild`), não tente reinstalar ou remover lockfiles. O agente deve instruir o usuário ou rodar `pnpm approve-builds` para autorizar a compilação nativa.
4. **Respostas Estruturadas:** Mantenha verbosidade técnica, separando diagnósticos e planos de ação. Nunca esconda estados de erro reais por detrás de fallbacks não implementados.

## Handoff Operacional Obrigatório

Ordem de leitura: este arquivo → `README.md` (conceito) → `SETUP.md`
(comandos) → `RAILWAY_DEPLOY.md` (contratos e evidência datada).
`CODEX.md` e `CLAUDE.md` são entradas complementares, não políticas paralelas.
Não há `CONTEXT.md`, `MEMORY.md`, `SKILL.md` ou `.codex` próprios deste repo;
use a hierarquia superior e este handoff, sem criar cópias por padrão.

Antes de diagnosticar, alterar ou publicar o runtime persistente:

1. Leia `RAILWAY_DEPLOY.md`, inclusive o snapshot operacional datado.
2. Trate o estado Railway como evidência externa mutável: confirme-o novamente
   antes de afirmar que o deploy, o healthcheck ou o E2E estão concluídos.
3. Preserve a separação entre migration e processo HTTP:
   `pnpm db:migrate` é pre-deploy; `pnpm start:worker-api` é start.
4. Nunca registre valores de variáveis. Consulte e documente somente nomes e
   presença quando isso for necessário.
5. `HOST=127.0.0.1` e `NEO_AGENT_RUNTIME_ROOT=/Users/...` são configurações
   locais. Não devem ser copiadas para Railway.

## Invariantes do Runtime e da Fonte Notion

- PostgreSQL, schema `agent_runtime`, é a fonte de verdade de tasks, eventos
  append-only, approvals e outbox. Redis Railway serve BullMQ e locks.
- Fonte humana: **✅ Tarefas & Ações**. O adapter é read-only e seleciona
  exclusivamente `Incluir no Agent = true`; `Status` nunca é gate.
- Status-only atualiza contexto e gera evento operacional, sem reexecução.
  Conteúdo executável alterado cria revisão processável; snapshot repetido
  não cria duplicatas. Preserve page ID, revisão e metadata de origem.
- Sem critérios de aceite: `NEEDS_HUMAN`. Sem correspondência comprovada:
  `current_node = null`, `routing_status = UNRESOLVED`. Nunca inventar.
- Antes do Operator, avalie discovery no Orchestrator canônico; persistir
  resultado ou justificativa de `not_required`. Falha é `unavailable`,
  nunca prova de inexistência. Conhecimento não comprova integração.
- Guardian determinístico, Executor sem tools externas, retry do loop
  limitado a 1. Reprocessamento humano é uma nova tentativa vinculada,
  não reset: nunca apagar eventos ou sobrescrever `NEEDS_HUMAN`/Approval.
- JSON incompleto/inválido não é aceito. Preserve schema nativo e diagnóstico
  estruturado com checksum/provider/modelo; não persistir saída bruta sensível.
- Polling contínuo depende de `NOTION_POLLING_ENABLED`; liga/desliga requer
  aplicação no Railway. E2E, readiness e idempotência são provas distintas.
- Não alterar outros nós, providers, secrets ou infraestrutura fora do escopo
  autorizado. Não usar documentos históricos como autorização de deploy.

## Validação e Publicação

Rodar `pnpm test`, `pnpm lint`, `pnpm --dir apps/canvas-ui exec tsc --noEmit`
e `git diff --check`. Se o shell tiver `IFTTT_WEBHOOK_KEY` herdada, executar
os testes com `env -u IFTTT_WEBHOOK_KEY pnpm test`, sem ler/exibir o valor.
Testes determinísticos não autorizam chamadas produtivas.

Safe commit/push: confirmar Git root, diff, arquivos novos, remote SSH e
upstream; stage explícito; revisar cached diff; commit assinado; push sem
force; confirmar HEAD remoto e working tree limpo. Um push de `main` pode
acionar Railway: conferir build efetivo, deployment terminal e `/ready`.
