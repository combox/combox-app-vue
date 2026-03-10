CONTAINER ?= $(shell command -v podman >/dev/null 2>&1 && echo podman || echo docker)
PODMAN := $(findstring podman,$(CONTAINER))
BUILD_FLAGS :=
ifneq ($(PODMAN),)
BUILD_FLAGS := --format docker
endif
DC := $(CONTAINER) compose -f docker-compose.yml
EDGE_DC := $(CONTAINER) compose -f docker-compose.edge.yml
EDGE_DEV_DC := $(CONTAINER) compose -f docker-compose.edge.yml -f docker-compose.edge.dev.yml

.PHONY: up down rebuild logs ps check test-e2e edge-up edge-dev edge-down edge-logs edge-dev-logs docker-build docker-run commit

up:
	$(DC) up -d combox-app

down:
	$(DC) down --remove-orphans

rebuild:
	$(DC) build --no-cache combox-app combox-app-e2e

logs:
	$(DC) logs -f combox-app

ps:
	$(DC) ps

check:
	$(DC) run --rm combox-app npm run check

test-e2e:
	$(DC) --profile e2e run --rm combox-app-e2e

edge-up:
	@chmod +x ../combox-edge/scripts/init-mtls.sh
	@../combox-edge/scripts/init-mtls.sh init >/dev/null 2>&1 || true
	@../combox-edge/scripts/init-mtls.sh issue-server combox-app-vue-mtls >/dev/null 2>&1 || true
	$(EDGE_DC) up -d --build

edge-dev:
	@chmod +x ../combox-edge/scripts/init-mtls.sh
	@../combox-edge/scripts/init-mtls.sh init >/dev/null 2>&1 || true
	@../combox-edge/scripts/init-mtls.sh issue-server combox-app-vue-mtls >/dev/null 2>&1 || true
	$(EDGE_DEV_DC) up -d

edge-down:
	$(EDGE_DEV_DC) down --remove-orphans

edge-logs:
	$(EDGE_DC) logs -f --tail=120 combox-app-vue

edge-dev-logs:
	$(EDGE_DEV_DC) logs -f --tail=120 combox-app-vue

docker-build:
	$(CONTAINER) build $(BUILD_FLAGS) -t combox-app-vue:dev .

docker-run:
	$(CONTAINER) run --rm -p 4173:4173 combox-app-vue:dev

commit:
	node scripts/commit.js "$(branch)" "$(message)"
