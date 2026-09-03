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

## 7. Uso diário e limites

### Para que usar agora

O sistema acompanha tarefas autorizadas na fonte Notion, mesmo com o Mac
desligado. Seu Executor produz texto estruturado, com revisão e evidências;
não executa livremente ações nos sistemas do ecossistema.

| Entrada na propriedade Descrição | Entrega compatível com o Executor |
| --- | --- |
| Anotações fornecidas de reunião | Resumo e checklist das ações mencionadas |
| Demanda pequena, com objetivo e restrições | Plano curto em Markdown |
| Informações de uma comunicação | Rascunho de mensagem ou briefing |
| Procedimento fornecido em texto | Checklist de conferência |

São exemplos de uso compatível, não quatro E2Es produtivos já comprovados.
A prova produtiva datada gerou exatamente `- [ ] Revisar backlog`.
Discovery pode recuperar fontes mapeadas e autorizadas; isso não concede
acesso geral aos projetos nem comprova integrações ou estado ao vivo.

### Preparar uma tarefa

1. Criar a tarefa em **✅ Tarefas & Ações**.
2. Selecionar Organização e Projeto com correspondência real no registry.
   Não escolher `neo-agent-react` apenas para contornar routing pendente.
3. Colocar o contexto necessário na propriedade **Descrição**, não apenas
   no corpo da página ou em comentários: esses conteúdos não são lidos pelo
   adapter atual.
4. Definir critérios verificáveis e restrições. Só marcar **Incluir no Agent**
   quando o conteúdo estiver pronto para processamento.

Exemplo de Descrição para uma tarefa de formatação:

```text
Contexto:
Ações fornecidas: Revisar backlog; Identificar bloqueios.
Converter somente essas duas ações em checklist Markdown.

Critérios de aceite:
- O artefato contém exatamente duas linhas.
- A primeira linha é: - [ ] Revisar backlog
- A segunda linha é: - [ ] Identificar bloqueios

Restrições:
- Não acrescentar ações, responsáveis, datas ou informações.
- Não usar ferramentas externas nem alterar qualquer sistema.
```

### Datas e mudanças humanas

- **Data Planejada e Data Limite não agendam nem adiam a execução.** Com o
  checkbox ligado, a tarefa pode entrar no próximo polling, mesmo com data
  futura. O ciclo nominal é de 10 minutos, sujeito à fila/disponibilidade.
- Datas e prioridade orientam o conteúdo; prioridade não reordena a fila.
  Alterações nesses campos compõem uma nova revisão processável.
- Mudança apenas de Status gera evento operacional e atualiza contexto,
  sem nova execução. Status `Concluído` não impede a seleção pelo checkbox.
- Desmarcar o checkbox impede novas seleções; não cancela trabalho já
  enfileirado ou em execução.
- Falta de critérios ou routing não comprovado exige atenção humana;
  não autoriza o agente a inventar critérios ou um projeto de fallback.

### Onde consultar o resultado

O adapter não escreve no Notion: não devolve o artefato à página e não muda
seu Status. O resultado e a aprovação ficam no PostgreSQL, acessíveis pela
API autenticada do runtime. Notion page ID e runtime task ID são distintos;
uma mesma página pode ter várias revisões/tentativas históricas.

- Consulta read-only: `GET /pilot/tasks/{task_id}`.
- Autenticação: header `Authorization: Bearer`, usando `RUNTIME_API_KEY`
  já disponível no ambiente autorizado, nunca na URL ou em logs.
- Resposta: `{ task_id, state }`; `state.approval` contém a decisão final.
- O artefato fica em `state.execution_1.action.output.markdown` ou
  `state.execution_2.action.output.markdown`, conforme o `review_ref` da
  aprovação (`review_1` ou `review_2`). Não escolher a tentativa 1 cegamente.
- Sem aprovação, o processamento pode estar pendente/em andamento; uma saída
  intermediária não deve ser apresentada como aprovada. Uma tarefa bloqueada
  pode não ter artefato nem `review_ref`.

Para um trigger manual, o `task_id` vem na resposta `202` e `--wait` consulta
o estado. No polling Notion, `202` retorna apenas o `job_id`; um operador
autorizado pode localizar as tentativas da página com esta consulta read-only
no PostgreSQL (substituir somente o page ID confirmado):

```sql
SELECT task_id, status, source_revision, created_at
FROM agent_runtime.tasks
WHERE source_type = 'notion'
  AND source_ref = 'notion:PAGE_ID_CONFIRMADO'
ORDER BY created_at DESC;
```

Preservar e distinguir as tentativas: uma aprovação nova não apaga os
`NEEDS_HUMAN` anteriores. A API acima retorna o contexto por chave; o
histórico completo permanece no ledger `agent_runtime.task_events`.

### O que Approval não significa

`APPROVED` significa que o artefato passou pelo Reviewer e pelas regras do
Guardian para aquela revisão e escopo. Não é aprovação humana, garantia de
verdade factual nem confirmação de uma ação externa concluída.
`NEEDS_HUMAN` interrompe a automação e preserva a causa para análise;
não é resolvido automaticamente mudando o Status no Notion.

O runtime atual não edita código, faz push/deploy, publica conteúdo,
efetua pagamentos ou acompanha e-mails/reuniões fora da fonte autorizada.
Uma tarefa "enviar mensagem" pode gerar um rascunho, não enviá-lo pelo
Executor. Canais de notificação são transportes separados, não tools dele.

Resend/Telegram/IFTTT e memória opcional têm validação independente.
`configured` não significa entregue; `APPROVED` não prova notificação.
Consultar o snapshot datado e revalidar antes de prometer qualquer canal.
Não apresentar o sistema como assistente que observa todo o trabalho do
operador, nem como memória transversal já comprovada.
