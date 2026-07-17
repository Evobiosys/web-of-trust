# resource-web sprint — podman substitutes for docker on this host (DECISIONS.md D3)
DOCKER ?= podman
COMPOSE ?= $(DOCKER) compose
PROFILE ?= local

.PHONY: up down build test demo snapshot revert gate

gate:
	@bash scripts/env_gate.sh

up:
	$(COMPOSE) --profile $(PROFILE) up -d

down:
	$(COMPOSE) --profile $(PROFILE) down

build:
	pnpm -r build

test:
	pnpm -r test

demo:
	pnpm tsx scripts/demo.ts

snapshot:
	pnpm tsx scripts/snapshot.ts --step $(STEP)

revert:
	git checkout step-$(STEP) && $(COMPOSE) --profile $(PROFILE) restart
