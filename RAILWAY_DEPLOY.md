# Railway Deploy
<!-- markdownlint-disable MD003 MD007 MD013 MD022 MD023 MD025 MD029 MD032 MD033 MD034 -->

```text
========================================
      RAILWAY DEPLOY · NEO-AGENT-REACT
========================================
Status: ACTIVE
Mode: MULTI-SERVICE
========================================
```

## ⟠ Objetivo

Documentar deploy em Railway
com serviços isolados:

- `canvas-ui` (Next.js)
- `worker` (Fastify + engine)
- `redis` (gerenciado)

────────────────────────────────────────

## ⨷ Contrato de Isolamento

- Não compartilhar arquivos entre serviços.
- Comunicação apenas por rede:
  - Redis (`REDIS_URL`)
  - HTTP (`WORKER_BASE_URL`)
- Cada serviço escala e reinicia de forma independente.

────────────────────────────────────────

## ⧉ Estratégia de Build (Importante)

`services/worker` depende de `packages/engine`
via `workspace:*`.

Por isso, no Railway:

- **não** usar `Root Directory=services/worker`
  para o serviço worker,
- **usar root do repositório**
  em ambos os serviços,
- e selecionar comando com `pnpm --filter`.

Isso evita falha de resolução de workspace.

────────────────────────────────────────

## ◬ Configuração dos Serviços

### canvas-ui

```text
Root Directory: .
Build Command:  corepack enable && pnpm install --frozen-lockfile && pnpm build:ui
Start Command:  pnpm start:ui
```

Variáveis:

- `REDIS_URL`
- `WORKER_BASE_URL`

### worker

```text
Root Directory: .
Build Command:  corepack enable && pnpm install --frozen-lockfile
Start Command:  pnpm start:worker-api
```

Variáveis:

- `REDIS_URL`
- `GEMINI_API_KEY`
- `PORT` (ou `$PORT` nativo do Railway)

### redis

- Recomenda-se Redis gerenciado no Railway
  ou provedor externo compatível.

────────────────────────────────────────

## ⍟ Observações Operacionais

- Preferir URL privada interna do Railway
  para `WORKER_BASE_URL` quando disponível.
- A rota SSE permanece no `canvas-ui`
  e consome eventos do Redis.
- O worker executa jobs e publica status
  sem acoplamento ao frontend.
