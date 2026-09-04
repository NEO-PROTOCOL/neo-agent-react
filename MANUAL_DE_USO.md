# Manual de Uso

Este manual explica como usar o `neo-agent-react` como operador. Para
instalação, desenvolvimento e manutenção, use [SETUP.md](./SETUP.md). Para
evidências datadas e configuração Railway, use
[RAILWAY_DEPLOY.md](./RAILWAY_DEPLOY.md).

## Estado atual

- **Operacional:** ingestão read-only da base Notion **✅ Tarefas & Ações**,
  polling a cada 10 minutos, processamento persistente e Approval no
  PostgreSQL.
- **Disponível:** preflight de discovery pelo NEO Orchestrator. O readiness
  está saudável; o E2E Notion observado decidiu `not_required` e não comprova
  sozinho uma consulta cross-domain produtiva.
- **Pronto para validação final:** canal Alexa no Railway. Readiness saudável
  não substitui o E2E assinado no simulador nem a prova de retomada de sessão.
- **Disponíveis no código local:** skills de Calendário, Lembretes e
  decomposição de tarefas no Mac. O teste atual não comprova permissões reais
  dos apps e elas não fazem parte do runtime Linux do Railway.
- **Separados do loop:** Resend, Telegram e IFTTT são transportes de
  notificação. `configured` não comprova entrega.

Confirme o estado mutável do runtime antes de operar:

```bash
curl -fsS https://neo-agent-react-production.up.railway.app/ready
```

O resultado esperado contém `"ok":true`. Cada integração possui também seu
próprio estado; não inferir E2E apenas pelo readiness.

## Uso diário pelo Notion

### 1. Criar a tarefa

Na base **✅ Tarefas & Ações**, preencha:

- `Tarefa`;
- `Domínio`;
- `Organização`;
- `Projeto`;
- `Descrição`;
- datas e prioridade quando forem relevantes;
- `Responsável`;
- `Incluir no Agent` somente quando o conteúdo estiver pronto.

`Status` não autoriza nem impede execução. O único gate de seleção é
`Incluir no Agent = true`.

### 2. Escrever a descrição

Use este formato:

```text
Contexto:
Explique o resultado desejado e forneça os dados necessários.

Critérios de aceite:
- Defina uma condição objetiva e verificável.
- Defina exatamente o formato esperado, quando aplicável.

Restrições:
- Diga o que não pode ser inventado, alterado ou executado.
```

Sem critérios de aceite, a tarefa termina em `NEEDS_HUMAN`. O agente não cria
critérios em nome do operador.

### 3. Permitir o processamento

Marque `Incluir no Agent`. O polling nominal ocorre a cada 10 minutos. O
sistema então executa:

```text
Notion → WeekIntent → PostgreSQL → Context Discovery
→ Operator → Planner → Executor → Reviewer → Guardian → Approval
```

Não é necessário manter o Mac ligado. Desmarcar o checkbox impede novas
seleções, mas não cancela uma execução já enfileirada.

### 4. Interpretar o resultado

- `APPROVED`: o artefato daquela tentativa passou pelo Reviewer e pelo
  Guardian; não significa aprovação humana nem conclusão do trabalho real.
- `NEEDS_HUMAN`: faltou informação, routing comprovado ou resposta válida;
  a causa permanece no histórico.
- Alterar somente `Status` atualiza o contexto e cria evento operacional, sem
  executar novamente Planner ou Executor.
- Alterar descrição, critérios, restrições, prioridade ou datas relevantes
  cria uma nova revisão processável.

O adapter não escreve o artefato de volta no Notion e não muda o Status.
Resultados, eventos e approvals permanecem no PostgreSQL.

## Consultar uma tarefa pela Alexa

O canal Alexa é read-only e consulta apenas IDs explicitamente autorizados em
`ALEXA_TASK_IDS`. Ele não altera tarefas, agenda compromissos ou executa ações.

No primeiro E2E, use a tarefa autorizada
`Preparar checklist mínimo da semana`:

```text
abrir neo assistente
Como está Preparar checklist mínimo da semana?
E os critérios de aceite?
encerrar
abrir neo assistente
```

Na última abertura, o Neo deve retomar a tarefa anterior. Isso prova uma
sequência diferente de `/ready`: requisição assinada, consulta ao PostgreSQL,
continuidade entre turnos e recuperação de contexto persistente.

O perfil escolhido para avaliação é Ricardo, velocidade `105%`, volume
`medium`, sem alteração de pitch e com pausas curtas de `200ms`. Enquanto o
runtime responder `PlainText`, essa escolha no simulador é apenas uma prévia;
aplicá-la à Skill real exige uma mudança de código separada e validada.

## Consulta técnica read-only

Com um `task_id` confirmado e `RUNTIME_API_KEY` disponível no ambiente
autorizado:

```bash
curl -fsS \
  -H "Authorization: Bearer ${RUNTIME_API_KEY}" \
  "https://neo-agent-react-production.up.railway.app/pilot/tasks/TASK_ID"
```

Não coloque a chave na URL, em documentação ou em logs. O `task_id` do
runtime não é o page ID do Notion; uma página pode ter mais de uma tentativa
preservada.

## O que pode ser solicitado agora

- transformar informações fornecidas em checklist;
- gerar plano curto em Markdown;
- organizar notas em resumo e ações;
- produzir rascunho ou briefing sem enviá-lo;
- consultar status, critérios, contexto e resultado aprovado de uma tarefa
  autorizada pela Alexa.

## Limites atuais

O Executor não possui tools externas. O sistema não:

- edita código, faz commit, push ou deploy por conta própria;
- publica conteúdo ou envia mensagens livremente;
- efetua pagamentos;
- altera tarefas no Notion;
- agenda Calendário ou Lembretes do Mac pelo runtime Railway;
- transforma conhecimento descoberto em prova de integração existente.

## Desligamento e degradação

- Desmarcar `Incluir no Agent` impede nova ingestão daquela tarefa.
- `NOTION_POLLING_ENABLED=false` desliga o polling contínuo após aplicação de
  nova configuração Railway.
- `ALEXA_ENABLED=false` desliga o canal Alexa após redeploy.
- Falha de discovery é registrada como `unavailable`, não como inexistência de
  informação.
- Falha de uma notificação não deve bloquear o loop principal; a outbox
  preserva a tentativa conforme o contrato do provider.

Alterações de variáveis e redeploys são operações de infraestrutura: confirme
o serviço e o ambiente antes de executá-las.

## Checklist do operador

Antes de marcar uma tarefa para o agente:

- [ ] organização e projeto correspondem a um nó real;
- [ ] contexto suficiente está na propriedade `Descrição`;
- [ ] critérios de aceite são objetivos;
- [ ] restrições estão explícitas;
- [ ] o trabalho pedido é compatível com uma saída textual;
- [ ] `Incluir no Agent` só foi marcado após a revisão humana.
