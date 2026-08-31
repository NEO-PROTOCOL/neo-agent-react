# Próximos Passos (NEXT-STEPS)

Este documento registra os pontos de ação pendentes identificados na inicialização do workspace para garantir a funcionalidade correta do runtime e do frontend.

## 1. Restaurar/Revisar o Workspace do PNPM
>
> [!CAUTION]
> A remoção não intencional de `pnpm-workspace.yaml` impede que os pacotes locais se resolvam (ex: `apps/canvas-ui` acessando `packages/engine`).

- [x] Definir a estratégia real de workspace. Se o monorepo será mantido (conforme as documentações e Railway assumem), precisamos recriar o arquivo `pnpm-workspace.yaml`.
- [x] Sincronizar e re-executar `pnpm install` no diretório raiz após restaurar a estrutura correta.

## 2. Testar Comunicação UI e Worker

- [x] Rodar o comando `make bootstrap` e/ou `make infra-up`.
- [x] Validar a conexão Redis-local.
- [x] Subir as duas frentes `ui` (3000) e `worker-api` (4001) e verificar os logs para garantir ausência de quebras de contrato de módulo importado.

## 3. Comitar Estado Base

- [x] Confirmar se a mudança de `pnpm` para versão 11.24+ no `package.json` será a versão definitiva. Se sim, comitar. Se não, retornar à versão `10.33.0`.
- [x] Comitar as adições de documentação criadas (`CODEX.md`, `AGENTS.md`, `CLAUDE.md`, `SVG.md`, `MARKDOWN_STYLE_GUIDE.md`).

## 4. Piloto Semanal & Notification Router

- [x] Implementação do `PilotLoop` para execução semanal de tarefas com papéis de Operator, Planner, Executor, Reviewer e Guardian.
- [x] Implementação do `NotificationRouter` para roteamento de alertas e notificações dos agentes.
- [x] Testes unitários do loop do piloto (`pnpm test:pilot`).

## 5. Evolução Modular de Packages

- [x] Criação do `SETUP.md` canônico.
- [ ] Modularização de `@neo/skills` com exportações de skills puras independentes de UI.
- [ ] Modularização de `@neo/memory` com adaptadores de contexto e persistência (Redis / InMemory).
