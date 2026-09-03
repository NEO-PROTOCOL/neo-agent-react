# Guia de Setup & Operação: SETUP.md

Este documento estabelece as instruções canônicas de configuração, execução, scripts e variáveis de ambiente para o projeto `neo-agent-react`.

## 1. Pré-requisitos

* **Node.js:** `>= 22.22.0`
* **Gerenciador de Pacotes:** `pnpm >= 11.24.0` (gerenciado via `corepack enable`)
- **Operação produtiva:** Railway com PostgreSQL e Redis dedicados ao runtime.
  Nenhum processo, banco ou Docker no Mac é necessário para mantê-lo ativo.
- **Desenvolvimento local opcional:** PostgreSQL e Redis de desenvolvimento,
  separados da produção. O Compose legado fornece Redis, mas não provisiona
  PostgreSQL nem a autenticação atual da API.

## 2. Preparação do Ambiente (Bootstrap)

Para preparar o monorepo pela primeira vez:

```bash
make bootstrap
```

O comando acima executa:

1. `corepack enable` para garantir o pnpm na versão declarada.
2. `pnpm install` na raiz do monorepo, resolvendo todos os pacotes (`apps/*`, `packages/*`, `services/*`).

## 3. Variáveis de Ambiente

Configure as variáveis no ambiente autorizado, sem registrar valores no Git:

- Runtime: `DATABASE_URL`, `REDIS_URL`, `RUNTIME_API_KEY`, `GEMINI_API_KEY`.
- Modelo: `PILOT_PROVIDER`, `PILOT_MODEL`; modelo do E2E datado:
  `gemini-3.8-flash`. Modelo configurado não é garantia de disponibilidade.
- Discovery: `NEO_ORCHESTRATOR_URL`, usando
  `https://orchestrator.neoprotocol.space`, e `CONTEXT_SOURCE_GITHUB_TOKEN`
  para fontes privadas autorizadas.
- Notion: `NOTION_API_KEY`, `NOTION_DATA_SOURCE_ID`, `NOTION_API_VERSION`,
  `NOTION_POLLING_ENABLED`. Compartilhar a fonte com a integração.
- Listener/UI de desenvolvimento: `PORT`, `HOST`, `WORKER_BASE_URL`.

O runtime não carrega `.env` automaticamente. Se o operador optar por arquivo
local autorizado, usar `node --env-file=../../.env server.js` dentro de
`services/worker`. Agentes não devem ler, editar ou versionar esse arquivo.
Prefira ambiente já configurado e `pnpm start:worker-api`.

`HOST=127.0.0.1` é somente local; Railway usa `0.0.0.0` por default.
`NEO_AGENT_RUNTIME_ROOT` não é necessário para rodar: a doutrina está
empacotada. Esse caminho só participa de reconstrução explícita do bundle.

> [!WARNING]
> Nunca comite valores reais de chaves de API ou segredos. Mantenha `.env` no `.gitignore`.

## 4. Scripts e Comandos Operacionais

### Comandos do Makefile

| Comando | Descrição |
| --- | --- |
| `make help` | Exibe o menu interativo com todos os comandos disponíveis |
| `make bootstrap` | Inicialização completa do ambiente e instalação de dependências |
| `make setup` | Garante o pnpm na versão correta via corepack |
| `make deps` | Instala todas as dependências do monorepo (`pnpm install`) |
| `make dev` | Sobe o Redis local via Docker e inicializa o servidor de desenvolvimento da UI |
| `make ui` | Inicia somente a interface Next.js (`apps/canvas-ui`) |
| `make worker` | Inicia o worker em modo standalone |
| `make worker-api` | Inicia a API HTTP do worker (Fastify na porta configurada) |
| `make infra-up` | Inicializa o container Redis local em background |
| `make infra-down` | Derruba os containers da infraestrutura local |
| `make infra-logs` | Acompanha os logs do Redis em tempo real |
| `make docker-dev` | Sobe a stack via Docker (canvas-ui + redis) |
| `make docker-up` | Sobe a stack completa local (redis + worker + canvas-ui) |
| `make checks` | Executa validação de tipagem (`typecheck`) e linter (`lint`) |
| `make typecheck` | Executa checagem de tipos com TypeScript no canvas-ui |
| `make lint` | Executa o ESLint no frontend |
| `make build` | Executa o build de produção do Next.js |
| `make clean` | Limpa artefatos locais comuns (`apps/canvas-ui/.next`) |
| `make reset` | Reset local sem remover lockfile/node_modules |
| `make repair` | Manutenção Nível 1: limpa e reinstala o `node_modules` |

Os alvos Docker/Redis são legados de desenvolvimento, não um provisionamento
completo do runtime atual. Não executar `make repair`, `make reset` ou
instalações isoladas de subpackages como diagnóstico automático.

### Scripts do Package.json

* `pnpm dev`: Inicia o canvas-ui em modo de desenvolvimento.
* `pnpm build`: Executa o build de produção do canvas-ui.
* `pnpm start:ui`: Inicia o servidor de produção do canvas-ui.
* `pnpm start:worker-api`: Inicia a API HTTP do worker.
* `pnpm test`: Executa todos os testes unitários (`test:pilot` e `test:runtime`).
* `pnpm test:pilot`: Executa os testes do `PilotLoop`.
- `pnpm db:migrate`: Aplica migrations no PostgreSQL configurado; exige
  autorização sobre o banco de destino.
- `pnpm pilot:run`: Trigger HTTP autenticado; retorna `202`. `--wait`
  consulta a aprovação persistida. Não é o papel Operator.

## 5. Fluxos de Desenvolvimento

### Desenvolvimento opcional

Após configurar bancos de desenvolvimento e variáveis, aplicar
`pnpm db:migrate` no banco autorizado e iniciar `pnpm start:worker-api`.
Em terminal separado, `make ui` inicia a UI em `http://localhost:3000`;
a API usa porta 4001 por default. Isso não valida o E2E da UI em produção.

### Trigger manual do loop

O worker consulta `NEO_ORCHESTRATOR_URL` antes do Operator, recupera somente
as fontes selecionadas e persiste `discovery` e `task_context` no state store.
Sem Orchestrator disponível, uma tarefa que dependa de contexto cross-node é
encaminhada pelo Guardian como `NEEDS_HUMAN`.

Com `RUNTIME_API_KEY` já disponível no ambiente, usar o exemplo versionado
com um task ID ainda não utilizado no ambiente de teste:

```bash
pnpm pilot:run -- --input examples/week-task.json --wait
```

O destino default é `http://127.0.0.1:4001`; para um runtime remoto
autorizado, informar `--base-url`. Não passar secrets em `--api-key` nem
reexecutar tarefas produtivas apenas para testar documentação.

### Notion em produção

A ingestão ocorre exclusivamente pelo adapter read-only da fonte oficial
**✅ Tarefas & Ações**, com `Incluir no Agent = true`. Não enviar uma origem
Notion fabricada pelo trigger genérico. Polling manual usa
`POST /sources/notion/poll`, Bearer `RUNTIME_API_KEY`, e body opcional
`{"page_id":"ID_DA_PAGINA"}`; resposta `202` identifica o job, não aprovação.

Contrato, schema, critérios obrigatórios, Status-only, revisão/dedupe e
reprocessamento controlado estão em [RAILWAY_DEPLOY.md](./RAILWAY_DEPLOY.md).
O polling contínuo (`NOTION_POLLING_ENABLED`) permanece desligado por
default; a ativação produtiva foi autorizada após o E2E de 2026-09-03.

### Validação determinística

```bash
env -u IFTTT_WEBHOOK_KEY pnpm test
pnpm lint
pnpm --dir apps/canvas-ui exec tsc --noEmit
git diff --check
```

O `env -u` isola o teste de uma configuração IFTTT herdada do shell;
nenhuma credencial é lida/exibida, nenhum envio real é realizado.

## 6. Contrato de Deploy e Limitações

* **Deploy em Produção:** Consulte `RAILWAY_DEPLOY.md` para instruções de deploy dos serviços independentes.
* **Isolamento de Estado:** UI e Worker não compartilham arquivos em produção; toda sincronização ocorre via HTTP e Redis Pub/Sub.
- **Fonte de verdade:** PostgreSQL (`agent_runtime`), incluindo eventos e
  approvals. Redis não substitui o ledger.
- **Recuperação:** não apagar eventos nem resetar tasks `NEEDS_HUMAN`.
  Nova tentativa controlada requer autorização e preserva a anterior.
