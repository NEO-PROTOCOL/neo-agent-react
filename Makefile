SHELL := /bin/bash

CYAN    := \033[0;36m
GREEN   := \033[0;32m
YELLOW  := \033[0;33m
RED     := \033[0;31m
MAGENTA := \033[0;35m
DIM     := \033[0;90m
WHITE   := \033[1;37m
RESET   := \033[0m

.DEFAULT_GOAL := help

FLOW_ID ?= local_test_flow
REDIS_URL ?= redis://localhost:6379

.PHONY: repair help bootstrap setup deps dev ui worker worker-api infra-up infra-down infra-logs \
        docker-dev docker-up checks typecheck lint build clean reset

help: ## Exibe os comandos disponíveis
	@printf "$(CYAN)╔══════════════════════════════════════════╗$(RESET)\n"
	@printf "$(CYAN)║$(MAGENTA)▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓$(CYAN)║$(RESET)\n"
	@printf "$(CYAN)║                                          ║$(RESET)\n"
	@printf "$(CYAN)║$(RESET)      $(WHITE)NEØ PROTOCOL · NΞØ AGENT REACT$(RESET)       $(CYAN)║$(RESET)\n"
	@printf "$(CYAN)║$(RESET)       $(MAGENTA)── CANVAS UI & WORKER ENGINE ──$(RESET)     $(CYAN)║$(RESET)\n"
	@printf "$(CYAN)║                                          ║$(RESET)\n"
	@printf "$(CYAN)║$(MAGENTA)▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓$(CYAN)║$(RESET)\n"
	@printf "$(CYAN)╚══════════════════════════════════════════╝$(RESET)\n"
	@printf "$(DIM) ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░$(RESET)\n"
	@printf "\n"
	@printf "  Uso: $(CYAN)make$(RESET) $(WHITE)[comando]$(RESET)\n"
	@printf "\n"
	@printf "$(DIM)  ·─── SETUP & DESENVOLVIMENTO ───────────────$(RESET)\n"
	@grep -E '^(bootstrap|setup|deps|dev|ui|worker|worker-api|build|clean|reset):.*## ' Makefile \
		| sort \
		| awk 'BEGIN {FS = ":.*## "}; {printf "  \033[0;36m◆ %-16s\033[0m \033[0;90m%s\033[0m\n", $$1, $$2}'
	@printf "\n"
	@printf "$(DIM)  ·─── QUALIDADE & VALIDAÇÃO ─────────────────$(RESET)\n"
	@grep -E '^(checks|typecheck|lint):.*## ' Makefile \
		| sort \
		| awk 'BEGIN {FS = ":.*## "}; {printf "  \033[0;36m◆ %-16s\033[0m \033[0;90m%s\033[0m\n", $$1, $$2}'
	@printf "\n"
	@printf "$(DIM)  ·─── INFRAESTRUTURA & DOCKER ───────────────$(RESET)\n"
	@grep -E '^(infra-.*|docker-.*):.*## ' Makefile \
		| sort \
		| awk 'BEGIN {FS = ":.*## "}; {printf "  \033[0;36m◆ %-16s\033[0m \033[0;90m%s\033[0m\n", $$1, $$2}'
	@printf "\n"
	@printf "$(DIM) ─────────────────────────────────────────────$(RESET)\n"
	@printf "$(DIM) ⬡ NΞØ Protocol · Reactive Agent Canvas$(RESET)\n"
	@printf "\n"

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

repair: ## Maintenance Nível 1: recria node_modules
	@printf "$(YELLOW)╭──────────────────────────────────────────╮$(RESET)\n"
	@printf "$(YELLOW)│$(RESET)  $(WHITE)⚙  REPAIR$(RESET)                                $(YELLOW)│$(RESET)\n"
	@printf "$(YELLOW)╰──────────────────────────────────────────╯$(RESET)\n"
	@rm -rf node_modules
	@pnpm install
	@printf "$(GREEN)  ✓ Módulos reinstalados com sucesso.$(RESET)\n"
