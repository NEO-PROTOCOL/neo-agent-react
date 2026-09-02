# Railway Deploy

```text
Status: DEPLOY IN PROGRESS / NOT VERIFIED
Mode: PERSISTENT AGENT RUNTIME
```

## Snapshot operacional — 2026-09-02

Este bloco é um handoff datado, não uma fonte de estado em tempo real. O
próximo agente deve consultar o Railway novamente antes de agir.

- projeto Railway: `neo-agent-react`;
- project ID: `aef05f36-8bd8-4ebf-a026-217f6bc2d9d9`;
- environment: `production` (`6c134e81-4eec-4440-83dd-6cf7652d0aa2`);
- serviço runtime: `neo-agent-react`
  (`6785b9c2-5e7d-490f-aa50-57a302daf02b`);
- fonte: `NEO-PROTOCOL/neo-agent-react`, branch `main`;
- commit observado: `e2e2a94605dd3e069c47e9a195fe5d303ccbda9c`;
- domínio: `neo-agent-react-production.up.railway.app`;
- Postgres, Redis e o serviço legado `worker` estavam em `SUCCESS`;
- o deployment do runtime `092dc045-d8dd-4994-8c81-47749ac9546c`
  permanecia em `DEPLOYING` no momento do snapshot.

Evidência mais recente:

- a migration `001_agent_runtime.sql` foi aplicada e emitiu
  `migration_applied`;
- a configuração efetiva observada no serviço usava
  `startCommand = pnpm db:migrate`;
- por isso o processo terminou após migrar e o healthcheck `/ready` recebeu
  `service unavailable`;
- isto ainda não prova runtime saudável nem E2E.

Ao retomar, a menor correção de configuração é manter comandos distintos:

```text
Pre-deploy Command = pnpm db:migrate
Start Command      = pnpm start:worker-api
```

Não redeployar nem alterar configuração com base apenas neste snapshot. Faça
read-before-write e obtenha autorização operacional para a mutação.

## Escopo

O primeiro runtime persistente usa um serviço de aplicação:

- `neo-agent-react-runtime`: API autenticada, workers BullMQ e schedulers;
- PostgreSQL: source of truth, no schema isolado `agent_runtime`;
- Redis dedicado: transporte BullMQ e locks operacionais;
- Notion: fonte humana read-only para a intenção semanal;
- Resend, Telegram e IFTTT: transportes assíncronos via outbox.

O serviço deve usar a raiz deste repositório como Root Directory, porque
`services/worker` depende de `packages/engine` via `workspace:*`.

## Configuração do serviço

O arquivo `railway.json` define:

- build com Railpack e instalação congelada;
- migration PostgreSQL no pre-deploy;
- início com `pnpm start:worker-api`;
- readiness em `/ready`;
- restart `ON_FAILURE` e uma réplica inicial.

Se o painel Railway possuir overrides manuais, a configuração efetiva pode
divergir de `railway.json`. Sempre compare os dois antes de diagnosticar.

Não existe deploy autorizado por este documento. A criação ou alteração de
serviços Railway depende de aprovação operacional.

## Variáveis

Runtime obrigatório:

- `DATABASE_URL`
- `REDIS_URL`
- `RUNTIME_API_KEY`
- `GEMINI_API_KEY`
- `NEO_ORCHESTRATOR_URL`
- `CONTEXT_SOURCE_GITHUB_TOKEN` (read-only; necessário para fontes privadas)

Variáveis locais que não pertencem ao Railway:

- `HOST=127.0.0.1`: restringe o listener ao Mac; em cloud o worker usa o
  default `0.0.0.0`;
- `NEO_AGENT_RUNTIME_ROOT=/Users/...`: serve apenas para reconstruir localmente
  o bundle de doutrina já versionado em `packages/engine/pilot`.

Notion:

- `NOTION_API_KEY`
- `NOTION_DATA_SOURCE_ID`
- `NOTION_API_VERSION`
- `NOTION_INTENTION_PROPERTY`
- `NOTION_ACCEPTANCE_CRITERIA_PROPERTY`
- `NOTION_CONSTRAINTS_PROPERTY`
- `NOTION_STATUS_PROPERTY`
- `NOTION_READY_VALUE`

Resend e Telegram:

- `RESEND_PROVIDER_URL`
- `TELEGRAM_PROVIDER_URL`
- `PROVIDER_SECRET` ou `NEXUS_SECRET`
- `AGENT_EMAIL_TO`
- `AGENT_EMAIL_FROM`
- `AGENT_EMAIL_SENDER_NAME`
- `AGENT_TELEGRAM_CHAT_ID`

No corte atual, os adapters Resend e Telegram chamam providers HTTP internos
por `RESEND_PROVIDER_URL` e `TELEGRAM_PROVIDER_URL`, autenticados por
`PROVIDER_SECRET` ou `NEXUS_SECRET`. A mera presença de `RESEND_API_KEY` ou
`TELEGRAM_TOKEN` no serviço não ativa envio direto, pois esses nomes não são
consumidos pelos adapters atuais.

IFTTT:

- `IFTTT_ENABLED`
- `IFTTT_WEBHOOK_KEY`
- `IFTTT_EVENT_NAME`

O adapter IFTTT permanece desabilitado se a configuração estiver incompleta.

## Comandos de validação

```bash
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm test
mise exec -- pnpm lint
mise exec -- pnpm build
```

Com `DATABASE_URL` configurado, validar a migration antes do deploy:

```bash
mise exec -- pnpm db:migrate
```

## Gates antes do deploy

- escolher explicitamente o PostgreSQL Railway e validar isolamento do schema;
- criar Redis dedicado ao runtime;
- configurar `RUNTIME_API_KEY` sem expor seu valor;
- validar `NEO_ORCHESTRATOR_URL` contra o endpoint `/api/discovery/context`;
- configurar `CONTEXT_SOURCE_GITHUB_TOKEN` com acesso read-only somente às fontes privadas selecionadas;
- compartilhar a data source do Notion com a integração e definir seu ID;
- validar conectividade autenticada com Resend e Telegram;
- configurar o evento IFTTT somente se o canal for ativado;
- executar migration, readiness e um E2E controlado;
- aprovar manualmente o deploy definitivo.

## Ordem de verificação após propagação

1. Deployment atingir estado terminal; `DEPLOYING` não é sucesso.
2. Confirmar nos logs que a migration ocorreu antes do processo HTTP.
3. Confirmar `GET /live` com HTTP `200`.
4. Confirmar `GET /ready` com HTTP `200` e dependências saudáveis.
5. Disparar uma task autenticada e controlada, esperando `202`.
6. Confirmar persistência, discovery cross-node e recuperação após restart.
7. Validar cada canal de notificação separadamente.

Healthcheck saudável não substitui o E2E, e falha de provider opcional não deve
bloquear o loop principal.
