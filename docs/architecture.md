# Architecture

## Overview

The server runs as a single Cloudflare Worker that handles every HTTP request. There is no build step beyond Wrangler's built-in esbuild bundling, no framework, and no external services. All state is stored in Cloudflare KV (key-value) and R2 (object storage).

```
Cloudflare Worker (single fetch handler)
|
+-- s20e WASM Kernel (Oxigraph SPARQL + WAC)
|     Compiled-to-WASM RDF engine. Handles SPARQL queries,
|     SHACL validation, and WAC access control checks.
|     Never performs I/O directly.
|
+-- s20e Orchestrator -> CloudflareAdapter
|     Drives the kernel via a request/response protocol.
|     Fetches data from KV, feeds it to the kernel,
|     writes results back.
|     |
|     +-- TRIPLESTORE KV -- RDF graphs, indexes, WAC ACLs
|     +-- BLOBS R2 -------- Binary files (images, documents)
|
+-- APPDATA KV
|     Direct key-value access for application state:
|     sessions, credentials, ActivityPub data, ACP policies
|
+-- Vanilla JS modules
      Routing, authentication, LDP protocol, ActivityPub
      federation, OIDC provider, server-rendered UI
```

## Request lifecycle

Every request passes through the same path in `src/index.js`:

1. **WASM initialization** — On cold start, the Oxigraph WASM kernel is loaded synchronously via `initSync()`. The kernel instance is reused across requests within the same Worker isolate.

2. **Storage setup** — A `CloudflareAdapter` is created wrapping the `TRIPLESTORE` KV namespace and `BLOBS` R2 bucket. An `Orchestrator` wraps the kernel + adapter for SPARQL operations.

3. **Bootstrap check** — On the very first request (or after a domain change), `ensureBootstrapped()` creates the user account, RSA keypair, root containers, WebID profile, and access policies.

4. **Authentication** — The user is identified from either:
   - A session cookie (`session={token}`) set during login
   - A Bearer/DPoP token in the Authorization header (OIDC)

   For this single-user server, the authenticated user is either the owner or `null` (anonymous).

5. **CORS preflight** — OPTIONS requests get a 204 with permissive CORS headers (required by the Solid protocol for cross-origin apps).

6. **Routing** — The URL is matched against the route table (first match wins). The matched handler receives a `reqCtx` object.

7. **Handler execution** — The handler processes the request and returns a Response.

8. **CORS wrapping** — CORS headers are added to every response.

## The reqCtx object

Every route handler receives a single `reqCtx` object containing everything it needs:

| Property | Type | Description |
|---|---|---|
| `request` | `Request` | The original HTTP request |
| `env` | `object` | Cloudflare Worker env bindings (KV, R2, secrets) |
| `ctx` | `ExecutionContext` | Cloudflare execution context (for `waitUntil`) |
| `url` | `URL` | Parsed URL object |
| `config` | `object` | Server config: `username`, `domain`, `baseUrl`, `webId`, `actorId`, `keyId` |
| `user` | `string\|null` | Authenticated username, or `null` for anonymous |
| `params` | `object` | URL pattern parameters (e.g., `{ user: 'alice' }`) |
| `orchestrator` | `Orchestrator` | s20e orchestrator for SPARQL/WAC operations |
| `storage` | `CloudflareAdapter` | Direct KV/R2 access |

Handlers never access globals. This design makes testing straightforward and keeps the dependency graph explicit.

## Storage architecture

The server uses three storage backends, all provided by Cloudflare:

### TRIPLESTORE (KV namespace)

Stores RDF data using a subject-based document model:

- **Index entries** (`idx:{resourceIri}`) — JSON metadata about a resource: which subjects it contains, whether it's binary.
- **Subject documents** (`doc:{resourceIri}:{subjectIri}`) — N-Triples text containing all triples for one subject within one resource.
- **Metadata** (`doc:{resourceIri}.meta:{resourceIri}`) — Dublin Core metadata for binary resources (content-type, size, creation date).
- **WAC ACLs** (`acl:{resourceIri}`) — Web Access Control rules in N-Triples format (maintained for kernel compatibility).

### APPDATA (KV namespace)

Application state stored as JSON or strings:

- User credentials (password hash, passkeys)
- Sessions (24-hour TTL)
- OIDC authorization codes, refresh tokens, trusted clients
- ActivityPub collections (followers, following, inbox, outbox)
- ACP policies (access control)
- Storage quotas

### BLOBS (R2 bucket)

Binary file data keyed by `blob:{resourceIri}`. R2 provides durable object storage suitable for images, documents, videos, and other non-RDF content.

## Module organization

```
src/
+-- index.js              Entry point: WASM init, routing, request dispatch
+-- router.js             URL pattern matching (regex-compiled)
+-- config.js             Environment config reader
+-- bootstrap.js          First-run server initialization
+-- oidc.js               Solid-OIDC provider (all endpoints)
+-- utils.js              Shared utilities (hash, base64url encoding)
|
+-- auth/                 Authentication
|   +-- password.js       PBKDF2 password hashing (Web Crypto)
|   +-- session.js        KV-backed sessions with TTL
|   +-- middleware.js      Cookie extraction, auth guards
|   +-- webauthn.js        Passkey registration and login
|
+-- solid/                Solid protocol
|   +-- ldp.js            LDP handler (GET/PUT/POST/PATCH/DELETE)
|   +-- conneg.js         Content negotiation (Turtle/JSON-LD/N-Triples)
|   +-- containers.js     Container membership operations
|   +-- acl.js            WAC .acl resource management
|   +-- headers.js        Solid protocol response headers
|   +-- cors.js           CORS header injection
|
+-- activitypub/          Federation
|   +-- actor.js          Actor document (JSON-LD, content-negotiated)
|   +-- webfinger.js      WebFinger discovery endpoint
|   +-- inbox.js          S2S inbox with HTTP Signature verification
|   +-- outbox.js         Outbox collection and compose/follow/unfollow
|   +-- collections.js    Followers/following OrderedCollections
|   +-- httpsig.js        HTTP Signature signing and verification
|   +-- delivery.js       Activity fan-out via waitUntil()
|   +-- activities.js     Activity type processors and builders
|   +-- remote.js         Remote actor fetch with KV cache
|
+-- rdf/                  RDF processing
|   +-- turtle-parser.js  Turtle parser (subset)
|   +-- turtle-serializer.js  Turtle serializer with prefix shorthand
|   +-- ntriples.js       N-Triples/N-Quads parser and serializer
|   +-- prefixes.js       Common RDF namespace prefixes
|
+-- crypto/               Cryptographic primitives (Web Crypto API)
|   +-- rsa.js            RSA-2048 key generation, signing, verification
|   +-- digest.js         SHA-256 digest utilities
|   +-- cbor.js           Minimal CBOR decoder (for WebAuthn)
|
+-- storage/              Storage helpers
|   +-- binary.js         Binary upload/download via orchestrator
|   +-- metadata.js       Dublin Core metadata generation
|   +-- quota.js          Storage quota tracking
|
+-- ui/                   Server-rendered UI
    +-- shell.js          Mustache template rendering pipeline
    +-- styles/base.css   All CSS (inlined into every page)
    +-- client/           Client-side JavaScript (dialogs, passkeys)
    +-- templates/        Mustache HTML templates
    +-- pages/            Page handlers (dashboard, storage, etc.)
```

## Design decisions

**Single-user, single-worker**: One username, one pod, one ActivityPub actor. This simplifies access control (authenticated user = owner) and avoids multi-tenant complexity. KV eventual consistency is acceptable because write contention is rare.

**Direct KV over orchestrator**: Most operations write to KV directly rather than going through the s20e orchestrator. The orchestrator is used for operations that need SPARQL queries or WAC enforcement (e.g., binary uploads via `uploadBinary()`). Direct KV writes are faster and avoid the overhead of the WASM kernel for simple read/write patterns.

**Server-rendered HTML**: All UI is rendered server-side using Mustache templates. No client-side JavaScript framework. The only client-side JS is for progressive enhancement (dialog modals, passkey registration, ACP toggle).

**Web Crypto API only**: All cryptography uses the Web Crypto API available in Cloudflare Workers. PBKDF2 for password hashing, RSA-2048 for HTTP Signatures and JWT signing, ECDSA/RSA for WebAuthn signature verification, SHA-256 for digests.

**No build tools**: The project has no build step, bundler config, or transpiler. Wrangler's built-in esbuild handles bundling JavaScript and inlining `.html`, `.css`, and client `.js` files as text strings.
