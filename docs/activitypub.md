# ActivityPub Federation

The server implements [ActivityPub](https://www.w3.org/TR/activitypub/) for federation with Mastodon, Pixelfed, and other fediverse servers. It supports both server-to-server (S2S) inbox delivery and client-to-server (C2S) activity creation via the web UI.

## Actor document

The actor endpoint is content-negotiated on `/{username}/profile/card`:

- `Accept: application/activity+json` or `application/ld+json` with activitystreams profile returns the ActivityPub actor
- `Accept: text/turtle` (default) returns the Solid WebID profile

**Actor JSON-LD:**
```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1"
  ],
  "type": "Person",
  "id": "https://example.com/alice/profile/card#me",
  "inbox": "https://example.com/alice/inbox",
  "outbox": "https://example.com/alice/outbox",
  "followers": "https://example.com/alice/followers",
  "following": "https://example.com/alice/following",
  "preferredUsername": "alice",
  "name": "alice",
  "url": "https://example.com/alice/profile/card",
  "publicKey": {
    "id": "https://example.com/alice/profile/card#main-key",
    "owner": "https://example.com/alice/profile/card#me",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..."
  }
}
```

Cached with `Cache-Control: max-age=300` (5 minutes).

## WebFinger

Remote servers discover the actor via WebFinger:

```
GET /.well-known/webfinger?resource=acct:alice@example.com
```

Response (`application/jrd+json`):
```json
{
  "subject": "acct:alice@example.com",
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://example.com/alice/profile/card#me"
    },
    {
      "rel": "http://webfinger.net/rel/profile-page",
      "type": "text/html",
      "href": "https://example.com/alice/profile/card"
    }
  ]
}
```

## Inbox (server-to-server)

`POST /{username}/inbox` receives activities from remote servers.

### Processing flow

1. Parse JSON body as an Activity
2. Validate `activity.type` and `activity.actor` are present
3. Fetch the sender's actor document from their server (cached in KV for 1 hour)
4. Extract the sender's public key from the actor document
5. Verify the HTTP Signature on the request (see below)
6. Dispatch by activity type
7. Store the activity in the inbox

### Supported activity types

| Type | Action |
|---|---|
| `Follow` | Auto-accept: adds the sender to `ap_followers:{username}`, sends back an `Accept(Follow)` activity to the sender's inbox |
| `Accept` | If accepting a Follow we sent: adds the target to `ap_following:{username}` |
| `Undo` | If undoing a Follow: removes the sender from `ap_followers:{username}` |
| `Create` | Stores the activity in the inbox (for any content type — Notes, Articles, etc.) |
| Other | Stored in inbox without special processing |

### Response

Always returns `202 Accepted` after successful signature verification, regardless of activity type.

## Outbox

`GET /{username}/outbox` returns an `OrderedCollection`.

### Without pagination

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "OrderedCollection",
  "id": "https://example.com/alice/outbox",
  "totalItems": 42,
  "first": "https://example.com/alice/outbox?page=0",
  "last": "https://example.com/alice/outbox?page=2"
}
```

### With pagination (`?page=N`)

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "OrderedCollectionPage",
  "id": "https://example.com/alice/outbox?page=0",
  "partOf": "https://example.com/alice/outbox",
  "orderedItems": [
    { "type": "Create", "object": { "type": "Note", "content": "Hello!" }, ... }
  ],
  "next": "https://example.com/alice/outbox?page=1"
}
```

Page size: 20 items.

## Composing activities (web UI)

### Create a post

`POST /compose` (form data):

| Field | Description |
|---|---|
| `content` | Post content (required) |
| `summary` | Content warning / summary (optional) |
| `audience` | `public`, `unlisted`, `followers`, or `private` (default: `public`) |

**Audience addressing:**

| Audience | `to` | `cc` |
|---|---|---|
| `public` | `as:Public` | followers collection |
| `unlisted` | followers collection | `as:Public` |
| `followers` | followers collection | (empty) |
| `private` | (empty) | (empty) |

**Generated Create(Note) activity:**
```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://example.com/alice/outbox/{uuid}",
  "actor": "https://example.com/alice/profile/card#me",
  "published": "2025-01-15T10:30:00.000Z",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "cc": ["https://example.com/alice/followers"],
  "object": {
    "type": "Note",
    "id": "https://example.com/alice/posts/{uuid}",
    "attributedTo": "https://example.com/alice/profile/card#me",
    "content": "Hello, fediverse!",
    "published": "2025-01-15T10:30:00.000Z",
    "to": ["https://www.w3.org/ns/activitystreams#Public"],
    "cc": ["https://example.com/alice/followers"]
  }
}
```

After storing in the outbox, the activity is delivered to all followers' inboxes (unless audience is `private`).

### Follow an actor

`POST /follow` (form data):

| Field | Description |
|---|---|
| `target` | Actor URI or handle (`user@domain.com`) |

If a handle is provided, it's resolved to an actor URI via WebFinger. A `Follow` activity is sent to the target's inbox.

### Unfollow an actor

`POST /unfollow` (form data):

| Field | Description |
|---|---|
| `target` | Actor URI |

Removes the actor from the local following list and sends an `Undo(Follow)` activity.

## Collections

`GET /{username}/followers` and `GET /{username}/following` return `OrderedCollection` with pagination, using the same format as the outbox.

## HTTP Signatures

ActivityPub uses [HTTP Signatures (draft-cavage-http-signatures-12)](https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12) for server-to-server authentication.

### Signing outgoing requests

When delivering activities, each request is signed with the server's RSA private key:

1. Generate `Date` header (RFC 5322 format)
2. Generate `Digest` header: `SHA-256={base64(sha256(body))}`
3. Build the signing string from the headers:
   ```
   (request-target): post /alice/inbox
   host: remote.example.com
   date: Sat, 15 Jan 2025 10:30:00 GMT
   digest: SHA-256=base64...
   ```
4. Sign with RSASSA-PKCS1-v1_5 SHA-256
5. Add `Signature` header:
   ```
   keyId="https://example.com/alice/profile/card#main-key",
   algorithm="rsa-sha256",
   headers="(request-target) host date digest",
   signature="base64..."
   ```

### Verifying incoming requests

When receiving activities at the inbox:

1. Parse the `Signature` header to extract `keyId`, `headers`, and `signature`
2. Fetch the sender's actor document using the `keyId`
3. Extract the public key PEM from the actor's `publicKey` field
4. Reconstruct the signing string using the specified headers
5. Verify the signature using the sender's RSA public key

## Delivery

Activities are delivered asynchronously using Cloudflare Workers' `ctx.waitUntil()`. This allows the inbox/compose handler to return immediately while delivery happens in the background.

For each follower:
1. Fetch the follower's actor document (cached for 1 hour)
2. Extract their inbox URL
3. Sign and POST the activity JSON to their inbox
4. Log errors (no retry mechanism)

Inbox URLs are deduplicated to avoid sending duplicate activities to shared inboxes.

## Activity storage

Activities are stored by hash of their ID:

```
hash = simpleHash(activity.id)  // DJB2-like, base-36 encoded
key  = "ap_outbox_item:{hash}" or "ap_inbox_item:{hash}"
```

Index arrays track chronological order:
```json
[
  {"id": "https://example.com/alice/outbox/uuid1", "published": "2025-01-15T10:30:00Z"},
  {"id": "https://example.com/alice/outbox/uuid2", "published": "2025-01-14T09:00:00Z"}
]
```

Indexes are capped at 500 entries (oldest removed when exceeded).
