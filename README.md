# Kaiāulu Pa'a

Single-user [Solid](https://solidproject.org/) + [ActivityPub](https://www.w3.org/TR/activitypub/) server on Cloudflare Workers.

Uses [s20e](../s20e/) as the RDF/SPARQL/WAC backend (Oxigraph compiled to WASM). All other functionality — authentication, ActivityPub federation, LDP protocol, UI — is implemented in vanilla JavaScript using only Web APIs.

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account (for deployment)
- The `s20e` monorepo checked out at `../s20e/` (sibling directory)

## Setup

### 1. Install dependencies

```sh
npm install
```

### 2. Create Cloudflare resources

For deployment, create the KV namespaces and R2 bucket, then update `wrangler.toml` with the real IDs:

```sh
wrangler kv namespace create TRIPLESTORE
wrangler kv namespace create APPDATA
wrangler r2 bucket create paa-pub-blobs
```

Copy the returned namespace IDs into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TRIPLESTORE"
id = "<your-triplestore-id>"

[[kv_namespaces]]
binding = "APPDATA"
id = "<your-appdata-id>"

[[r2_buckets]]
binding = "BLOBS"
bucket_name = "paa-pub-blobs"
```

### 3. Set secrets

```sh
wrangler secret put PAA_PASSWORD    # your login password
wrangler secret put PAA_DOMAIN      # e.g. paa.pub (your production domain)
```

The username defaults to `admin` and can be changed in `wrangler.toml` under `[vars]`:

```toml
[vars]
PAA_USERNAME = "alice"
```

## Local development

```sh
npm run dev
```

This starts a local server at `http://localhost:8787` with simulated KV and R2 storage.

For local dev, set the password as a var in `wrangler.toml` or use a `.dev.vars` file:

```sh
# .dev.vars
PAA_PASSWORD=changeme
```

On first request, the server bootstraps automatically: creates the user record, generates an RSA keypair, initializes root containers (`/{user}/`, `/profile/`, `/public/`, `/private/`, `/settings/`), writes a WebID profile, and sets default ACLs.

## Deployment

```sh
npm run deploy
```

Make sure `PAA_PASSWORD` and `PAA_DOMAIN` are set as secrets (see Setup above).

## Configuration

| Variable | Where | Default | Description |
|---|---|---|---|
| `PAA_USERNAME` | `wrangler.toml` vars | `admin` | Your username |
| `PAA_PASSWORD` | Secret | *(required)* | Login password |
| `PAA_DOMAIN` | Secret or vars | `localhost:8787` | Public domain (e.g. `paa.pub`) |

## Usage

### Authentication

1. Navigate to `/login` and enter your password.
2. After login, you can register a passkey from the Dashboard for passwordless login.
3. Sessions last 24 hours. Logout via the nav bar.

### Dashboard (`/dashboard`)

Shows your WebID, follower/following/post counts, storage usage, and passkey registration.

### Activity feed (`/activity`)

- **Compose**: Write a post and choose audience (public, unlisted, followers-only, private).
- **Follow**: Enter a handle (`user@domain.com`) or actor URL.
- **Feed**: Shows your inbox and outbox activities merged chronologically.

### File storage (`/storage/`)

Browse your Solid pod contents. Upload files, create containers, delete resources. Each resource links to its ACL editor.

### ACL editor (`/acl/`)

Edit access control lists in Turtle format. A reference snippet is shown on the page.

### Solid protocol

Your pod is accessible at `/{username}/` via standard Solid/LDP methods:

```sh
# Read a resource
curl -H "Accept: text/turtle" https://paa.pub/alice/profile/card

# Create a resource
curl -X PUT \
  -H "Content-Type: text/turtle" \
  -d '<#this> <http://xmlns.com/foaf/0.1/name> "Alice" .' \
  https://paa.pub/alice/public/hello.ttl

# Create a container
curl -X POST \
  -H "Slug: notes" \
  -H 'Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' \
  https://paa.pub/alice/public/

# Update with SPARQL
curl -X PATCH \
  -H "Content-Type: application/sparql-update" \
  -d 'INSERT DATA { <#this> <http://xmlns.com/foaf/0.1/nick> "ally" . }' \
  https://paa.pub/alice/public/hello.ttl

# Upload a binary file
curl -X PUT \
  -H "Content-Type: image/png" \
  --data-binary @photo.png \
  https://paa.pub/alice/public/photo.png
```

### ActivityPub federation

**WebFinger discovery:**

```sh
curl https://paa.pub/.well-known/webfinger?resource=acct:alice@paa.pub
```

**Actor document** (content-negotiated on `/{user}/profile/card`):

```sh
curl -H "Accept: application/activity+json" https://paa.pub/alice/profile/card
```

**Collections:**

```sh
curl -H "Accept: application/activity+json" https://paa.pub/alice/outbox
curl -H "Accept: application/activity+json" https://paa.pub/alice/followers
curl -H "Accept: application/activity+json" https://paa.pub/alice/following
```

Remote ActivityPub servers can follow your account by sending a `Follow` activity to `/{user}/inbox`. Follows are auto-accepted.

## Architecture

```
Cloudflare Worker (single fetch handler)
├── s20e WASM Kernel (Oxigraph SPARQL + WAC)
├── s20e Orchestrator -> CloudflareAdapter
│   ├── TRIPLESTORE KV — RDF graphs, indexes, ACLs
│   └── BLOBS R2 — binary files
├── APPDATA KV — sessions, credentials, ActivityPub data
└── Vanilla JS modules — routing, auth, LDP, ActivityPub, UI
```

### Storage layout

**TRIPLESTORE KV** (managed by s20e):

| Key pattern | Value | Purpose |
|---|---|---|
| `idx:{graph_iri}` | JSON | Hybrid index per named graph |
| `doc:{graph_iri}:{subject_iri}` | N-Triples | Subject document |
| `acl:{resource_iri}` | N-Triples | WAC ACL rules |

**APPDATA KV** (direct access):

| Key pattern | Value | TTL |
|---|---|---|
| `user:{username}` | Password hash JSON | -- |
| `session:{token}` | Session JSON | 24h |
| `webauthn_cred:{user}:{credId}` | Credential JSON | -- |
| `ap_private_key:{user}` | PKCS#8 PEM | -- |
| `ap_public_key:{user}` | SPKI PEM | -- |
| `ap_followers:{user}` | JSON array of actor URIs | -- |
| `ap_following:{user}` | JSON array of actor URIs | -- |
| `ap_outbox_index:{user}` | JSON array of `{id, published}` | -- |
| `ap_outbox_item:{hash}` | Activity JSON | -- |
| `ap_inbox_index:{user}` | JSON array of `{id, published}` | -- |
| `ap_inbox_item:{hash}` | Activity JSON | -- |

**BLOBS R2**: Binary file data keyed by `blob:{resource_iri}`.

### Route table

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/` | Optional | Redirect to dashboard or login |
| GET | `/.well-known/webfinger` | None | WebFinger |
| GET/POST | `/login` | None | Login page |
| POST | `/logout` | Session | Destroy session |
| GET | `/dashboard` | Session | Dashboard |
| POST | `/webauthn/register/{begin,complete}` | Session | Passkey setup |
| POST | `/webauthn/login/{begin,complete}` | None | Passkey login |
| GET | `/activity` | Session | Activity feed |
| POST | `/compose` | Session | Create post |
| POST | `/follow` | Session | Follow user |
| POST | `/unfollow` | Session | Unfollow user |
| GET/POST | `/storage/**` | Session | File browser |
| GET/POST | `/acl/**` | Session | ACL editor |
| GET | `/{user}/profile/card` | None | WebID or Actor (conneg) |
| POST | `/{user}/inbox` | HTTP Sig | S2S inbox |
| GET | `/{user}/outbox` | None | Outbox collection |
| GET | `/{user}/followers` | None | Followers collection |
| GET | `/{user}/following` | None | Following collection |
| * | `/{user}/**` | WAC | LDP protocol |

## Project structure

```
src/
├── index.js                  # Entry point: WASM init, route dispatch
├── router.js                 # URL pattern matching
├── config.js                 # Environment variable reader
├── bootstrap.js              # First-run initialization
├── auth/
│   ├── password.js           # PBKDF2 hashing (Web Crypto)
│   ├── session.js            # KV-backed sessions
│   ├── middleware.js          # Cookie extraction
│   └── webauthn.js           # Passkey registration/login
├── solid/
│   ├── ldp.js                # LDP handler (all HTTP methods)
│   ├── conneg.js             # Content negotiation
│   ├── containers.js         # Container membership
│   ├── acl.js                # .acl resource management
│   ├── headers.js            # Solid protocol headers
│   └── cors.js               # CORS
├── activitypub/
│   ├── actor.js              # Actor JSON-LD document
│   ├── webfinger.js          # WebFinger endpoint
│   ├── inbox.js              # S2S inbox with signature verification
│   ├── outbox.js             # Outbox collection + C2S compose
│   ├── collections.js        # Followers/following collections
│   ├── httpsig.js            # HTTP Signature sign/verify
│   ├── delivery.js           # Fan-out via ctx.waitUntil()
│   ├── activities.js         # Follow/Accept/Undo/Create processors
│   └── remote.js             # Remote actor fetch + cache
├── rdf/
│   ├── turtle-parser.js      # Turtle parser
│   ├── turtle-serializer.js  # Turtle serializer
│   ├── ntriples.js           # N-Triples/N-Quads parser/serializer
│   └── prefixes.js           # Common RDF prefixes
├── crypto/
│   ├── rsa.js                # RSA-2048 keypair (RSASSA-PKCS1-v1_5)
│   ├── digest.js             # SHA-256 digest
│   └── cbor.js               # Minimal CBOR decoder (WebAuthn)
├── storage/
│   ├── binary.js             # Binary upload/download
│   ├── metadata.js           # Dublin Core metadata
│   └── quota.js              # Storage quota tracking
└── ui/
    ├── shell.js              # HTML page template + styles
    ├── pages/
    │   ├── login.js          # Login page
    │   ├── dashboard.js      # Dashboard
    │   ├── activity.js       # Activity feed + compose
    │   ├── storage.js        # File browser
    │   └── acl-editor.js     # ACL editor
    └── components/
        ├── nav-bar.js        # Navigation bar
        ├── activity-card.js  # Activity display
        ├── compose-form.js   # Compose form
        ├── file-list.js      # File listing
        ├── follow-button.js  # Follow button
        └── passkey-form.js   # Passkey management
```

## Design decisions

- **s20e Orchestrator** handles all Solid/LDP operations (SPARQL queries, WAC enforcement, SHACL validation). The application never talks to the triplestore directly except during bootstrap (when no ACLs exist yet).
- **Direct KV** for ActivityPub data (activities, followers, keys) since it doesn't need SPARQL — simple JSON read/write with index arrays.
- **Web Crypto API** for all cryptography: PBKDF2 password hashing, RSA HTTP Signatures, WebAuthn signature verification.
- **No build step** beyond wrangler's built-in esbuild bundling. No frameworks, no transpilers, no bundler config.
- **Server-rendered HTML** for all UI pages. No client-side JavaScript framework. Web component templates are available for future client-side use.
- **Single-user** design: one username, one pod, one ActivityPub actor. Write contention is rare, so KV eventual consistency is acceptable.

## License

MIT
