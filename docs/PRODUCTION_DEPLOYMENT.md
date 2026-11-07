# Dynamic production deployment

AEGIS ships two complementary deployment surfaces:

1. **Dynamic product stack** — a server-backed Next.js console, three isolated role services and a hardened same-origin gateway. Operators can create mandates, run payment pipelines, attest evidence and inspect live NEAR state through the browser.
2. **Public proof console**: the GitHub Pages deployment reads current vault state directly from public NEAR testnet RPC, with endpoint failover and auto-sync. Its Live Contract Probe sends visitor-written payment intents to the deployed contract's view methods in real time. It is keyless: it reads and evaluates, and never signs.

The dynamic stack is the commercial-pilot runtime. The public console is the permanent demonstration and verification surface.

## Runtime topology

```text
                         public HTTPS load balancer / TLS
                                      |
                                gateway :8080
                          /          |           \
                     Next.js      /api/*      /owner-api/*
                       web        agent-api       owner-api
                                     |
                              verifier-api
                                     |
                              NEAR testnet RPC

          OWNER key -> owner-api only
          AGENT restricted key -> agent-api only
          ATTESTOR key -> verifier-api only
          VAULT full-access key -> absent from every runtime container
```

Every role runs in its own container and receives exactly one signing key. Service-to-service traffic uses an internal backend network that is never published; the three signing services reach NEAR RPC through a separate egress network that exposes no ports. The gateway is the only exposed container and applies request-size limits, per-client rate limits and security headers. Health probes test process liveness; readiness probes also verify that each service can read its authoritative vault backend.

## One-command deployment

Requirements: Docker Engine with Compose v2 and an HTTPS load balancer or ingress in front of port 8080.

1. Copy `deploy/production.env.example` to a secret-managed path outside the repository.
2. Set the deployed testnet account IDs, one independent key per role, two independent bearer tokens and the exact public HTTPS origin.
3. Validate the environment without exposing credential values:

   ```bash
   node scripts/validate-production.mjs /secure/aegis.production.env
   ```

4. Build and launch the dynamic stack:

   ```bash
   docker compose --env-file /secure/aegis.production.env -f compose.production.yml up -d --build
   ```

5. Confirm the gateway and role readiness:

   ```bash
   curl --fail http://127.0.0.1:8080/healthz
   curl --fail http://127.0.0.1:8080/api/system/ready
   ```

The console detects the live agent API and enters `LIVE_SERVICES` mode automatically. All dashboard reads use fresh service/on-chain state, and interactive actions execute through the role-isolated APIs.

## Verified end to end

On 2026-11-07 the stack was built from a clean checkout on Ubuntu 24.04 (Docker Engine 29) and run against the live testnet vault with real role keys:

| Check | Result |
| --- | --- |
| Configuration validator | `PRODUCTION_CONFIGURATION_VALID`, with `VAULT KEY ABSENT; OWNER / AGENT / ATTESTOR KEYS DISTINCT` |
| Container health | gateway, web, agent, verifier and owner all `healthy` |
| Readiness through the gateway | agent and owner `ready` in `TESTNET` mode for `vault.aegis-cf-mw2gs131-c04639.testnet` |
| Live chain state through the gateway | contract `1.0.0`, policy v1, three on-chain mandates |
| Unauthenticated owner write | refused with HTTP `401` |
| Key isolation inside containers | agent: `NEAR_AGENT_PRIVATE_KEY` only; verifier: `NEAR_ATTESTOR_PRIVATE_KEY` only; owner: `NEAR_OWNER_PRIVATE_KEY` only; web and gateway: none |
| RPC resilience | readiness succeeded through both configured RPC endpoints, including automatic failover |

## Reusable images

`.github/workflows/production-images.yml` builds software-bill-of-materials and provenance-enabled images on every production-path change:

- `ghcr.io/eshaanvgupta/aegis-counterfactual-web:latest`
- `ghcr.io/eshaanvgupta/aegis-counterfactual-service:latest`

Each publish also receives an immutable `sha-<full commit>` tag. Set `AEGIS_IMAGE_PREFIX` to a mirrored registry prefix when promoting the same artifacts into another environment.

For a repeatable rollout, set `AEGIS_IMAGE_TAG=sha-<full-commit>` in the protected environment file, then deploy the exact published pair without rebuilding:

```bash
docker compose --env-file /secure/aegis.production.env -f compose.production.yml pull
docker compose --env-file /secure/aegis.production.env -f compose.production.yml up -d --no-build
```

## Operational controls

- Terminate TLS before the gateway and set `AEGIS_PUBLIC_ORIGIN` to that exact HTTPS origin.
- Store the environment in a managed secret store; the repository and images contain no runtime credentials.
- Back up the `aegis-data` volume to retain off-chain receipts, pipeline records and authorized invoice text. The NEAR vault remains the authority for policy, mandates, intents and settlement.
- Keep one worker for each signing service. This intentionally preserves a single ordered signer per role; the web tier and edge gateway can be replicated independently by the hosting platform.
- Rotate an individual role by replacing only that role's key/token and redeploying its container. The vault key is not part of the running product stack.
- Use the `/system/health` endpoints for liveness, `/system/ready` for traffic admission and structured gateway/service logs for correlation and alerting.

## Direct single-host runtime

For a managed VM without containers, the same dynamic system runs from the checked-out source:

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm build
pnpm start:production
```

`start:production` launches the built Next.js server and the three independently credentialed TESTNET services. Place the same reverse-proxy and TLS controls in front of port 3000 for an internet-facing deployment.

