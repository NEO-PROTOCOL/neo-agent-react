SHELL := /bin/bash
.DEFAULT_GOAL := help

FLOW_ID ?= local_test_flow
REDIS_URL ?= redis://localhost:6379

.PHONY: help bootstrap setup deps dev ui worker worker-api infra-up infra-down infra-logs \
        docker-dev docker-up checks typecheck lint build clean reset

help: ## Mostra comandos disponíveis
	@echo ""
	@echo "NEO Agent React - comandos agrupados"
	@echo ""
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

bootstrap: setup deps ## Preparação completa do ambiente local

setup: ## Garante pnpm via corepack
	@corepack enable

deps: ## Instala dependências do monorepo
	@pnpm install

dev: infra-up ## Sobe Redis e inicia UI local
	@REDIS_URL=$(REDIS_URL) pnpm --dir apps/canvas-ui dev

ui: ## Inicia apenas o frontend
	@REDIS_URL=$(REDIS_URL) pnpm --dir apps/canvas-ui dev

worker: ## Executa worker local com FLOW_ID configurável
	@REDIS_URL=$(REDIS_URL) FLOW_ID=$(FLOW_ID) pnpm --dir services/worker start

worker-api: ## Sobe API HTTP do worker (container/service separado)
	@REDIS_URL=$(REDIS_URL) PORT=4001 pnpm --dir services/worker start:api

infra-up: ## Sobe infraestrutura local (Redis)
	@docker compose up -d redis

infra-down: ## Derruba infraestrutura local
	@docker compose down

infra-logs: ## Logs do Redis local
	@docker compose logs -f redis

docker-dev: ## Sobe stack via Docker (canvas-ui + redis)
	@docker compose up canvas-ui

docker-up: ## Sobe stack completa local (redis + worker + canvas-ui)
	@docker compose up --build

checks: typecheck lint ## Executa validações principais

typecheck: ## Typecheck do canvas-ui
	@pnpm --dir apps/canvas-ui exec tsc --noEmit

lint: ## Lint real do canvas-ui com ESLint
	@pnpm --dir apps/canvas-ui lint

build: ## Build de produção do frontend
	@NODE_ENV=production pnpm --dir apps/canvas-ui build

clean: ## Limpa artefatos locais comuns
	@rm -rf apps/canvas-ui/.next

reset: infra-down clean ## Reset local sem remover lockfile/node_modules
