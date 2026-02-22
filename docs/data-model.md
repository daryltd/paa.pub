# Data Model

All server state is stored in two Cloudflare KV namespaces (`TRIPLESTORE` and `APPDATA`) and one R2 bucket (`BLOBS`). This document lists every key pattern, its value format, and its purpose.

## TRIPLESTORE KV

Stores RDF data using a subject-based document model. Managed by the application and the s20e orchestrator.

### Resource indexes

| Key | Value | Description |
|---|---|---|
| `idx:{resourceIri}` | JSON | Index for a resource. Lists its subjects and whether it's binary. |

**RDF resource index:**
```json
{
  "subjects": ["https://example.com/alice/profile/card#me", "https://example.com/alice/profile/card"]
}
```

**Binary resource index:**
```json
{
  "subjects": ["https://example.com/alice/public/photo.png"],
  "binary": true
}
```

### Subject documents

| Key | Value | Description |
|---|---|---|
| `doc:{resourceIri}:{subjectIri}` | N-Triples text | All triples for one subject within one resource. |

Example key: `doc:https://example.com/alice/profile/card:https://example.com/alice/profile/card#me`

Example value:
```
<https://example.com/alice/profile/card#me> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://xmlns.com/foaf/0.1/Person> .
<https://example.com/alice/profile/card#me> <http://xmlns.com/foaf/0.1/name> "Alice" .
```

### Resource metadata

| Key | Value | Description |
|---|---|---|
| `doc:{resourceIri}.meta:{resourceIri}` | N-Triples text | Dublin Core metadata for binary resources. |

Example value:
```
<https://example.com/alice/public/photo.png> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://schema.org/DigitalDocument> .
<https://example.com/alice/public/photo.png> <http://purl.org/dc/terms/format> "image/png" .
<https://example.com/alice/public/photo.png> <http://purl.org/dc/terms/extent> "145832"^^<http://www.w3.org/2001/XMLSchema#integer> .
<https://example.com/alice/public/photo.png> <http://purl.org/dc/terms/created> "2025-01-15T10:30:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
<https://example.com/alice/public/photo.png> <http://purl.org/dc/terms/title> "photo.png" .
```

### Container membership

Containers track their children using `ldp:contains` triples in the container's own subject document:

Key: `doc:{containerIri}:{containerIri}`

```
<https://example.com/alice/public/> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/ns/ldp#BasicContainer> .
<https://example.com/alice/public/> <http://www.w3.org/ns/ldp#contains> <https://example.com/alice/public/photo.png> .
<https://example.com/alice/public/> <http://www.w3.org/ns/ldp#contains> <https://example.com/alice/public/notes/> .
```

### WAC ACLs

| Key | Value | Description |
|---|---|---|
| `acl:{resourceIri}` | N-Triples text | Web Access Control rules. Maintained for kernel compatibility. |

## APPDATA KV

Application state stored as JSON strings.

### User credentials

| Key | Value | TTL |
|---|---|---|
| `user:{username}` | PBKDF2 password hash string | permanent |

### Sessions

| Key | Value | TTL |
|---|---|---|
| `session:{token}` | `{"username": "alice", "createdAt": "..."}` | 24 hours |

### Passkey credentials (WebAuthn)

| Key | Value | TTL |
|---|---|---|
| `webauthn_creds:{username}` | `["credId1", "credId2"]` | permanent |
| `webauthn_cred:{username}:{credId}` | Credential JSON (see below) | permanent |
| `webauthn_challenge:{challenge}` | `{"username": "alice", "type": "registration"}` | 60 seconds |

**Credential JSON:**
```json
{
  "publicKeyJwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "base64url...",
    "y": "base64url..."
  },
  "signCount": 0,
  "name": "Passkey 2025-01-15",
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

### OIDC tokens

| Key | Value | TTL |
|---|---|---|
| `oidc_code:{code}` | Authorization code params JSON | 2 minutes |
| `oidc_refresh:{token}` | `{"clientId": "...", "scope": "...", "dpopJkt": "..."}` | 30 days |
| `oidc_trusted_clients:{username}` | `["clientId1", "clientId2"]` | permanent |

**Authorization code JSON:**
```json
{
  "username": "alice",
  "clientId": "https://app.example.com",
  "redirectUri": "https://app.example.com/callback",
  "scope": "openid webid",
  "codeChallenge": "base64url...",
  "codeChallengeMethod": "S256",
  "nonce": "random...",
  "issuedAt": 1705312200
}
```

### Access control policies

| Key | Value | TTL |
|---|---|---|
| `acp:{resourceIri}` | Policy JSON (see [Access Control](access-control.md)) | permanent |
| `friends:{username}` | `["https://bob.example/profile/card#me"]` | permanent |

### ActivityPub data

| Key | Value | TTL |
|---|---|---|
| `ap_private_key:{username}` | RSA private key (PEM string) | permanent |
| `ap_public_key:{username}` | RSA public key (PEM string) | permanent |
| `ap_followers:{username}` | `["https://mastodon.social/users/bob"]` | permanent |
| `ap_following:{username}` | `["https://mastodon.social/users/carol"]` | permanent |
| `ap_outbox_index:{username}` | `[{"id": "...", "published": "..."}]` | permanent |
| `ap_inbox_index:{username}` | `[{"id": "...", "published": "..."}]` | permanent |
| `ap_outbox_item:{hash}` | Activity JSON object | permanent |
| `ap_inbox_item:{hash}` | Activity JSON object | permanent |
| `ap_remote_actor:{hash}` | Cached remote actor JSON | 1 hour |

Index entries are arrays of `{ id, published }` objects sorted newest-first, capped at 500 items. The `{hash}` is a DJB2-like hash of the activity ID, encoded as base-36.

### Storage quota

| Key | Value | TTL |
|---|---|---|
| `quota:{username}` | `{"usedBytes": 145832}` | permanent |

### System flags

| Key | Value | TTL |
|---|---|---|
| `user_initialized` | `"true"` | permanent |
| `bootstrap_domain` | `"example.com"` | permanent |

## BLOBS R2

Binary file data stored in Cloudflare R2.

| Key | Value | Description |
|---|---|---|
| `blob:{resourceIri}` | Raw binary data | File content (images, documents, HTML, etc.) |

The content type is not stored in R2 metadata — it's stored in the TRIPLESTORE metadata document (`doc:{iri}.meta:{iri}`) as a `dcterms:format` triple.

## RDF prefixes

These namespace prefixes are used throughout the codebase and in stored RDF data:

| Prefix | Namespace |
|---|---|
| `rdf` | `http://www.w3.org/1999/02/22-rdf-syntax-ns#` |
| `rdfs` | `http://www.w3.org/2000/01/rdf-schema#` |
| `xsd` | `http://www.w3.org/2001/XMLSchema#` |
| `ldp` | `http://www.w3.org/ns/ldp#` |
| `acl` | `http://www.w3.org/ns/auth/acl#` |
| `acp` | `http://www.w3.org/ns/solid/acp#` |
| `foaf` | `http://xmlns.com/foaf/0.1/` |
| `solid` | `http://www.w3.org/ns/solid/terms#` |
| `dcterms` | `http://purl.org/dc/terms/` |
| `vcard` | `http://www.w3.org/2006/vcard/ns#` |
| `space` | `http://www.w3.org/ns/pim/space#` |
| `schema` | `https://schema.org/` |
| `as` | `https://www.w3.org/ns/activitystreams#` |
| `sec` | `https://w3id.org/security#` |
