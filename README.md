# Kaiāulu Pa'a

Multi-user [Solid](https://solidproject.org/) + [ActivityPub](https://www.w3.org/TR/activitypub/) server that runs entirely on Cloudflare Workers.

Own your identity and data. Your server provides:

- **Multi-user support** — open or closed registration, per-user pods, admin panel
- A **Solid Pod** per user — store and manage RDF and binary resources with full LDP protocol support
- **ActivityPub federation** — follow and be followed by accounts on Mastodon, Pixelfed, and other fediverse servers, plus local following between users on the same server
- A **WebID profile** — a standards-based decentralized identity for each user
- **OIDC provider** — authenticate with Solid apps using your server as the identity provider
- **FedCM identity provider** — browser-native account picker for streamlined login on third-party sites and re-authentication on your own server
- A **web UI** — dashboard, profile editor, activity feed, file browser, access control editor, settings, and admin panel
- **Internationalization** — 5 languages (English, French, Spanish, Hebrew, Chinese) with full RTL support for Hebrew, locale-aware date/number formatting, and per-user language preferences
- **Security hardening** — rate limiting, request size limits, per-user storage quotas, SSRF protection, app write restrictions, and HTTP Signature verification

Uses [s20e](https://github.com/chapeaux/s20e) as the RDF/SPARQL engine (Oxigraph compiled to WASM). Everything else — authentication, federation, LDP, UI — is vanilla JavaScript using only Web APIs.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/daryltd/paa.pub)

## Quick start

There are three ways to deploy:

1. **Deploy button** (above) — click, connect your GitHub fork, and configure in the Cloudflare dashboard
2. **GitHub Actions** — fork the repo and set up automated deploys on push
3. **Manual** — clone, configure `wrangler.toml`, and deploy with the Wrangler CLI

All three require creating KV namespaces and an R2 bucket first (step 2 below).

### Option A: Deploy button

Click the deploy button above. Cloudflare will walk you through:

1. Forking the repo to your GitHub account
2. Connecting it to your Cloudflare account
3. Creating a Worker

After deployment, you still need to create the storage resources (step 2 below), update `wrangler.toml` with the IDs, set secrets (step 3), and re-deploy.

### Option B: GitHub Actions (CI/CD)

1. Fork this repo
2. Create the Cloudflare resources (step 2 below) and update `wrangler.toml` with your KV/R2 IDs
3. In your fork's **Settings** → **Secrets and variables** → **Actions**, add:
   - `CLOUDFLARE_API_TOKEN` — create one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with the **Edit Cloudflare Workers** template
   - `CLOUDFLARE_ACCOUNT_ID` — found on the Workers overview page
4. Set app secrets with `wrangler secret put PAA_PASSWORD` and `wrangler secret put PAA_DOMAIN`
5. Push to `main` — the workflow at `.github/workflows/deploy.yml` deploys automatically

### Option C: Manual deploy

#### Prerequisites

- **Node.js** 20+
- **Wrangler CLI** (`npm install -g wrangler`)
- A **Cloudflare account** (free tier works)

#### 1. Clone and install

```sh
git clone <repo-url> paa.pub
cd paa.pub
npm install
```

The s20e triplestore (Oxigraph WASM kernel, orchestrator, and Cloudflare adapter) is installed automatically from [JSR](https://jsr.io/@s20e) as an npm dependency.

### 2. Create Cloudflare resources

Log in to Wrangler and create the required storage:

```sh
wrangler login
wrangler kv namespace create TRIPLESTORE
wrangler kv namespace create APPDATA
wrangler r2 bucket create my-solid-blobs
```

Each `kv namespace create` command prints an ID. Update `wrangler.toml` with your values:

```toml
name = "my-solid-server"
main = "src/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
PAA_USERNAME = "alice"    # admin account username

[[kv_namespaces]]
binding = "TRIPLESTORE"
id = "<your-triplestore-namespace-id>"

[[kv_namespaces]]
binding = "APPDATA"
id = "<your-appdata-namespace-id>"

[[r2_buckets]]
binding = "BLOBS"
bucket_name = "my-solid-blobs"

[[rules]]
type = "Text"
globs = ["**/*.html", "**/*.ttl"]
fallthrough = true
```

### 3. Set secrets

```sh
wrangler secret put PAA_PASSWORD    # admin account password
wrangler secret put PAA_DOMAIN      # your domain, e.g. solid.example.com
```

### 4. Set up a custom domain (recommended)

In the Cloudflare dashboard:

1. Add your domain to Cloudflare (if not already)
2. Go to **Workers & Pages** → your worker → **Settings** → **Domains & Routes**
3. Add a custom domain (e.g. `solid.example.com`)

Without a custom domain, your server will be available at `<worker-name>.<subdomain>.workers.dev`, which works but results in a long WebID URL.

### 5. Deploy

```sh
npm run deploy
```

On the first request, the server automatically bootstraps: creates the admin account, generates RSA keypairs for ActivityPub federation and OIDC token signing, initializes root containers, writes a WebID profile document, and sets default access policies.

Visit `https://your-domain.com/login` to sign in with the admin username and password. Other users can register at `https://your-domain.com/signup` (if registration is open).

## Local development

```sh
npm run dev
```

This starts a local server at `http://localhost:8787` with Wrangler's simulated KV and R2 storage.

Create a `.dev.vars` file for local secrets (git-ignored):

```
PAA_PASSWORD=localdevpassword
```

The domain auto-detects as `localhost:8787` in development. Your WebID will be `http://localhost:8787/<username>/profile/card#me`.

## Configuration

| Variable | Where | Default | Description |
|---|---|---|---|
| `PAA_USERNAME` | `wrangler.toml` `[vars]` | `admin` | Admin account username (appears in URLs) |
| `PAA_PASSWORD` | Secret | *(required)* | Admin account password |
| `PAA_DOMAIN` | Secret or `[vars]` | auto-detected | Public domain (e.g. `solid.example.com`) |
| `PAA_STORAGE_LIMIT` | `[vars]` or secret | `1GB` | Default per-user storage limit (e.g. `500MB`, `2GB`) |
| `PAA_FEED_LIMIT` | `[vars]` | `50` | Maximum activities shown in the feed |
| `PAA_REGISTRATION` | `[vars]` | `open` | Registration mode: `open` (anyone can sign up) or `closed` (admin creates accounts) |

**Choosing the admin username**: The admin username appears in URLs (`/alice/profile/card`, `/alice/public/`, etc.) and in the admin's WebID. Pick something short. It cannot be changed after bootstrap without re-creating all data. Additional users choose their own usernames during registration.

## What you get

### Registration (`/signup`)

New users can create an account when registration is open (`PAA_REGISTRATION=open`). Each new account gets its own Solid pod, WebID profile, ActivityPub actor, and RSA keypair. When registration is closed, only the admin can create accounts from the admin panel.

### Dashboard (`/dashboard`)

Overview of your account: WebID, follower/following/post counts, pending follow request notifications, storage breakdown by resource type, and passkey management. On supported browsers, the dashboard silently registers your server as a FedCM identity provider via `IdentityProvider.register()`.

### Profile editor (`/profile`)

Edit your WebID profile fields (name, bio, avatar, homepage, etc.) and manage custom RDF triples. Use the Page Builder to customize your public profile page layout with a tree-based editor. Reset to the default layout if needed.

### Activity feed (`/activity`)

- **Compose** posts with audience selection (public, unlisted, followers-only, private)
- **Follow** fediverse accounts by handle (`user@mastodon.social`), actor URL, or local username
- **Follow requests** — incoming follows require manual approval; accept or reject each request from the activity page
- **Feed** shows inbox and outbox activities merged chronologically, limited to `PAA_FEED_LIMIT` entries
- **Remote feeds** — click any follower or followed account to view their recent public posts

### Remote profile feed (`/activity/remote?actor=<uri>`)

View a remote actor's public outbox, limited to the configured feed limit. Accessible by clicking any follower or following link on the activity page.

### File storage (`/storage/`)

Browse your Solid pod. Upload files, create containers, create and edit text/RDF resources. Each resource links to its access policy editor. Uploads and creates are subject to the global storage quota (`PAA_STORAGE_LIMIT`) and per-container quotas.

### Access policy editor (`/acp/`)

Control who can read your resources:

- **Inherit from parent** — use the same policy as the parent container (default for new resources)
- **Public** — anyone can read
- **Public (unlisted)** — readable with direct link, not listed in container indexes
- **Friends** — only WebIDs in your friends list
- **Private** — only you
- **Custom** — specific WebIDs you choose

Container policies propagate to their contents unless overridden. You can disable inheritance per container to require each child resource to have its own policy.

**Per-container storage quotas**: For containers, the ACP editor includes a storage quota card where you can set a byte limit (e.g. `500MB`). Quotas are hierarchical — a write must satisfy every ancestor container's quota.

### Settings (`/settings`)

Language, locale, appearance, notifications, and app management in one page:

- **Language & locale** — choose from 5 supported languages (English, French, Spanish, Hebrew, Chinese), set date format and timezone
- **Appearance** — custom theme CSS path
- **Notifications** — toggle follow and mention notifications in the activity feed
- **App management** — review, update container access, or revoke OIDC-authenticated Solid apps

Session-authenticated access (via the web UI) always has unrestricted write access to the user's own pod.

### Admin panel (`/admin`)

Available to the admin user only. Provides:

- **Dashboard** — aggregate stats: total users, total storage, total posts, and a per-user breakdown table
- **User management** (`/admin/users`) — disable/enable accounts, set per-user storage quotas, and create new accounts (useful when registration is closed)
- **FedCM IdP management** (`/admin/fedcm-idps`) — add, edit, or remove external FedCM identity providers for cross-server authentication

### Public profile page (`/{username}/`)

Your root container serves a dynamically rendered landing page built from your profile data and a JSON layout. Customize it with the Page Builder in the Profile editor, or reset to the default layout.

### Solid protocol

Each user's pod is accessible at `/{username}/` via standard LDP methods:

```sh
# Read a resource
curl -H "Accept: text/turtle" https://solid.example.com/alice/profile/card

# Create a resource
curl -X PUT \
  -H "Content-Type: text/turtle" \
  -H "Authorization: Bearer <token>" \
  -d '<#this> <http://xmlns.com/foaf/0.1/name> "Alice" .' \
  https://solid.example.com/alice/public/hello.ttl

# Create a container
curl -X POST \
  -H "Slug: notes" \
  -H 'Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' \
  -H "Authorization: Bearer <token>" \
  https://solid.example.com/alice/public/

# SPARQL Update
curl -X PATCH \
  -H "Content-Type: application/sparql-update" \
  -H "Authorization: Bearer <token>" \
  -d 'INSERT DATA { <#this> <http://xmlns.com/foaf/0.1/nick> "ally" . }' \
  https://solid.example.com/alice/public/hello.ttl

# Upload a binary file
curl -X PUT \
  -H "Content-Type: image/png" \
  -H "Authorization: Bearer <token>" \
  --data-binary @photo.png \
  https://solid.example.com/alice/public/photo.png
```

### ActivityPub federation

```sh
# WebFinger discovery
curl https://solid.example.com/.well-known/webfinger?resource=acct:alice@solid.example.com

# Actor document
curl -H "Accept: application/activity+json" https://solid.example.com/alice/profile/card

# Collections
curl -H "Accept: application/activity+json" https://solid.example.com/alice/outbox
curl -H "Accept: application/activity+json" https://solid.example.com/alice/followers
```

Remote servers can follow any account by sending a `Follow` activity to `/{username}/inbox`. Follow requests are held pending until the user accepts or rejects them from the activity page. Users on the same server can follow each other directly without federation overhead.

### OIDC provider

The server acts as an OpenID Connect provider for all users. Solid apps can authenticate any user against it:

```
Discovery:  https://solid.example.com/.well-known/openid-configuration
Authorize:  https://solid.example.com/authorize
Token:      https://solid.example.com/token
UserInfo:   https://solid.example.com/userinfo
JWKS:       https://solid.example.com/jwks
```

When authorizing an app, you choose which pod containers it may write to. Apps that were previously authorized without container selection will be re-prompted.

### FedCM identity provider

The server implements the [Federated Credential Management (FedCM)](https://developer.mozilla.org/en-US/docs/Web/API/FedCM_API) API, allowing browsers to present a native account picker for authentication. This works in two roles:

**As an Identity Provider (IdP):** Third-party websites can use your server to authenticate users via the browser's built-in credential UI, without redirects or popups.

```
Discovery:        https://solid.example.com/.well-known/web-identity
Config:           https://solid.example.com/fedcm/config.json
Accounts:         https://solid.example.com/fedcm/accounts
Assertion:        https://solid.example.com/fedcm/assertion
Client metadata:  https://solid.example.com/fedcm/client-metadata
Disconnect:       https://solid.example.com/fedcm/disconnect
```

**As a Relying Party (RP):** The login and landing pages include a "Sign in with FedCM" button (visible in Chrome 108+) that triggers the browser account picker for returning users, providing a streamlined re-authentication experience without typing credentials.

The FedCM endpoints require the `Sec-Fetch-Dest: webidentity` header (enforced by the browser). The assertion endpoint issues short-lived JWTs (5 minutes) signed with the same RSA key used for OIDC tokens. Connected RPs are tracked per-user in KV and surfaced in the browser account picker via `approved_clients`.

## Security

The server includes defense-in-depth hardening for public-facing deployment:

| Layer | Protection |
|---|---|
| **Rate limiting** | KV-backed sliding window limits on login (10/15min), token (30/min), inbox (60/min), registration (10/hr), and LDP writes (60/min). FedCM assertion and verify endpoints share the token and login limits respectively. Returns 429 with `Retry-After`. |
| **Request size limits** | Content-Length checked before body read: 1 MB for JSON, 5 MB for RDF, 100 MB for binary uploads. Returns 413. |
| **Storage quotas** | Default per-user limit via `PAA_STORAGE_LIMIT` (default 1 GB), overridable per-user by admin. Per-container quotas configurable in the ACP editor. Returns 507. |
| **SSRF protection** | All outbound `fetch()` calls validate URLs — blocks private IPs, localhost, and non-HTTP(S) schemes. |
| **HTTP Signature verification** | Incoming ActivityPub activities require a valid HTTP Signature. Actors without a public key are rejected (401). Date header must be within 5 minutes to prevent replay. |
| **Inbox validation** | Activities missing an `id` field are rejected. Actor URIs are SSRF-validated before fetching. |
| **Security headers** | HTML responses include `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. |
| **Error sanitization** | Internal errors return `Internal Server Error` with no stack traces or error messages exposed. |
| **App write restrictions** | OIDC-authenticated apps can only write to containers the owner explicitly approved during the consent flow. Session-authenticated owner has unrestricted access. |
| **FedCM headers** | Login/logout/registration responses include the `Set-Login` header so browsers can track IdP login state. FedCM account/assertion/disconnect endpoints require `Sec-Fetch-Dest: webidentity`. |

The permissive CORS policy (reflected Origin + credentials) is required by the Solid protocol specification and is not restricted.

## Cloudflare resource usage

This runs on the free tier for low-traffic personal use:

| Resource | Free tier limit | Typical usage |
|---|---|---|
| Workers requests | 100,000/day | Each page view or API call = 1 request |
| KV reads | 100,000/day | ~2-5 reads per LDP request |
| KV writes | 1,000/day | Writes when creating/editing resources |
| R2 storage | 10 GB | Binary files (images, documents, etc.) |
| R2 operations | 1M Class A, 10M Class B/month | Blob reads and writes |

For heavier usage, the Workers Paid plan ($5/month) removes these limits.

## Architecture

```
Cloudflare Worker (single fetch handler)
├── s20e WASM Kernel (Oxigraph SPARQL + WAC)
├── s20e Orchestrator → CloudflareAdapter
│   ├── TRIPLESTORE KV — RDF graphs, indexes, ACLs
│   └── BLOBS R2 — binary files
├── APPDATA KV — sessions, credentials, AP data, access policies, rate limits
├── Security middleware — rate limiting, size limits, SSRF, app permissions
└── Vanilla JS modules — routing, auth, LDP, ActivityPub, UI
```

### Storage layout

**TRIPLESTORE KV** (RDF data):

| Key pattern | Value | Purpose |
|---|---|---|
| `idx:{graph_iri}` | JSON | Index per named graph |
| `doc:{graph_iri}:{subject_iri}` | N-Triples | Subject document |
| `acl:{resource_iri}` | N-Triples | WAC ACL rules |

**APPDATA KV** (application state):

| Key pattern | Value |
|---|---|
| `users_index` | JSON array of `{ username, createdAt, isAdmin, disabled }` |
| `user_meta:{username}` | User metadata `{ createdAt, isAdmin, disabled, storageLimit? }` |
| `user:{username}` | Password hash |
| `session:{token}` | Session JSON (24h TTL) |
| `system_initialized` | Bootstrap flag |
| `oidc_private_key` | Server-wide OIDC signing key (RSA PEM) |
| `oidc_public_key` | Server-wide OIDC verification key (RSA PEM) |
| `acp:{resource_iri}` | Access control policy JSON |
| `webauthn_cred:{user}:{id}` | Passkey credential |
| `ap_private_key:{user}` | Per-user AP RSA private key (PEM) |
| `ap_public_key:{user}` | Per-user AP RSA public key (PEM) |
| `ap_followers:{user}` | JSON array of actor URIs |
| `ap_following:{user}` | JSON array of actor URIs |
| `ap_pending_follows:{user}` | JSON array of pending follow requests |
| `ap_outbox_item:{hash}` | Activity JSON |
| `ap_inbox_item:{hash}` | Activity JSON |
| `quota:{username}` | Storage usage `{ usedBytes }` |
| `container_quota:{iri}` | Container quota `{ usedBytes, limitBytes? }` |
| `ratelimit:{category}:{ip}` | Rate limit window `{ count, windowStart }` |
| `app_perm:{user}:{hash}` | App write permission `{ clientId, allowedContainers[] }` |
| `app_perms_index:{user}` | App permission index |
| `fedcm_connected:{user}` | JSON array of connected FedCM RP client_id strings |
| `fedcm_external_idps` | JSON array of external FedCM IdP configs |
| `user_prefs:{username}` | User preferences JSON (language, timezone, theme, notifications) |

**BLOBS R2**: Binary file data keyed by `blob:{resource_iri}`.

### Project structure

```
src/
├── index.js              # Entry point, route dispatch, rate limiting, size limits
├── router.js             # URL pattern matching
├── config.js             # Environment config (admin user, domain, storage/feed limits, registration mode)
├── users.js              # User CRUD (list, create, disable, enable, quota)
├── bootstrap.js          # First-run + per-user initialization
├── oidc.js               # OpenID Connect provider with app container consent
├── fedcm.js              # FedCM identity provider + relying party endpoints
├── auth/
│   ├── password.js       # PBKDF2 hashing
│   ├── session.js        # KV-backed sessions (multi-user)
│   ├── middleware.js      # Cookie extraction
│   ├── webauthn.js       # Passkey registration/login
│   └── registration.js   # User signup (open/closed registration)
├── admin/
│   ├── middleware.js      # Admin-only route guard
│   ├── dashboard.js       # Admin stats dashboard
│   ├── users.js           # User management (disable, quota, create)
│   └── fedcm-idps.js     # External FedCM IdP management
├── security/
│   ├── rate-limit.js     # KV-backed sliding window rate limiter
│   ├── size-limit.js     # Request Content-Length enforcement
│   └── ssrf.js           # Outbound URL validation (private IP blocking)
├── solid/
│   ├── ldp.js            # LDP handler (GET/PUT/POST/PATCH/DELETE) with quota + app permission checks
│   ├── conneg.js         # Content negotiation
│   ├── containers.js     # Container operations
│   ├── acl.js            # .acl resource handling
│   ├── headers.js        # Solid protocol headers
│   ├── cors.js           # CORS
│   ├── media-types.js    # Extension-to-media-type resolution
│   └── app-permissions.js # OIDC app write permission enforcement
├── activitypub/
│   ├── actor.js          # Actor JSON-LD document
│   ├── webfinger.js      # WebFinger endpoint
│   ├── inbox.js          # S2S inbox with HTTP Signature verification + SSRF protection
│   ├── outbox.js         # Outbox + compose + follow/unfollow + local follow support
│   ├── collections.js    # Followers/following collections
│   ├── httpsig.js        # HTTP Signature sign/verify with date staleness check
│   ├── delivery.js       # Activity fan-out with SSRF protection
│   ├── activities.js     # Activity processors (pending follow requests)
│   └── remote.js         # Remote actor fetch with SSRF protection
├── i18n/
│   ├── index.js          # Language resolution, translation lookup, caching
│   ├── format.js         # Locale-aware date/number/bytes formatting (Intl APIs)
│   └── strings.ttl       # Translation store (Turtle RDF, 5 languages, ~325 keys)
├── rdf/
│   ├── turtle-parser.js  # Turtle parser
│   ├── ntriples.js       # N-Triples parser/serializer
│   └── prefixes.js       # RDF prefix definitions
├── crypto/
│   ├── rsa.js            # RSA keypair generation
│   ├── digest.js         # SHA-256 digest
│   └── cbor.js           # CBOR decoder (WebAuthn)
├── storage/
│   ├── quota.js          # Global storage quota tracking + enforcement
│   └── container-quota.js # Per-container hierarchical quota tracking
└── ui/
    ├── shell.js          # Mustache template renderer + layout + i18n integration
    ├── layout-renderer.js # JSON layout-based profile page renderer
    ├── templates/        # Mustache HTML templates (all strings via {{t.*}} keys)
    ├── client/           # Client-side JS (dialogs, passkeys, etc.)
    └── pages/
        ├── login.js
        ├── dashboard.js
        ├── activity.js       # Activity feed + remote profile feed viewer
        ├── storage.js        # Storage browser with quota enforcement
        ├── acl-editor.js     # ACP editor + per-container quota UI
        ├── profile-editor.js
        ├── settings.js       # Settings (language, appearance, notifications, apps)
        └── app-permissions.js # App write permission POST handler
```

## Design decisions

- **Zero external services** — everything runs within one Cloudflare Worker using KV and R2. No databases, no queues, no external APIs required.
- **s20e WASM kernel** handles SPARQL queries and WAC enforcement. The app writes to KV directly for performance, falling back to the orchestrator for operations that need SPARQL.
- **Direct KV** for ActivityPub data — simple JSON read/write with index arrays. No need for SPARQL here.
- **Web Crypto API** for all cryptography — PBKDF2 password hashing, RSA HTTP Signatures, WebAuthn signature verification.
- **No build tools** beyond Wrangler's built-in esbuild bundling. No frameworks, no transpilers.
- **Server-rendered HTML** with Mustache templates. No client-side JavaScript framework.
- **Multi-user** — each user gets their own Solid pod, WebID profile, and ActivityPub actor. All KV keys are namespaced by username so no data migration is needed when adding users. Registration can be open (self-service) or closed (admin-only).
- **Local following** — users on the same server can follow each other directly without WebFinger resolution or HTTP signature delivery, with the same pending-approval flow as remote follows.
- **Manual follow approval** — incoming Follow requests (remote or local) are stored as pending until the user accepts or rejects them. Accept/Reject activities are delivered back to the requesting actor.
- **App sandboxing** — OIDC-authenticated apps are restricted to writing only within containers the owner approved during the consent flow, preventing unauthorized writes.
- **RDF-based i18n** — UI strings are stored as Turtle RDF with language-tagged literals (`rdfs:label "text"@lang`), parsed once at module load and cached per language per isolate. No external translation service or build step. Locale-aware formatting uses the V8 `Intl` APIs available in Cloudflare Workers.
- **CSS logical properties** — layout uses `margin-inline-start/end`, `padding-inline-start/end`, etc. for automatic RTL mirroring without duplicate stylesheets.

## Troubleshooting

**"PAA_PASSWORD environment variable must be set"** — You haven't set the admin password secret. Run `wrangler secret put PAA_PASSWORD`.

**WebID or actor URLs show `localhost:8787`** — Set `PAA_DOMAIN` to your production domain: `wrangler secret put PAA_DOMAIN`.

**Domain mismatch after changing domains** — The server re-bootstraps all users when it detects a domain change, updating all IRIs. If you see issues, you may need to clear KV data and let it re-bootstrap fresh.

**Federation not working** — Your domain must be publicly accessible over HTTPS. Cloudflare Workers handle HTTPS automatically with custom domains. Check that WebFinger responds correctly: `curl https://yourdomain/.well-known/webfinger?resource=acct:youruser@yourdomain`.

**429 Too Many Requests** — Rate limiting is active. Wait for the `Retry-After` period (shown in the response header) before retrying.

**507 Insufficient Storage** — Storage quota exceeded. Either increase `PAA_STORAGE_LIMIT` (default limit), have the admin set a higher per-user quota at `/admin/users`, or delete unused resources. For container quotas, adjust the limit in the ACP editor.

**403 on OIDC app writes** — The app doesn't have permission to write to the target container. Update its allowed containers at `/settings` (App Management section) or re-authorize the app.

**Registration page returns 403** — Registration is closed (`PAA_REGISTRATION=closed`). The admin can create accounts from the admin panel at `/admin/users`, or change to `PAA_REGISTRATION=open` to allow self-service signup.

## License

[MIT](LICENSE)
