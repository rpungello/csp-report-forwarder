# csp-report-forwarder

A small Node/Express service that receives browser [Content-Security-Policy]
violation reports and writes them into a ClickHouse table.

Supports both reporting mechanisms browsers use:
- Legacy `report-uri` (`Content-Type: application/csp-report`, body has a
  top-level `csp-report` key)
- Modern Reporting API `report-to` (`Content-Type: application/reports+json`,
  body is an array of report objects)

## 1. Create the ClickHouse table

Run `clickhouse/init.sql` against your ClickHouse instance (adjust the
database name if you're not using `default`):

```bash
clickhouse-client --multiquery < clickhouse/init.sql
```

## 2. Configure your CSP header

Point violation reports at this service, e.g.:

```
Content-Security-Policy: default-src 'self'; report-uri https://reports.example.com/csp-report; report-to csp-endpoint
Reporting-Endpoints: csp-endpoint="https://reports.example.com/csp-report"
```

## 3. Run locally

```bash
npm install
CLICKHOUSE_URL=http://localhost:8123 \
CLICKHOUSE_USER=default \
CLICKHOUSE_PASSWORD=changeme \
CLICKHOUSE_DATABASE=default \
CLICKHOUSE_TABLE=csp_reports \
npm start
```

## 4. Build and run the Docker image

```bash
docker build -t csp-report-forwarder:latest .

docker run -d \
  --name csp-report-forwarder \
  -p 8080:8080 \
  -e CLICKHOUSE_URL=http://your-clickhouse-host:8123 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=changeme \
  -e CLICKHOUSE_DATABASE=default \
  -e CLICKHOUSE_TABLE=csp_reports \
  csp-report-forwarder:latest
```

Then put a reverse proxy (nginx, Traefik, Caddy) in front of it to terminate
TLS, since the endpoint needs to be reachable over HTTPS from real browsers.

## Environment variables

| Variable              | Default                 | Description                                  |
|------------------------|--------------------------|-----------------------------------------------|
| `PORT`                 | `8080`                   | Port the HTTP server listens on               |
| `CLICKHOUSE_URL`       | `http://localhost:8123`  | ClickHouse HTTP interface URL                 |
| `CLICKHOUSE_USER`      | `default`                | ClickHouse user                               |
| `CLICKHOUSE_PASSWORD`  | (empty)                  | ClickHouse password                           |
| `CLICKHOUSE_DATABASE`  | `default`                | ClickHouse database                           |
| `CLICKHOUSE_TABLE`     | `csp_reports`             | Target table name                             |
| `BODY_LIMIT`           | `256kb`                  | Max accepted request body size                |

## Endpoints

- `POST /csp-report` — accepts CSP reports and inserts them into ClickHouse.
  Always responds `204 No Content` on success (browsers ignore the body).
- `GET /healthz` — returns `200` if ClickHouse is reachable, `503` otherwise.
  Used by the Docker `HEALTHCHECK`.

## CI: automatic build & publish to GitHub Container Registry

`.github/workflows/docker-publish.yml` builds the image on every push to
`main`, on version tags (`v1.2.3`), and on pull requests (build-only, no
push). On `main` it publishes to GHCR as:

```
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:main
ghcr.io/<owner>/<repo>:sha-<short-sha>
```

Pushing a tag like `v1.2.0` additionally publishes `:1.2.0` and `:1.2`.

No secrets to configure — it uses the repo's built-in `GITHUB_TOKEN`, which
already has permission to push to `ghcr.io/<owner>/<repo>`. The first time
the workflow runs, the resulting package may be created as **private**; if
you want hosts to `docker pull` it without authenticating, go to the
package's settings on GitHub and set its visibility to public (or `docker
login ghcr.io` on each host with a token that has `read:packages`).

On your Docker hosts:

```bash
docker pull ghcr.io/<owner>/<repo>:latest
docker run -d --name csp-report-forwarder -p 8080:8080 \
  -e CLICKHOUSE_URL=... -e CLICKHOUSE_PASSWORD=... \
  ghcr.io/<owner>/<repo>:latest
```

## Run with Docker Compose

`compose.yaml` runs just the forwarder — it assumes ClickHouse is already
running elsewhere (its own container/host/cluster) and you point the
forwarder at it via env vars.

Make sure you've applied `clickhouse/init.sql` to your ClickHouse instance
first (see step 1 above), then:

```bash
cp .env.example .env   # set CLICKHOUSE_URL and credentials
docker compose up -d --build
```

This starts just `csp-report-forwarder`, listening on `8080`.

Check it's healthy:

```bash
curl http://localhost:8080/healthz
```

To use the published image instead of building locally, edit `compose.yaml`
and swap the `build: .` line for `image: ghcr.io/<owner>/<repo>:latest`.

If your ClickHouse instance runs in Docker on the same host under a
different Compose project or standalone container, use its container name
or `host.docker.internal` (or the host's LAN IP) in `CLICKHOUSE_URL` rather
than `localhost`, since `localhost` inside the forwarder's container refers
to itself, not the host.

Tear down:

```bash
docker compose down
```

## Deploying to multiple Docker hosts

Push the image to a registry your hosts can pull from, then run the same
`docker run` command (with host-specific env vars) on each host:

```bash
docker build -t your-registry.example.com/csp-report-forwarder:latest .
docker push your-registry.example.com/csp-report-forwarder:latest

# on each host
docker pull your-registry.example.com/csp-report-forwarder:latest
docker run -d --name csp-report-forwarder -p 8080:8080 \
  -e CLICKHOUSE_URL=... -e CLICKHOUSE_PASSWORD=... \
  your-registry.example.com/csp-report-forwarder:latest
```

If you're managing several hosts, a Docker Swarm stack file or a simple
`docker compose` file referencing the pushed image works well too — happy to
generate one if you're using either.
