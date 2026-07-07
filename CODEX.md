# CODEX.md

## Filosofia do Projeto

`neo-agent-react` é construído sob os seguintes pilares fundamentais:
1. **Desacoplamento Rigoroso:** A interface de usuário (`apps/canvas-ui`) não executa rotinas pesadas nem manipula segredos. Todo o processamento cognitivo e orquestração ocorrem no Worker (`services/worker`), utilizando a base lógica de `packages/engine`.
2. **Infraestrutura Descartável e Escalável:** A integração e estado de agentes em runtime ocorrem através de uma fila e cache (ex: Redis). Processos workers devem ser independentes do armazenamento local para possibilitar escalabilidade e resiliência no ambiente de produção.
3. **Visibilidade Operacional (Glassmorphism + Feedback Visual):** A interface deve refletir com clareza (através do Canvas UI com React Flow) todos os eventos que ocorrem de forma sistêmica na execução.

## Contratos de Integração

* Todo o código compartilhado deve viver no repositório `packages/`. Serviços ou aplicativos não devem tentar burlar as restrições acessando os sub-caminhos uns dos outros diretamente caso violem regras de boundaries.
* Deploy deve seguir invariavelmente os comandos expressos em `RAILWAY_DEPLOY.md`.
