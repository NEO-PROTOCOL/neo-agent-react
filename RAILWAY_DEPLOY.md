# Railway Deploy

```text
Status: PREPARED / NOT DEPLOYED
Mode: PERSISTENT AGENT RUNTIME
```

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
