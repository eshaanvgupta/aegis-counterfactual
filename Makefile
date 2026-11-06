.PHONY: setup dev dev-testnet test security offline contract web static e2e
setup:
	pnpm install
	pnpm run setup
dev:
	pnpm dev
dev-testnet:
	pnpm dev:testnet
test:
	pnpm test
security:
	pnpm test:security
offline:
	pnpm demo:offline
contract:
	pnpm build:contract
web:
	pnpm build
static:
	pnpm build:static
e2e:
	pnpm build:static && pnpm test:e2e
