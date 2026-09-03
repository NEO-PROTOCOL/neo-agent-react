# Railway Deploy

```text
Status: NOTION E2E APPROVED / CONTINUOUS POLLING VERIFIED
Mode: PERSISTENT AGENT RUNTIME
```

## Snapshot operacional — 2026-09-03

Este snapshot substitui as conclusões operacionais de 2026-09-02 abaixo,
preservadas como histórico. Não substitui consultas ao runtime atual.

- runtime Railway: `neo-agent-react`, mesmo projeto/serviço abaixo;
- Dockerfile build e deployment verificados como `SUCCESS`;
- upload do código: `09e58672-a96e-43b6-a32a-3391ff14ed72`;
- restart com polling habilitado: `70a1c557-8a8a-4a21-8754-5079ba676e5b`;
- `GET /ready`: HTTP `200`, Postgres/Redis/discovery/Notion `ok`;
- código enviado pelo CLI a partir do working tree, sem novo commit naquele
  momento; publicação posterior deve ser identificada pelo histórico Git;
- Git HEAD base: `48b26c7`; não representa sozinho o código desse upload;
- nenhuma migration nova, mudança de provider de notificação ou de serviço.

A fonte oficial é **✅ Tarefas & Ações**, data source
`af8aafe2-3a5c-41c9-b707-8bb55bdfb14d`. O adapter não escreve no Notion.

### Contrato de ingestão

- Seleção exclusivamente por `Incluir no Agent = true`.
- `Status` não é gate; alteração isolada gera `NOTION_STATUS_CHANGED` e
  atualiza a observação persistida, sem executar novamente o loop.
- `Descrição` contém `Contexto:`, `Critérios de aceite:` e `Restrições:`.
  Critérios ausentes resultam em `NEEDS_HUMAN`; não são inventados.
- Page ID, revisão Notion, checksum, organização, projeto, domínio,
  prioridade, datas e responsável permanecem no contexto de origem.
- Conteúdo executável, prioridade e datas relevantes compõem a revisão
  processável; repetir o mesmo snapshot não cria execução.
- Routing exige correspondência comprovada com o registry canônico.
  Sem correspondência: `current_node = null`, `routing_status = UNRESOLVED`.

### E2E e preservação de histórico

Página única: `3d08c6e8-3be0-8143-ba82-d2885fc0912b`, tarefa
`Preparar checklist mínimo da semana`.

As três tentativas da mesma página compartilham o prefixo
`notion-3d08c6e83be08143ba82d2885fc0912b-`:

| Sufixo da tentativa | Resultado preservado | Eventos |
| --- | --- | ---: |
| `f0add7eaed203cb6ef13932f` | `NEEDS_HUMAN` | 18 |
| `retry-711cb352570fcd4ab0e1d56e` | `NEEDS_HUMAN` | 13 |
| `retry-447cd521a521ff566d8fda4a` | `APPROVED` | 24 |

Não são três tarefas Notion: são tentativas auditáveis vinculadas, sem
reescrever a aprovação anterior. A última foi aprovada em
`2026-09-03T08:51:52.406Z`, pela regra
`LOW_RISK_LOCAL_EVIDENCE_PASS`, com artefato `- [ ] Revisar backlog`.

Cadeia da tentativa aprovada, por sequence persistida:

```text
31 intent → 32 controlled_retry → 33 source_observation
35 DISCOVERING → 36 discovery → 37 task_context → 38 memory
39 OPERATING → 40 provider_diagnostic → 41 task
42 PLANNING → 43 provider_diagnostic → 44 plan
45 EXECUTING → 46 provider_diagnostic → 47 execution_1
48 REVIEWING → 49 provider_diagnostic → 50 review_1
51 guardian_1 → 52 approval → 53 APPROVED
54 notion_status_changed → 55 source_observation
```

O discovery foi avaliado e persistido como `not_required`, com justificativa
`no_cross_node_match`: a tarefa só formata texto fornecido. Isto não constitui
prova de integração cross-domain. A memória opcional ficou `unavailable`.

Após a aprovação, alteração humana somente de `Doing` para `Concluído`
gerou os eventos 54/55. Polling manual autenticado retornou `202` (job `729`),
sem nova tarefa/job agentic. Operator/Planner/Executor/Reviewer/Approval
permaneceram com uma execução cada nessa tentativa. Repetir a mesma chave
de reprocessamento retornou `claimed=false`, `job_id=null`.

Os hashes dos 16 eventos originais permaneceram iguais. Os 53 eventos
anteriores à mudança de Status e as três aprovações também permaneceram
iguais. Após restart foram confirmados os mesmos 55 eventos e resultados.
As três cadeias de payload/event hashes foram recalculadas e validadas.

### Diagnóstico do bloqueio de JSON

Provider/modelo: `gemini` / `gemini-3.8-flash`. O runner já utilizava
`application/json` com schema nativo. O orçamento de 2048 tokens foi
consumido majoritariamente por thinking e a resposta terminou truncada
(`MAX_TOKENS`), antes da validação do contrato do Executor.

A resposta bruta da falha original não havia sido persistida. Uma
reprodução controlada com a configuração/contexto persistidos comprovou:
243 bytes, string não terminada na posição 243 em `JSON.parse`, 1915 tokens
de thinking e 118 de saída. Diagnóstico append-only no evento 17, checksum:

```text
11e31379eb6d8c808abb5e256840592ba879927205754b9036b1c9822a3e811b
```

Na primeira tentativa controlada, o mesmo gap foi comprovado no Operator:
`MAX_TOKENS`, 1963 tokens de thinking, 71 de saída; evento 27. Somente
Executor e Operator passaram a 8192 tokens. Planner/Reviewer ficaram em
2048. O patch não troca modelo, não adiciona tools e não repara JSON.

Os diagnósticos agora registram provider/modelo, motivo de conclusão,
contagem de tokens, checksum, tamanho, erro de parsing e referência de
schema. Fragmentos de falha retêm apenas estrutura JSON mascarada, sem
valores/chaves/prosa. Resposta incompleta ou JSON inválido é rejeitado;
remoção de fence Markdown, já existente, passa a ser explicitamente
registrada. Falha de schema do Executor também recebe registro estruturado.

### Reprocessamento controlado

Executar somente com aprovação do operador, dentro do container existente
(via Railway SSH), usando IDs comprovados e uma chave estável por pedido:

```bash
node /app/services/worker/scripts/reprocess-task.mjs \
  --task TASK_ID_DA_TENTATIVA_BLOQUEADA \
  --request CHAVE_IDEMPOTENTE_DO_PEDIDO --approve
```

O comando aceita somente o bloqueio de saída inválida autorizado e o caso
comprovado de truncamento do Operator dentro dessa recuperação. Cria uma
nova tentativa vinculada em transação e mantém approvals/eventos antigos.
Não é retry automático, não altera conteúdo Notion e recusa tarefas já
aprovadas ou com observação de origem posterior. Para consultar/repetir um
pedido, reutilizar o mesmo parent ID e a mesma chave; não inventar outra.

### Operação do polling

`NOTION_POLLING_ENABLED=true` habilita o scheduler BullMQ `notion-poll`, a
cada 600000 ms, com `continuous: true`. Foi ativado somente após o E2E e a
prova de Status sem reexecução. `/ready` deve mostrar `notion: ok` e
`notion_polling: enabled`. Para desligar, definir a variável como `false`
e aplicar novo deployment; o polling manual continua disponível em
`POST /sources/notion/poll`, autenticado com `RUNTIME_API_KEY`.

O primeiro disparo durante a sobreposição do restart retornou `disabled`;
não foi contado como prova de leitura automática. O ciclo automático
`repeat:notion-poll:1788426248479` concluiu em
`2026-09-03T09:04:09.123Z`, com `continuous: true` e resultado:

```json
{
  "source_status": "ok",
  "accepted": [{
    "task_id": "notion-3d08c6e83be08143ba82d2885fc0912b-retry-447cd521a521ff566d8fda4a",
    "claimed": false,
    "operational_change": false,
    "job_id": null
  }]
}
```

Não houve nova execução. O scheduler permaneceu ativo a cada 10 minutos,
sem dependência do Mac. Integração Notion operacional neste snapshot.

Validações: 52 testes determinísticos (14 piloto + 38 runtime), lint,
typecheck da UI e `git diff --check` passaram. Nenhum teste enviou
notificações. O E2E não valida Resend/Telegram/IFTTT/Alexa nesta etapa.

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

Evidência do deployment anterior:

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

Esse erro motivou a migração para um `Dockerfile` explícito e a retirada do
`railway.json` legado. Confirme o estado efetivo após o próximo deployment.

## Escopo

O primeiro runtime persistente usa um serviço de aplicação:

- `neo-agent-react`: nome do serviço Railway que executa a API autenticada,
  workers BullMQ e schedulers (identidade lógica `neo-agent-react-runtime`);
- PostgreSQL: source of truth, no schema isolado `agent_runtime`;
- Redis dedicado: transporte BullMQ e locks operacionais;
- Notion: fonte humana read-only para a intenção semanal;
- Resend, Telegram e IFTTT: transportes assíncronos via outbox.

O serviço deve usar a raiz deste repositório como Root Directory, porque
`services/worker` depende de `packages/engine` via `workspace:*`.

## Configuração do serviço

O `Dockerfile` na raiz define a imagem do worker. O serviço Railway define:

- builder `DOCKERFILE`, usando `/Dockerfile`;
- migration PostgreSQL no pre-deploy;
- início com `pnpm start:worker-api`;
- readiness em `/ready`;
- restart `ON_FAILURE` e uma réplica inicial.

Na revisão de publicação de 2026-09-03, a configuração consultada via API
ainda declarava `build.builder = RAILPACK`, com fonte GitHub `main`. Isto
não deve ser confundido com prova do builder efetivo: inspecionar os logs
de cada build para confirmar o uso do Dockerfile versionado. Não alterar
infraestrutura nem declarar migração de builder só com base neste documento.

O campo **Railway Config File** deve permanecer vazio. O antigo Config as Code
por `railway.json` foi removido porque está deprecated e não deve ser adotado
por serviços novos. Não configure `railway.json` nesse campo.

O Infrastructure as Code TypeScript é project-wide. Ele não foi introduzido
neste reparo mínimo porque exige importar e revisar também Postgres, Redis e os
demais serviços antes de um `plan` seguro. Até essa reconciliação, a
configuração efetiva do serviço Railway é a autoridade de deploy.

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
- `NOTION_POLLING_ENABLED` (default `false`; ativação explícita após E2E)

O schema de propriedades é o contrato canônico de Tarefas & Ações descrito
acima; as antigas variáveis de nomes de propriedades/Status não são usadas.

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

Com Docker disponível:

```bash
docker build -t neo-agent-react-runtime:local .
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
