# Deployment & Configuration

## Prerequisites

- **Node.js** 20+
- **Wrangler CLI** (`npm install -g wrangler`)
- A **Cloudflare account** (free tier works for personal use)

## Configuration

All configuration is via environment variables and Wrangler secrets.

| Variable | Where | Default | Description |
|---|---|---|---|
| `PAA_USERNAME` | `wrangler.toml` `[vars]` | `admin` | Your username. Appears in all URLs and your WebID. Cannot be changed after bootstrap without re-creating all data. |
| `PAA_PASSWORD` | Secret | *(required)* | Login password. Set via `wrangler secret put PAA_PASSWORD`. |
| `PAA_DOMAIN` | Secret or `[vars]` | auto-detected from request | Production domain (e.g., `solid.example.com`). Set via `wrangler secret put PAA_DOMAIN`. |

### wrangler.toml

```toml
name = "my-solid-server"
main = "src/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
PAA_USERNAME = "alice"

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
globs = ["**/*.html", "**/*.css", "**/client/*.js"]
fallthrough = true
```

The `[[rules]]` section tells Wrangler to bundle HTML, CSS, and client JS files as text strings (imported by the template rendering system).

### Local development

Create a `.dev.vars` file (git-ignored) for local secrets:

```
PAA_PASSWORD=localdevpassword
```

Run the development server:

```sh
npm run dev
```

This starts at `http://localhost:8787` with Wrangler's simulated KV and R2 storage. The domain auto-detects as `localhost:8787`.

## Cloudflare resources

### Creating resources

```sh
wrangler login
wrangler kv namespace create TRIPLESTORE
wrangler kv namespace create APPDATA
wrangler r2 bucket create my-solid-blobs
```

Copy the returned namespace IDs into `wrangler.toml`.

### Custom domain

For a clean WebID URL, add a custom domain in the Cloudflare dashboard:

1. Add your domain to Cloudflare (if not already)
2. Go to **Workers & Pages** → your worker → **Settings** → **Domains & Routes**
3. Add your custom domain (e.g., `solid.example.com`)

Without a custom domain, the server runs at `<worker-name>.<subdomain>.workers.dev`.

### Deploying

```sh
npm run deploy
```

This runs `wrangler deploy` which bundles the code with esbuild and uploads to Cloudflare.

## Bootstrap

The server bootstraps automatically on the first request. Bootstrap is idempotent and creates:

1. **User record** — hashes `PAA_PASSWORD` and stores in APPDATA
2. **RSA keypair** — 2048-bit RSA key for ActivityPub HTTP Signatures and JWT signing
3. **ActivityPub collections** — empty followers, following, inbox, outbox
4. **Root containers** — `/{username}/`, `/profile/`, `/public/`, `/private/`, `/settings/`
5. **WebID profile** — `/{username}/profile/card` with `foaf:Person` triples, OIDC issuer, storage root, inbox, public key
6. **TypeIndex** — private and public type index documents in `/settings/`
7. **Landing page** — default `index.html` in the root container (Mustache template rendered with profile data)
8. **Access policies** — ACP policies for all containers (root private, profile public, public public, private private)

### Domain changes

If the `PAA_DOMAIN` changes (or was never set), the server detects the mismatch and re-bootstraps, updating all IRIs to use the new domain. This happens automatically on the next request.

### Migration hooks

The bootstrap process includes migration checks for existing installations:

- **ACP policies** — creates default policies if missing (for pre-ACP installs)
- **TypeIndex** — creates TypeIndex documents and profile references if missing

## Cloudflare free tier limits

| Resource | Free tier limit | Typical usage |
|---|---|---|
| Workers requests | 100,000/day | Each page view or API call = 1 request |
| KV reads | 100,000/day | ~2-5 reads per LDP request |
| KV writes | 1,000/day | Writes when creating/editing resources |
| R2 storage | 10 GB | Binary files (images, documents, etc.) |
| R2 Class A operations | 1,000,000/month | Blob writes |
| R2 Class B operations | 10,000,000/month | Blob reads |

The Workers Paid plan ($5/month) removes request and KV limits.

## Troubleshooting

### "PAA_PASSWORD environment variable must be set"

The password secret hasn't been configured. Run:

```sh
wrangler secret put PAA_PASSWORD
```

### WebID or URLs show localhost:8787

The `PAA_DOMAIN` secret isn't set for production. Run:

```sh
wrangler secret put PAA_DOMAIN
```

Enter your production domain (e.g., `solid.example.com`, without protocol).

### Domain mismatch after changing domains

The server re-bootstraps when it detects a domain change. If you see inconsistencies, you can clear all KV data to force a clean bootstrap:

```sh
# WARNING: This deletes all data
wrangler kv:bulk delete --namespace-id=<TRIPLESTORE_ID> --all
wrangler kv:bulk delete --namespace-id=<APPDATA_ID> --all
```

### Federation not working

1. Verify your domain is publicly accessible over HTTPS
2. Check WebFinger responds correctly:
   ```sh
   curl https://yourdomain/.well-known/webfinger?resource=acct:youruser@yourdomain
   ```
3. Verify the actor document is accessible:
   ```sh
   curl -H "Accept: application/activity+json" https://yourdomain/youruser/profile/card
   ```
4. Check the RSA public key is present in the actor document

### Build fails

Ensure you have Node.js 20+ installed. The s20e packages are installed from JSR automatically via `npm install`.

```sh
node --version  # Should be 20+
npm install
npx wrangler deploy --dry-run  # Test build without deploying
```
