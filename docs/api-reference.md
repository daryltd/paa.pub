# API Reference

All routes are registered in `src/index.js` and matched in registration order (first match wins).

## OIDC endpoints

These implement the Solid-OIDC specification for authenticating with Solid apps. See [Authentication](authentication.md) for details.

| Method | Path | Handler | Auth | Description |
|---|---|---|---|---|
| GET | `/.well-known/openid-configuration` | `handleDiscovery` | No | OIDC discovery document |
| GET | `/jwks` | `handleJwks` | No | Public key for token verification |
| POST | `/register` | `handleRegister` | No | Dynamic client registration |
| GET/POST | `/authorize` | `handleAuthorize` | No | Authorization consent page |
| POST | `/token` | `handleToken` | No | Exchange code for tokens |
| GET | `/userinfo` | `handleUserInfo` | Bearer | Authenticated user info |

## Public routes

| Method | Path | Handler | Auth | Description |
|---|---|---|---|---|
| GET | `/.well-known/webfinger` | `handleWebFinger` | No | WebFinger discovery |
| GET | `/login` | `renderLoginPage` | No | Login form |
| POST | `/login` | `handleLogin` | No | Process login (sets session cookie) |
| POST | `/logout` | `handleLogout` | No | Destroy session |

## WebAuthn (passkeys)

| Method | Path | Handler | Auth | Description |
|---|---|---|---|---|
| POST | `/webauthn/register/begin` | `handleWebAuthnRegisterBegin` | Session | Start passkey registration |
| POST | `/webauthn/register/complete` | `handleWebAuthnRegisterComplete` | Session | Complete passkey registration |
| POST | `/webauthn/login/begin` | `handleWebAuthnLoginBegin` | No | Start passkey login |
| POST | `/webauthn/login/complete` | `handleWebAuthnLoginComplete` | No | Complete passkey login |
| POST | `/webauthn/rename` | `handleWebAuthnRename` | Session | Rename a passkey |
| POST | `/webauthn/delete` | `handleWebAuthnDelete` | Session | Delete a passkey |

## Authenticated UI pages

All these routes require an active session (redirect to `/login` if not authenticated).

| Method | Path | Handler | Description |
|---|---|---|---|
| GET | `/dashboard` | `renderDashboard` | Overview: stats, passkeys, storage breakdown |
| GET | `/profile` | `renderProfileEditor` | Edit WebID profile triples |
| POST | `/profile` | `handleProfileUpdate` | Save profile changes |
| POST | `/profile/reset-index` | `handleProfileIndexReset` | Reset root container index.html to default |
| GET | `/activity` | `renderActivityPage` | Activity feed (inbox + outbox) |
| POST | `/compose` | `handleCompose` | Create a new post |
| POST | `/follow` | `handleFollow` | Follow an actor |
| POST | `/unfollow` | `handleUnfollow` | Unfollow an actor |
| GET | `/storage/**` | `renderStoragePage` | Browse pod contents |
| POST | `/storage/**` | `handleStorageAction` | Upload, create, edit, delete resources |
| GET | `/acp/**` | `renderAclEditor` | Access policy editor |
| POST | `/acp/**` | `handleAclUpdate` | Save access policy |

## ActivityPub routes

Content-negotiated endpoints that serve both Solid RDF and ActivityPub JSON-LD.

| Method | Path | Handler | Auth | Description |
|---|---|---|---|---|
| GET | `/profile/card` | `handleActor` | No | WebID profile / AP actor (convenience shortcut) |
| GET | `/:user/profile/card` | `handleActor` | No | WebID profile / AP actor |
| POST | `/:user/inbox` | `handleInbox` | HTTP Sig | Receive activities from remote servers |
| GET | `/:user/outbox` | `handleOutbox` | No | Outbox OrderedCollection |
| GET | `/:user/followers` | `handleCollections` | No | Followers OrderedCollection |
| GET | `/:user/following` | `handleCollections` | No | Following OrderedCollection |

## LDP catch-all (Solid protocol)

These match any URL under `/:user/` not caught by a more specific route.

| Method | Path | Handler | Auth | Description |
|---|---|---|---|---|
| GET/HEAD | `/:user/**` | `handleLDP` | ACP | Read a resource |
| PUT | `/:user/**` | `handleLDP` | Bearer | Create or replace a resource |
| POST | `/:user/**` | `handleLDP` | Bearer | Create a new resource in a container |
| PATCH | `/:user/**` | `handleLDP` | Bearer | SPARQL Update on a resource |
| DELETE | `/:user/**` | `handleLDP` | Owner | Delete a resource |
| OPTIONS | `/:user/**` | `handleLDP` | No | CORS preflight / capabilities |

## Special URL handling

| URL suffix | Behavior |
|---|---|
| `.acl` | WAC ACL resource (GET/PUT/PATCH/DELETE) |
| `.acr` | Redirects to ACP editor UI |
| Container + `Accept: text/html` | Serves `index.html` blob if present |

## WebFinger

```
GET /.well-known/webfinger?resource=acct:{username}@{domain}
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

## Content negotiation

The `/:user/profile/card` endpoint serves different representations:

| Accept header | Response |
|---|---|
| `application/activity+json` | ActivityPub Actor JSON-LD |
| `application/ld+json` (with activitystreams profile) | ActivityPub Actor JSON-LD |
| `text/turtle` (default) | Solid WebID profile in Turtle |
| `application/n-triples` | WebID profile in N-Triples |
| `text/html` | Redirects to index.html or RDF listing |

## Storage actions (POST /storage/**)

The `action` form field determines the operation:

| Action | Fields | Description |
|---|---|---|
| `upload` | `file`, `slug` (optional) | Upload a binary file |
| `mkdir` | `name` | Create a sub-container |
| `create` | `name`, `content` | Create a text/RDF resource |
| `save` | `content` | Update resource content |
| `save_meta` | `metadata` | Update resource metadata (N-Triples) |
| `delete` | — | Delete the resource or container |

## ACP actions (POST /acp/**)

The `action` form field determines the operation:

| Action | Fields | Description |
|---|---|---|
| `save_policy` | `mode`, `agents`, `inherit` | Save access policy |
| `add_friend` | `webid` | Add a WebID to the friends list |
| `remove_friend` | `webid` | Remove a WebID from the friends list |
