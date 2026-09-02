# CLAUDE.md

## Instruções Úteis

Este arquivo serve como contexto de inicialização para agentes Claude ou interfaces associadas atuando na manutenção ou expansão deste repositório.

### Comandos Frequentes:

* **Iniciar Todo o Ambiente (Dev):** `make bootstrap` seguido de `make docker-up`.
* **Rodar Worker Local:** `make worker-api` (porta: 4001).
* **Rodar Frontend:** `make ui` (porta: 3000).

*Atenção: A execução paralela exige que os serviços tenham o Redis já disponível para o trânsito pub/sub dos agentes NEO.*

## Runtime Persistente

Antes de atuar no Railway, leia `RAILWAY_DEPLOY.md`. O documento contém o
contrato canônico e um snapshot operacional datado; confirme o estado ao vivo
porque um snapshot não prova o estado atual.

Não troque os comandos de função:

- pre-deploy: `pnpm db:migrate`;
- start: `pnpm start:worker-api`.

Não leve `HOST=127.0.0.1`, caminhos absolutos do Mac ou valores de secrets para
o runtime Railway. Deploy `SUCCESS`, `/ready` saudável e E2E real são gates
distintos e devem ser reportados separadamente.
