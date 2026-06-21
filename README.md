# Kaiāulu Pa'a

Multi-user [Solid](https://solidproject.org/) + [ActivityPub](https://www.w3.org/TR/activitypub/) server powered by [sparq](https://github.com/jeswr/sparq).

Deployable to **Cloudflare Workers** or **OpenShift** (Deno + MinIO).

Own your identity and data. Your server provides:

- **Multi-user support** — open or closed registration, per-user pods, admin panel
- A **Solid Pod** per user — store and manage RDF and binary resources with full LDP protocol support
- **ActivityPub federation** — follow and be followed by accounts on Mastodon, Pixelfed, and other fediverse servers
- **Direct messages** — send private notes to specific followers or following accounts
- **Threaded replies** — reply to activities with `inReplyTo` for conversation threading
- **Real-time activity feed** — Server-Sent Events push new activities to open pages without polling
- **SPA navigation** — Navigation API + History API fallback for instant page transitions without full reloads
- A **WebID profile** — a standards-based decentralized identity for each user
- **Decentralized Identifiers (DID)** — each user gets a `did:web` DID document
- **OIDC provider** — authenticate with Solid apps using your server as the identity provider
- **FedCM identity provider** — browser-native account picker for streamlined login
- A **web UI** — dashboard, profile editor, activity feed, file browser, access control editor, settings, and admin panel
- **Internationalization** — 5 languages (English, French, Spanish, Hebrew, Chinese) with full RTL support
- **Security hardening** — rate limiting, request size limits, per-user storage quotas, SSRF protection, app write restrictions, and HTTP Signature verification

Uses [sparq](https://github.com/jeswr/sparq) as the RDF/SPARQL engine (WASM). State management via [cpx-store](https://github.com/chapeaux/cpx-store). Everything else — authentication, federation, LDP, UI — is vanilla JavaScript using only Web APIs.

## Deployment Options

### Cloudflare Workers (`multi-user` branch)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/daryltd/paa.pub)

Uses Cloudflare KV for data storage and R2 for binary blobs. See [Cloudflare deployment](#cloudflare-workers-deployment) below.

### OpenShift / Deno (`openshift` branch)

Uses Deno runtime with sparq as an in-memory triplestore. Data persists via MinIO (S3-compatible) snapshots. No database required.

```bash
git checkout openshift
./deploy/openshift/deploy.sh mypassword
```

Or manually:
```bash
oc apply -k deploy/openshift/
oc start-build paa-pub --from-dir=. --follow
```

The OpenShift deployment includes:
- **Deno container** with sparq WASM engine
- **MinIO** for blob storage and N-Triples snapshots (data survives pod restarts)
- **SSE endpoint** (`/activity/stream`) for real-time activity updates
- **SPA navigation** via Navigation API (Chromium) / History API (Firefox/Safari)

## Quick start

### Cloudflare Workers deployment

There are three ways to deploy to Cloudflare:

1. **Deploy button** (above) — click, connect your GitHub fork, configure in the dashboard
2. **GitHub Actions** — fork the repo, set up automated deploys on push
3. **Manual** — clone, configure `wrangler.toml`, deploy with Wrangler CLI

All three require creating KV namespaces and an R2 bucket first.

#### Prerequisites

- **Node.js** 20+
- **Wrangler CLI** (`npm install -g wrangler`)
- A **Cloudflare account** (free tier works)

#### 1. Clone and install

```sh
git clone https://github.com/daryltd/paa.pub
cd paa.pub
npm install
```

#### 2. Create Cloudflare resources

```sh
wrangler login
wrangler kv namespace create TRIPLESTORE
wrangler kv namespace create APPDATA
wrangler r2 bucket create my-solid-blobs
```

Update `wrangler.toml` with your KV/R2 IDs.

#### 3. Set secrets

```sh
wrangler secret put PAA_PASSWORD    # admin account password
wrangler secret put PAA_DOMAIN      # your domain, e.g. solid.example.com
```

#### 4. Deploy

```sh
npm run deploy
```

### OpenShift deployment

#### Prerequisites

- `oc` CLI logged into an OpenShift cluster
- A namespace with permissions to create Deployments, Services, Routes, PVCs

#### 1. Clone and switch to the OpenShift branch

```sh
git clone https://github.com/daryltd/paa.pub
cd paa.pub
git checkout openshift
```

#### 2. Deploy

```sh
./deploy/openshift/deploy.sh mypassword
```

This creates: MinIO (with PVC), ConfigMap, Secrets, Deployment, Service, Route, and NetworkPolicy.

The app auto-bootstraps on first request: creates the admin account, generates RSA keypairs, initializes containers and profiles.

## Local development

### Cloudflare (Wrangler)
```sh
npm run dev    # starts at http://localhost:8787
```

### Deno (OpenShift mode)
```sh
deno task dev  # starts at http://localhost:3000
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PAA_USERNAME` | `admin` | Admin account username |
| `PAA_PASSWORD` | *(required)* | Admin account password |
| `PAA_DOMAIN` | auto-detected | Public domain |
| `PAA_STORAGE_LIMIT` | `1GB` | Default per-user storage limit |
| `PAA_FEED_LIMIT` | `50` | Maximum activities shown in the feed |
| `PAA_REGISTRATION` | `open` | `open` or `closed` |

OpenShift-specific:

| Variable | Default | Description |
|---|---|---|
| `MINIO_ENDPOINT` | `paa-minio` | MinIO service hostname |
| `MINIO_PORT` | `9000` | MinIO port |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin` | MinIO secret key |
| `MINIO_BUCKET` | `paa-pub` | MinIO bucket name |
| `PAA_SNAPSHOT_INTERVAL` | `30000` | Snapshot interval in ms |

## Features

### Activity feed (`/activity`)

- **Compose** posts with audience selection (public, unlisted, followers-only, direct message, private)
- **Direct messages** — select a specific follower/following account as recipient
- **Threaded replies** — reply to any activity with `inReplyTo` context
- **Real-time updates** — new activities appear instantly via Server-Sent Events (OpenShift only)
- **SPA navigation** — page transitions without full reloads via Navigation API
- **State persistence** — compose drafts, section toggles, and feed filter preferences saved via cpx-store
- **No-refresh forms** — compose, mark-read, follow/unfollow submit via fetch without page reload
- **Follow** fediverse accounts by handle (`@user@mastodon.social`) or actor URL
- **Pending follows** — see outgoing follow requests awaiting acceptance, with cancel option
- **Feed filters** — received, sent, or all activities with read/unread filtering

### Solid protocol

Full LDP support: GET, PUT, POST, PATCH (SPARQL Update), DELETE, HEAD, OPTIONS. Content negotiation (Turtle, N-Triples, JSON-LD). WAC access control. Conditional requests (ETag, If-Match, If-None-Match). Storage quotas.

### ActivityPub federation

WebFinger discovery, actor documents with public keys, HTTP Signature signing/verification, inbox/outbox collections, Follow/Accept/Undo/Create activity processing, shared inbox support, delivery fallback.

### Identity

WebID profiles, `did:web` DID documents, Solid-OIDC provider, FedCM identity provider, WebAuthn/Passkeys, multi-method auth.

### Web UI

Dashboard, profile editor (with page builder), activity feed, file browser, access control editor, settings, admin panel. 5 languages with RTL support.

## Architecture

### Cloudflare Workers
```
Cloudflare Worker (single fetch handler)
├── sparq WASM (RDF parsing + SPARQL, per-request)
├── TRIPLESTORE KV — RDF graphs, indexes, ACLs
├── APPDATA KV — sessions, credentials, AP data, policies
├── BLOBS R2 — binary files
└── Vanilla JS modules — routing, auth, LDP, ActivityPub, UI
```

### OpenShift / Deno
```
Deno.serve() (long-lived process)
├── sparq WASM (in-memory triplestore for all data)
├── MinIO (S3) — N-Triples snapshots + binary blobs
├── SSE endpoint — real-time activity push
├── SPA fragment mode — partial page rendering
└── Same vanilla JS modules as Cloudflare
```

Both deployments share the same handler code. Only the entry point (`src/index.js` vs `src/index-openshift.js`), storage adapter, and config module differ.

## RDF Engine

This project uses [sparq](https://github.com/jeswr/sparq) (v0.1.0) — a Rust-based SPARQL 1.1/1.2 engine compiled to WebAssembly. sparq replaced the previous `@s20e/kernel` (Oxigraph WASM) for conformant Turtle parsing, full SPARQL support, and a smaller bundle (~1.5 MB vs ~2.9 MB).

On Cloudflare, sparq loads per-request from KV data. On OpenShift, sparq holds all data in-memory with periodic MinIO snapshots for durability.

## Developer Hub

This project includes a `catalog-info.yaml` for [Red Hat Developer Hub](https://developers.redhat.com/products/rhdh) integration. Import the repo to register the component and its APIs (Solid-OIDC, ActivityPub, WebFinger) in your software catalog.

## License

[MIT](LICENSE)
