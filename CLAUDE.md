# CLAUDE.md

## Instruções Úteis

Este arquivo serve como contexto de inicialização para agentes Claude ou interfaces associadas atuando na manutenção ou expansão deste repositório.

### Comandos Frequentes:

* **Iniciar Todo o Ambiente (Dev):** `make bootstrap` seguido de `make docker-up`.
* **Rodar Worker Local:** `make worker-api` (porta: 4001).
* **Rodar Frontend:** `make ui` (porta: 3000).

*Atenção: A execução paralela exige que os serviços tenham o Redis já disponível para o trânsito pub/sub dos agentes NEO.*
