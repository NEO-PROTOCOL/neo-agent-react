# Guia de Setup & Operação: SETUP.md

Este documento estabelece as instruções canônicas de configuração, execução, scripts e variáveis de ambiente para o projeto `neo-agent-react`.

## 1. Pré-requisitos

* **Node.js:** `>= 22.22.0`
* **Gerenciador de Pacotes:** `pnpm >= 11.24.0` (gerenciado via `corepack enable`)
* **Docker & Docker Compose:** Necessário para o serviço de infraestrutura Redis local

## 2. Preparação do Ambiente (Bootstrap)

Para preparar o monorepo pela primeira vez:

```bash
make bootstrap
```

O comando acima executa:

1. `corepack enable` para garantir o pnpm na versão declarada.
2. `pnpm install` na raiz do monorepo, resolvendo todos os pacotes (`apps/*`, `packages/*`, `services/*`).

## 3. Variáveis de Ambiente

Crie o arquivo `.env` na raiz ou configure as variáveis no seu ambiente de execução:

```bash
# Conexão de Mensageria e Contexto de Execução
REDIS_URL=redis://localhost:6379

# Porta do Worker HTTP API
PORT=4001

# URL de integração entre UI e Worker
WORKER_BASE_URL=http://localhost:4001

# Provedores de IA (obrigatório para execuções cognitivas e piloto semanal)
GEMINI_API_KEY=sua_chave_aqui

# Configurações do Piloto Semanal Local (opcional)
PILOT_PROVIDER=gemini
PILOT_MODEL=gemini-3.5-flash-lite
NEO_AGENT_RUNTIME_ROOT=/Users/nettomello/neomello/neo-agent-runtime/neo-agent-runtime
```

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

### Scripts do Package.json

* `pnpm dev`: Inicia o canvas-ui em modo de desenvolvimento.
* `pnpm build`: Executa o build de produção do canvas-ui.
* `pnpm start:ui`: Inicia o servidor de produção do canvas-ui.
* `pnpm start:worker-api`: Inicia a API HTTP do worker.
* `pnpm test`: Executa todos os testes unitários (`test:pilot` e `test:runtime`).
* `pnpm test:pilot`: Executa os testes do `PilotLoop`.
* `pnpm pilot:run`: Executa uma tarefa de teste no loop do piloto.

## 5. Fluxos de Desenvolvimento

### Modo Híbrido Recomendado

1. Em um terminal, inicie a infraestrutura:

   ```bash
   make infra-up
   ```

2. Inicie a API do Worker:

   ```bash
   make worker-api
   ```

3. Em outro terminal, inicie a interface de usuário:

   ```bash
   make ui
   ```

A interface estará acessível em `http://localhost:3000` e o Worker em `http://localhost:4001`.

### Execução do Piloto Semanal Local

Para rodar o ciclo autônomo de agentes (`Operator -> Planner -> Executor -> Reviewer -> Guardian`):

```bash
pnpm pilot:run -- --input /caminho/para/week-task.json
```

## 6. Contrato de Deploy e Limitações

* **Deploy em Produção:** Consulte `RAILWAY_DEPLOY.md` para instruções de deploy dos serviços independentes.
* **Isolamento de Estado:** UI e Worker não compartilham arquivos em produção; toda sincronização ocorre via HTTP e Redis Pub/Sub.
