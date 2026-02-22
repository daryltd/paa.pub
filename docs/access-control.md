# Access Control

The server uses an Access Control Policy (ACP) system stored in the APPDATA KV namespace. Policies control who can read resources; the owner always has full access.

## Policy format

Policies are stored as JSON at `acp:{resourceIri}` in APPDATA KV:

```json
{
  "mode": "inherit",
  "agents": [],
  "inherit": true
}
```

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `"inherit"` | Access control mode (see table below) |
| `agents` | string[] | `[]` | WebIDs granted access (only used in `custom` mode) |
| `inherit` | boolean | `true` | Whether children can inherit this policy. Only meaningful on containers. |

### Modes

| Mode | Who can read | Listed in container | Use case |
|---|---|---|---|
| `inherit` | Defers to parent container | Defers to parent | Default for new resources |
| `public` | Anyone | Yes | Publicly discoverable content |
| `unlisted` | Anyone with the direct URL | No | Shareable but not indexed |
| `friends` | WebIDs in the friends list | No | Restricted to known contacts |
| `private` | Owner only | No | Personal/confidential content |
| `custom` | WebIDs listed in `agents` | No | Specific individuals |

## Inheritance

Resources default to `inherit` mode, meaning they don't have their own policy and defer to their parent container. This creates a hierarchical access control system where setting a container to `public` makes all its contents public (unless individually overridden).

### Resolution algorithm

When checking access for a resource (`checkAcpAccess()` in `src/ui/pages/acl-editor.js`):

```
1. Owner check:
   If the requesting agent's WebID matches the owner's WebID,
   grant full access immediately.

2. Resource's own policy:
   Look up acp:{resourceIri} in KV.
   - If found and mode != 'inherit': evaluate this policy, done.
   - If found and mode == 'inherit': skip, walk up.
   - If not found: skip, walk up.

3. Walk up the container hierarchy:
   Remove the last path segment to get the parent container IRI.
   For each ancestor:
   a. Look up acp:{ancestorIri}
   b. If not found: continue up
   c. If found with inherit === false: STOP, deny access (private)
   d. If found with mode === 'inherit': continue up
   e. If found with an explicit mode: evaluate this policy, done.

4. No policy found:
   If no ancestor has an explicit policy, deny access (private by default).
```

### Inheritance blocking

A container's `inherit` flag controls whether its children can inherit through it:

- `inherit: true` (default) — children without their own policy will use this container's policy
- `inherit: false` — blocks inheritance. Children that reach this container during the walk-up will be denied access. Each child must set its own policy.

This is useful for containers where you want fine-grained per-resource control.

### Root container

The root user container (`/{username}/`) cannot use `inherit` mode because it has no parent. It must have an explicit mode. Bootstrap sets it to `private` by default.

## Default policies (bootstrap)

The bootstrap process creates these initial policies:

| Resource | Mode | Inherit | Rationale |
|---|---|---|---|
| `/{username}/` | `private` | `true` | Root container: private by default |
| `/{username}/profile/` | `public` | `true` | Profile must be publicly readable |
| `/{username}/profile/card` | `public` | `false` | WebID document: always public |
| `/{username}/public/` | `public` | `true` | Explicitly public content |
| `/{username}/private/` | `private` | `true` | Explicitly private content |
| `/{username}/settings/` | `private` | `true` | Configuration data |
| `/{username}/index.html` | `public` | `false` | Public landing page |

## Friends list

The `friends` mode uses a shared friends list stored at `friends:{username}` in APPDATA KV. Friends can be managed from the ACP editor UI.

```json
["https://bob.example/profile/card#me", "https://carol.example/profile/card#me"]
```

Any resource set to `friends` mode will be readable by all WebIDs in this list.

## Cache-Control integration

The ACP evaluation result determines the `Cache-Control` header on responses:

| Access result | Cache-Control | Rationale |
|---|---|---|
| `listed: true` (public) | `public, max-age=300` | Safe for CDN caching |
| `listed: false` (non-public) | `private, no-store` | Must not be cached by intermediaries |
| Access denied | `no-store` | Error responses never cached |

This prevents private content from being cached at the CDN layer and served to unauthenticated requests.

## WAC compatibility

The server also maintains WAC (Web Access Control) ACLs in the `acl:{resourceIri}` keys of the TRIPLESTORE KV namespace. These are used by the s20e kernel for compatibility with the Solid WAC specification. The ACP system takes precedence for access decisions in the application layer.

WAC ACLs can be managed directly via the `.acl` suffix on any resource URL:

```sh
# Read ACL
curl https://example.com/alice/public/.acl

# Write ACL
curl -X PUT \
  -H "Content-Type: text/turtle" \
  -d '@prefix acl: <http://www.w3.org/ns/auth/acl#> . ...' \
  https://example.com/alice/public/.acl
```

## ACP editor UI

The web-based editor at `/acp/{path}` provides:

- Radio buttons for all access modes (inherit shown first for non-root resources)
- Effective policy display when in inherit mode (shows which ancestor's policy applies)
- Custom WebID list for `custom` mode
- "Allow children to inherit" checkbox for containers
- Friends list management (add/remove WebIDs)
- Raw ACP Turtle view (read-only, for debugging)
