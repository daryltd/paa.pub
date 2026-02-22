# Authentication

The server supports three authentication methods: password login, passkeys (WebAuthn), and Solid-OIDC bearer tokens.

## Password login

The simplest authentication flow. Used for the web UI.

1. User visits `/login` and enters their password
2. Server validates against the stored PBKDF2 hash (`user:{username}` in APPDATA)
3. On success, creates a session (`session:{token}` with 24-hour TTL) and sets a cookie
4. Cookie: `session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`

Password hashing uses PBKDF2 with SHA-256, 100,000 iterations, and a random 16-byte salt. The hash and salt are stored together in the user record.

## Passkeys (WebAuthn)

Passwordless login using platform authenticators (Touch ID, Windows Hello, security keys). Requires an active session to register; can be used without a password to log in.

### Registration flow

The user must be logged in to register a passkey.

**Step 1: `POST /webauthn/register/begin`**

Server generates a random 32-byte challenge and stores it in KV with a 60-second TTL. Returns the challenge and credential creation options:

```json
{
  "challenge": "base64url...",
  "rp": { "name": "paa.pub", "id": "example.com" },
  "user": { "id": "base64url...", "name": "alice", "displayName": "alice" },
  "pubKeyCredParams": [
    { "type": "public-key", "alg": -7 },
    { "type": "public-key", "alg": -257 }
  ],
  "authenticatorSelection": {
    "authenticatorAttachment": "platform",
    "residentKey": "preferred",
    "userVerification": "preferred"
  },
  "timeout": 60000,
  "attestation": "none"
}
```

Algorithm `-7` is ECDSA with P-256 (ES256), `-257` is RSASSA-PKCS1-v1_5 with SHA-256 (RS256).

**Step 2: Browser creates credential**

The browser calls `navigator.credentials.create()` which prompts the user for biometric/PIN verification and generates a keypair.

**Step 3: `POST /webauthn/register/complete`**

Server receives the attestation response and:

1. Decodes `clientDataJSON` — verifies the challenge matches, origin is correct, type is `webauthn.create`
2. Decodes `attestationObject` (CBOR) — extracts the authenticator data
3. Parses authenticator data — extracts the credential ID and COSE public key
4. Converts the COSE key to JWK format (supports EC2 and RSA key types)
5. Stores the credential: `webauthn_cred:{username}:{credId}` with the JWK public key
6. Appends the credential ID to the user's credential list: `webauthn_creds:{username}`

### Login flow

No prior authentication needed.

**Step 1: `POST /webauthn/login/begin`**

Server generates a challenge and returns it with the list of allowed credential IDs.

**Step 2: Browser authenticates**

The browser calls `navigator.credentials.get()` which prompts for biometric/PIN and signs a challenge.

**Step 3: `POST /webauthn/login/complete`**

Server receives the assertion response and:

1. Decodes `clientDataJSON` — verifies challenge, origin, and type (`webauthn.get`)
2. Loads the stored credential from KV using the credential ID
3. Parses `authenticatorData` — verifies the `rpIdHash` matches
4. Constructs the signed data: `authenticatorData || SHA-256(clientDataJSON)`
5. Imports the stored JWK public key
6. Verifies the signature (ECDSA for EC keys with DER-to-raw conversion, or RSASSA-PKCS1-v1_5 for RSA keys)
7. Updates the credential's sign counter (replay protection)
8. Creates a session and sets the session cookie

## Solid-OIDC

Implements the [Solid-OIDC specification](https://solidproject.org/TR/oidc) to allow Solid apps to authenticate users. Uses the Authorization Code flow with PKCE.

### Discovery

```
GET /.well-known/openid-configuration
```

Returns the OpenID Connect discovery document with all endpoint URLs, supported grant types, signing algorithms, and the `solid_oidc_supported` marker.

### Authorization flow

**1. Client redirects to `/authorize`**

Query parameters:
- `client_id` — the app's identifier (URL or registered ID)
- `redirect_uri` — where to send the user after approval
- `scope` — `openid webid` (optionally `offline_access` for refresh tokens)
- `state` — CSRF protection token
- `code_challenge` — PKCE S256 challenge (base64url of SHA-256 of code_verifier)
- `code_challenge_method` — `S256`
- `response_type` — `code`
- `nonce` — optional, included in id_token if provided

**2. User approves**

If the user is already logged in and has previously remembered this client, approval is automatic. Otherwise, a consent page is shown with the client name (fetched from the client_id URL) and a password field.

**3. Server issues authorization code**

Redirects back to `redirect_uri` with:
- `code` — random UUID authorization code (stored in KV with 2-minute TTL)
- `state` — echoed back
- `iss` — the server's base URL (authorization response issuer parameter)

**4. Client exchanges code for tokens**

```
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={authorization_code}
&code_verifier={PKCE verifier}
&redirect_uri={redirect_uri}
&client_id={client_id}
```

The server verifies:
- The code exists and hasn't expired
- The `code_verifier` matches the stored `code_challenge` (PKCE S256 verification)
- The `redirect_uri` and `client_id` match the stored values

Returns:
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "eyJ...",
  "scope": "openid webid"
}
```

If the scope includes `offline_access`, a `refresh_token` is also returned.

### Token format

Both `access_token` and `id_token` are JWTs signed with RS256 using the server's RSA private key.

**Access token payload:**
```json
{
  "iss": "https://example.com",
  "sub": "https://example.com/alice/profile/card#me",
  "aud": "solid",
  "exp": 1705315800,
  "iat": 1705312200,
  "client_id": "https://app.example.com",
  "webid": "https://example.com/alice/profile/card#me",
  "scope": "openid webid"
}
```

**ID token payload:**
```json
{
  "iss": "https://example.com",
  "sub": "https://example.com/alice/profile/card#me",
  "aud": "https://app.example.com",
  "exp": 1705315800,
  "iat": 1705312200,
  "webid": "https://example.com/alice/profile/card#me",
  "azp": "https://app.example.com"
}
```

### DPoP (Demonstration of Proof-of-Possession)

If the client sends a `DPoP` header with the token request, the access token is bound to the client's key via a `cnf.jkt` claim. Subsequent requests must include a DPoP proof header, and the server verifies the key binding.

When DPoP is used, the `token_type` is `DPoP` instead of `Bearer`.

### Token verification

On every incoming request, `verifyAccessToken()` checks the `Authorization` header:

1. Extract the token from `Bearer {token}` or `DPoP {token}`
2. Decode the JWT payload (base64url)
3. Verify the token hasn't expired
4. Verify the issuer matches the server's base URL
5. If DPoP: verify the DPoP proof header signature and key binding
6. Return the `webid` claim value (or null if verification fails)

The JWT signature is trusted without cryptographic verification because the server is both the issuer and the verifier. The token's integrity is guaranteed by the KV storage (the authorization code that produced it was validated at issuance time).

### Refresh tokens

```
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={refresh_token}
&client_id={client_id}
```

Refresh tokens have a 30-day TTL. Using a refresh token issues new access and ID tokens and rotates the refresh token (old one is deleted, new one returned).

### UserInfo endpoint

```
GET /userinfo
Authorization: Bearer {access_token}
```

Returns:
```json
{
  "sub": "https://example.com/alice/profile/card#me",
  "webid": "https://example.com/alice/profile/card#me",
  "name": "alice"
}
```
