# Genoa Deployment

Two deployment paths are supported: **local docker-compose** and
**DigitalOcean App Platform**.  A first deploy produces a sample FM
exhibit with no terrain / SDR / identity sidecars — the engine is the
critical path; the sidecars are accretive.

## 1. Local docker-compose

```bash
docker compose up --build
# UI + API on http://localhost:8080
# terrain sidecar     :8081 (returns 503 until TERRAIN_BACKEND is wired)
# measurement sidecar :8082
# identity sidecar    :8083
# postgres            :5432
```

The compose file wires the API at `genoa-api` to all three sidecars; if
you don't need a sidecar, remove the corresponding `*_SIDECAR_URL` env
var or comment out the service.  The API's `/readyz` endpoint reports
sidecar health without failing readiness.

Migrations run automatically when the API boots and `DATABASE_URL` is
reachable.

## 2. DigitalOcean App Platform

The reference spec is at [`infra/digitalocean/app.yaml`](../infra/digitalocean/app.yaml).

```bash
# bootstrap a new app from the spec
cp infra/digitalocean/app.yaml .do/app.yaml
doctl apps create --spec .do/app.yaml
# move the file back so subsequent pushes don't re-trigger reconciliation
mv .do/app.yaml infra/digitalocean/app.yaml
```

The spec ships:

- `genoa-api` web component, `Dockerfile` at `infra/docker/api.Dockerfile`,
  health on `/healthz`.
- `genoa-worker` worker component, no HTTP, polls Postgres.
- A managed Postgres database; `DATABASE_URL` is bound to `${db.DATABASE_URL}`.

### Required environment variables

| Variable                       | Where set                       | Notes                                                |
|--------------------------------|---------------------------------|------------------------------------------------------|
| `DATABASE_URL`                 | bound to `${db.DATABASE_URL}`   | Required for persistence routes.                     |
| `NODE_ENV`                     | spec                            | `production`                                         |
| `PORT`                         | spec                            | `8080`                                               |
| `SPACES_ENDPOINT`              | spec                            | e.g. `https://sfo3.digitaloceanspaces.com`           |
| `SPACES_BUCKET`                | spec                            | e.g. `genoa-exhibits`                                |
| `SPACES_ACCESS_KEY_ID`         | console (SECRET)                | ENCRYPTED                                             |
| `SPACES_SECRET_ACCESS_KEY`     | console (SECRET)                | ENCRYPTED                                             |
| `TERRAIN_SIDECAR_URL`          | spec / console                  | Optional.                                            |
| `MEASUREMENT_SIDECAR_URL`      | spec / console                  | Optional.                                            |
| `IDENTITY_SIDECAR_URL`         | spec / console                  | Optional.                                            |
| `ZERO_TRUST_RADIO_READONLY_URL`| spec / console                  | Optional.                                            |
| `RADIODNS_RESOLVER_URL`        | spec / console                  | Optional.                                            |
| `GIT_COMMIT_SHA`               | Docker build arg                | Stamped into `engine_signature.hash` for audit.      |

`scripts/wire-env.sh` is a helper to splice the encrypted SECRETs into a
live App Platform spec without committing them.  It is intentionally not
checked in with credentials.

### Sidecars on App Platform

Sidecars are not modeled as App Platform services in the reference spec
because each depends on upstream `chelstein/*` tools at runtime (SPLAT,
itmlogic, EAS-Tools, massdns).  Once those upstream tools are
containerized, deploy each sidecar as its own App Platform service or as
a Droplet, then point the API's `*_SIDECAR_URL` envs at them.

## Health checks

- `/healthz` — liveness, never touches DB / sidecars.
- `/readyz`  — readiness; reports DB + sidecar health.  Returns 200 in
  stateless mode (no `DATABASE_URL`) so the container does not get
  killed before the engine is exercised.

## First-deploy expectations

- **Without a database**: `/api/exhibits/compute`, `/api/curves`,
  `/api/validation`, all exporters off an in-memory exhibit work.
  `/api/exhibits` (list / get / save) returns 503.
- **With a database**: full persistence; saved exhibits surface in
  the History tab; warning events written to `genoa_warning_event`.
- **Without sidecars**: FM compute succeeds; warnings include
  `SIDECAR_UNAVAILABLE`, `CONSTANT_HAAT_ASSUMED`,
  `SDR_MEASUREMENTS_MISSING`, `FACILITY_LOOKUP_UNAVAILABLE`,
  `RADIODNS_VALIDATION_UNAVAILABLE` (if those sidecars were configured
  and unreachable).
