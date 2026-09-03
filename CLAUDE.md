# CLAUDE.md

## Instruções Úteis

Este arquivo serve como contexto de inicialização para agentes Claude ou interfaces associadas atuando na manutenção ou expansão deste repositório.

Leia `AGENTS.md` primeiro. Ele concentra os invariantes de Notion,
discovery, persistência append-only, parsing estrito e safe commit/push.
Use `SETUP.md` para comandos; não reconstruir o piloto Redis-only antigo.

### Comandos Frequentes

- Instalar dependências: `make bootstrap`, na raiz deste repo.
- Testes: `pnpm test`; lint: `pnpm lint`.
- Tipagem: `pnpm --dir apps/canvas-ui exec tsc --noEmit`.
- API: `pnpm start:worker-api`, com ambiente autorizado e bancos configurados.
- Frontend de desenvolvimento: `make ui` (porta 3000).

Docker local não é necessário para operar o Railway. O Compose legado não
provisiona PostgreSQL/autenticação do runtime persistente e não é um E2E.

## Runtime Persistente

Antes de atuar no Railway, leia `RAILWAY_DEPLOY.md`. O documento contém o
contrato canônico e um snapshot operacional datado; confirme o estado ao vivo
porque um snapshot não prova o estado atual.

Não troque os comandos de função:

- pre-deploy: `pnpm db:migrate`;
- start: `pnpm start:worker-api`.

Não leve `HOST=127.0.0.1`, caminhos absolutos do Mac ou valores de secrets para
o runtime Railway. Deploy `SUCCESS`, `/ready` saudável e E2E real são gates
distintos e devem ser reportados separadamente.

O snapshot de 2026-09-03 em `RAILWAY_DEPLOY.md` comprova Notion → Approval,
Status-only sem reexecução, restart e polling automático idempotente.
Preserve as tentativas históricas `NEEDS_HUMAN`; recovery exige autorização
e nova tentativa vinculada, nunca reset ou sobrescrita.
