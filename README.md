![neo-agent-react banner](./docs/assets/neo-agent-react-banner.svg)

# NEO Agent React
<!-- markdownlint-disable MD003 MD007 MD013 MD022 MD023 MD025 MD029 MD032 MD033 MD034 -->

```text
========================================
      NEO-AGENT-REACT · RUNTIME
========================================
Status: ACTIVE
Mode: DISTRIBUTED SERVICES
Package Manager: pnpm@11.24.0
========================================
```

## ⟠ Objetivo

`neo-agent-react` implementa runtime de agentes NEO
com canvas visual em Next.js,
estado reativo via Zustand,
e execução persistente via worker, PostgreSQL e BullMQ/Redis no Railway.
O frontend não é soberano e não é necessário para o polling Notion.

────────────────────────────────────────

## ⧉ Estrutura

```text
neo-agent-react/
├── apps/
│   └── canvas-ui/          # Next.js + React Flow + SSE bridge
├── packages/
│   └── engine/             # Worker core, schemas, runner, skills
├── services/
│   └── worker/             # API/runner HTTP do worker
├── docker-compose.yml      # stack local separada
├── Makefile                # comandos operacionais
└── RAILWAY_DEPLOY.md       # contrato de deploy Railway
```

────────────────────────────────────────

## ⨷ Execução Local

Consulte o [SETUP.md](./SETUP.md) para detalhes completos de variáveis de ambiente, catálogo de scripts e modos de execução.

`make bootstrap` instala dependências na raiz deste repo. Docker local não
é requisito do runtime Railway. O Compose legado não provisiona o PostgreSQL
e a autenticação atuais; não representa a stack produtiva completa.

Serviços padrão:

- UI: `http://localhost:3000`
- Worker API: `http://localhost:4001`
- Redis: `redis://localhost:6379`

### Loop semanal persistente

```text
Notion → WeekIntent → PostgreSQL → Context Discovery
→ Operator → Planner → Executor → Reviewer → Guardian → Approval
```

Notion fornece intenção humana; PostgreSQL preserva estado e evidência.
Redis transporta jobs, não substitui o ledger. O Executor não recebe tools.
O trigger/CLI apenas solicita execução autenticada; Operator é um papel
explícito do loop. Polling e revisões Notion seguem o contrato em
[RAILWAY_DEPLOY.md](./RAILWAY_DEPLOY.md).

`PILOT_MODEL` seleciona o modelo do adapter sem alterar o `PilotLoop`.
O Guardian permite no máximo uma repetição e bloqueia efeitos externos.

────────────────────────────────────────

## ◬ Contrato de Runtime

- UI e worker são serviços independentes.
- Tasks, eventos append-only, approvals e outbox vivem no PostgreSQL.
- Fonte Notion: `Incluir no Agent = true`; Status não é gate de execução.
- Integração entre serviços ocorre por:
  - Redis Pub/Sub
  - HTTP (`WORKER_BASE_URL`)
- Não há compartilhamento de arquivos
  entre serviços em produção.

────────────────────────────────────────

## ⍟ Deploy

Use `RAILWAY_DEPLOY.md` como fonte operacional.

Ele define:

- comandos por serviço,
- variáveis obrigatórias,
- e estratégia segura para workspace `pnpm`
  com `services/worker` consumindo `packages/engine`.
