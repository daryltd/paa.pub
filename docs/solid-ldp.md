# Solid / LDP Protocol

The server implements the [Linked Data Platform](https://www.w3.org/TR/ldp/) (LDP) protocol as specified by the [Solid Protocol](https://solidproject.org/TR/protocol). All LDP operations are handled by `src/solid/ldp.js`.

## Resource types

### RDF resources

Stored as N-Triples text in KV, grouped by subject:

- `idx:{iri}` — `{"subjects": ["subject1", "subject2"]}`
- `doc:{iri}:{subject1}` — N-Triples for subject1
- `doc:{iri}:{subject2}` — N-Triples for subject2

This subject-based grouping allows efficient reads: a document with 3 subjects requires 4 KV reads (1 index + 3 subject docs), all fetched in parallel.

### Binary resources

Stored as blobs in R2 with metadata in KV:

- `idx:{iri}` — `{"binary": true}`
- `blob:{iri}` — raw file bytes (R2)
- `doc:{iri}.meta:{iri}` — Dublin Core metadata (content-type, size, timestamps)

### Containers

Containers are RDF resources whose IRI ends with `/`. Their membership is tracked via `ldp:contains` triples in the container's own subject document. Every container has at least an `ldp:BasicContainer` type triple.

## GET / HEAD

Reads a resource and returns it in the negotiated format.

**Flow:**
1. Look up `idx:{iri}` in KV
2. If not found, check for an orphan blob in R2 (`blob:{iri}`)
3. Run ACP access check (owner access handled internally)
4. If binary: fetch blob from R2, read content-type from metadata, serve
5. If RDF: fetch all subject documents in parallel, parse N-Triples, content-negotiate, serialize

**Content negotiation:**

| Accept header | Response Content-Type |
|---|---|
| `text/turtle` (default) | `text/turtle` |
| `application/ld+json` | `application/ld+json` |
| `application/n-triples` | `application/n-triples` |

**Response headers:**
- `Content-Type` — negotiated type
- `Link` — LDP resource type, ACL, ACR, and describedby links
- `WAC-Allow` — user/public access modes
- `Cache-Control` — `public, max-age=300` for public resources, `private, no-store` for private
- `Allow` — supported HTTP methods
- `Accept-Patch` — `text/n3, application/sparql-update`
- `Vary` — `Accept, Authorization, Origin`

**Special case: Container + HTML Accept**

When a browser requests a container with `Accept: text/html`, the handler looks for an `index.html` blob inside the container. If found:
- The root container's `index.html` is rendered through Mustache with profile data (name, bio, avatar, etc.)
- Other containers' `index.html` is served as-is
- If no `index.html` exists, falls through to the RDF container listing

## PUT

Creates or replaces a resource.

**Binary content** (detected by Content-Type prefix: `image/`, `video/`, `audio/`, `application/pdf`, `application/zip`, `application/octet-stream`, `application/gzip`):
- Uploaded via `orchestrator.uploadBinary()` to R2
- Metadata N-Quads generated with content-type and byte length

**RDF content** (Turtle, N-Triples, JSON-LD):
- Parsed into triples
- If replacing an existing resource, old triples are deleted first
- Triples grouped by subject and written to KV
- Container type triples auto-added for container IRIs

**Parent containers** are auto-created if they don't exist, with containment triples linking each level.

**Response:** 201 Created (new) or 204 No Content (replaced)

## POST

Creates a new resource inside a container.

**Resource naming:** The `Slug` header provides the desired name. If absent, a random UUID is used. The `slugToName()` function sanitizes the slug.

**Container creation:** If the `Link` header contains `rel="type"` with `BasicContainer`, a new sub-container is created with type triples.

**Binary content:** Same detection and handling as PUT.

**RDF content:** Parsed and written to KV via `writeTriplesToKV()`.

In all cases, an `ldp:contains` triple is added to the parent container.

**Response:** 201 Created with `Location` header

## PATCH

Applies a SPARQL Update to an existing resource.

**Content-Type:** Must be `application/sparql-update` (returns 415 otherwise).

**Supported SPARQL patterns:**

```sparql
-- Insert only
INSERT DATA {
  <#me> <http://xmlns.com/foaf/0.1/name> "Alice" .
}

-- Delete only
DELETE DATA {
  <#me> <http://xmlns.com/foaf/0.1/name> "Bob" .
}

-- Combined delete + insert (WHERE clause is ignored)
DELETE { <#me> <http://xmlns.com/foaf/0.1/name> ?old . }
INSERT { <#me> <http://xmlns.com/foaf/0.1/name> "Alice" . }
WHERE  { <#me> <http://xmlns.com/foaf/0.1/name> ?old . }
```

PREFIX declarations are extracted and applied to all blocks. Blocks are parsed as Turtle.

**Algorithm:**
1. Read all existing triples from KV (parallel fetch)
2. Build a deletion set from `DELETE` block triples
3. Filter out matching triples (exact string match on `subject predicate object`)
4. Append `INSERT` block triples
5. Write result back to KV

**Response:** 204 No Content (existing) or 201 Created (new resource)

## DELETE

Removes a resource and all associated data. Owner-only operation.

**Deleted keys:**
- `idx:{iri}` — resource index
- `doc:{iri}:{subject}` — all subject documents
- `blob:{iri}` — binary blob (R2)
- `doc:{iri}.meta:{iri}` — metadata
- `acl:{iri}` — WAC ACL
- `acp:{iri}` — ACP policy

Also removes the `ldp:contains` triple from the parent container.

**Response:** 204 No Content

## Turtle parser

The built-in Turtle parser (`src/rdf/turtle-parser.js`) handles the subset of Turtle used by Solid:

**Supported:**
- `@prefix` and `PREFIX` declarations
- `@base` declarations
- Full IRIs (`<http://...>`), prefixed names (`foaf:name`), relative IRIs (`<#me>`)
- `a` keyword (shorthand for `rdf:type`)
- String literals (plain, language-tagged, datatyped)
- Multi-line literals (triple-quoted)
- Blank nodes (`_:label`)
- Predicate-object lists (`;` separator)
- Object lists (`,` separator)
- Single-line comments (`#`)

**Not supported:**
- Collections / lists (`(a b c)`)
- Nested blank nodes (`[ :p :o ]`)
- Bare numeric/boolean literals (use `"123"^^xsd:integer` instead)

## LDP examples

```sh
# Read a Turtle resource
curl -H "Accept: text/turtle" https://example.com/alice/profile/card

# Create a resource via PUT
curl -X PUT \
  -H "Content-Type: text/turtle" \
  -H "Authorization: Bearer <token>" \
  -d '<#this> <http://xmlns.com/foaf/0.1/name> "Alice" .' \
  https://example.com/alice/public/hello.ttl

# Create a resource via POST (server assigns name from Slug)
curl -X POST \
  -H "Slug: notes" \
  -H "Content-Type: text/turtle" \
  -H "Authorization: Bearer <token>" \
  -d '<> a <http://schema.org/TextDigitalDocument> .' \
  https://example.com/alice/public/

# Create a container
curl -X POST \
  -H "Slug: photos" \
  -H 'Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' \
  -H "Authorization: Bearer <token>" \
  https://example.com/alice/public/

# SPARQL Update
curl -X PATCH \
  -H "Content-Type: application/sparql-update" \
  -H "Authorization: Bearer <token>" \
  -d 'PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      INSERT DATA { <#me> foaf:nick "ally" . }' \
  https://example.com/alice/profile/card

# Upload a binary file
curl -X PUT \
  -H "Content-Type: image/png" \
  -H "Authorization: Bearer <token>" \
  --data-binary @photo.png \
  https://example.com/alice/public/photo.png

# Delete a resource
curl -X DELETE \
  -H "Authorization: Bearer <token>" \
  https://example.com/alice/public/hello.ttl
```
