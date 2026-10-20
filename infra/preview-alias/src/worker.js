const REGISTRY_HOST = "handoff-previews.satimon.com";
const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = "https://handoff-previews.satimon.com";
const OIDC_JWKS_URL = `${OIDC_ISSUER}/.well-known/jwks`;
const OIDC_JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedJwks;
let cachedJwksAt = 0;

export class OidcVerificationError extends Error {
  constructor(status, reason) {
    super(reason);
    this.name = "OidcVerificationError";
    this.status = status;
    this.reason = reason;
  }
}

export function isValidPreviewUrl(value) {
  return typeof value === "string" && /^https:\/\/[a-z0-9-]+\.convex\.site$/.test(value);
}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function verificationError(status, reason) {
  return new OidcVerificationError(status, reason);
}

export async function verifyGithubOidc(token, { jwks, now, expectedPr } = {}) {
  if (typeof token !== "string" || !Number.isFinite(now) || !Number.isSafeInteger(expectedPr) || expectedPr <= 0) {
    throw verificationError(401, "invalid_token");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw verificationError(401, "invalid_token");
  }

  let header;
  let claims;
  let signature;
  try {
    header = decodeJsonSegment(parts[0]);
    claims = decodeJsonSegment(parts[1]);
    signature = decodeBase64Url(parts[2]);
  } catch {
    throw verificationError(401, "invalid_token");
  }

  if (
    header === null ||
    typeof header !== "object" ||
    Array.isArray(header) ||
    claims === null ||
    typeof claims !== "object" ||
    Array.isArray(claims)
  ) {
    throw verificationError(401, "invalid_token");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
    throw verificationError(401, "invalid_token");
  }

  const jwk = Array.isArray(jwks?.keys) ? jwks.keys.find((key) => key.kid === header.kid) : undefined;
  if (!jwk) {
    throw verificationError(401, "unknown_kid");
  }
  if (jwk.kty !== "RSA" || (jwk.use && jwk.use !== "sig") || (jwk.alg && jwk.alg !== "RS256")) {
    throw verificationError(401, "invalid_key");
  }

  let isValidSignature = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    isValidSignature = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    throw verificationError(401, "invalid_key");
  }
  if (!isValidSignature) {
    throw verificationError(401, "invalid_signature");
  }

  if (claims.iss !== OIDC_ISSUER || !(claims.aud === OIDC_AUDIENCE || (Array.isArray(claims.aud) && claims.aud.includes(OIDC_AUDIENCE)))) {
    throw verificationError(401, "invalid_claims");
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= now - 60) {
    throw verificationError(401, "invalid_claims");
  }
  for (const timeClaim of ["nbf", "iat"]) {
    if (claims[timeClaim] !== undefined && (!Number.isFinite(claims[timeClaim]) || claims[timeClaim] > now + 60)) {
      throw verificationError(401, "invalid_claims");
    }
  }

  if (
    claims.repository !== "Satianurag/handoff" ||
    claims.event_name !== "pull_request" ||
    claims.ref !== `refs/pull/${expectedPr}/merge`
  ) {
    throw verificationError(403, "claims_mismatch");
  }

  return claims;
}

async function fetchGithubJwks(forceRefresh = false) {
  if (!forceRefresh && cachedJwks && Date.now() - cachedJwksAt < OIDC_JWKS_CACHE_TTL_MS) {
    return cachedJwks;
  }

  const response = await fetch(OIDC_JWKS_URL);
  if (!response.ok) {
    throw new Error(`GitHub OIDC JWKS request failed with HTTP ${response.status}`);
  }

  const jwks = await response.json();
  if (!Array.isArray(jwks?.keys)) {
    throw new Error("GitHub OIDC JWKS response is invalid");
  }
  cachedJwks = jwks;
  cachedJwksAt = Date.now();
  return jwks;
}

async function verifyRegistrationToken(token, expectedPr) {
  const now = Math.floor(Date.now() / 1000);
  let jwks;
  try {
    jwks = await fetchGithubJwks();
  } catch {
    throw verificationError(502, "jwks_unavailable");
  }

  try {
    return await verifyGithubOidc(token, { jwks, now, expectedPr });
  } catch (error) {
    if (!(error instanceof OidcVerificationError) || error.reason !== "unknown_kid") {
      throw error;
    }
  }

  try {
    jwks = await fetchGithubJwks(true);
  } catch {
    throw verificationError(502, "jwks_unavailable");
  }
  return verifyGithubOidc(token, { jwks, now, expectedPr });
}

function textResponse(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

function notFound() {
  return textResponse("Not found.", 404);
}

function registryStub(env) {
  const id = env.REGISTRY.idFromName("registry");
  return env.REGISTRY.get(id);
}

export default {
  async fetch(request, env) {
    const { hostname } = new URL(request.url);
    if (hostname === REGISTRY_HOST || /^handoff-pr-[1-9]\d*\.satimon\.com$/.test(hostname)) {
      return registryStub(env).fetch(request);
    }
    return notFound();
  },
};

export class PreviewRegistry {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === REGISTRY_HOST) {
      if (request.method === "POST" && url.pathname === "/register") {
        return this.register(request);
      }

      const match = url.pathname.match(/^\/pr\/([1-9]\d*)$/);
      if (request.method === "GET" && match) {
        return this.getRegistration(Number(match[1]));
      }

      return notFound();
    }

    const aliasMatch = url.hostname.match(/^handoff-pr-([1-9]\d*)\.satimon\.com$/);
    if (!aliasMatch) {
      return notFound();
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method not allowed.", 405, { Allow: "GET, HEAD" });
    }

    const pr = Number(aliasMatch[1]);
    const registration = await this.state.storage.get(`pr:${pr}`);
    if (!registration) {
      return textResponse(
        request.method === "HEAD" ? "" : `No preview is registered for PR ${pr} yet.`,
        404,
        { "Cache-Control": "no-store" },
      );
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${registration.url}${url.pathname}${url.search}`,
        "Cache-Control": "no-store",
      },
    });
  }

  async getRegistration(pr) {
    const registration = await this.state.storage.get(`pr:${pr}`);
    if (!registration) {
      return notFound();
    }
    return new Response(JSON.stringify({ pr, ...registration }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  async register(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return textResponse("Invalid registration body.", 400);
    }
    if (
      body === null ||
      typeof body !== "object" ||
      !Number.isSafeInteger(body.pr) ||
      body.pr <= 0 ||
      !isValidPreviewUrl(body.url) ||
      typeof body.sha !== "string" ||
      !/^[a-f0-9]{40}$/.test(body.sha)
    ) {
      return textResponse("Invalid registration body.", 400);
    }

    const authorization = request.headers.get("Authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      return textResponse("Unauthorized.", 401);
    }

    try {
      await verifyRegistrationToken(match[1], body.pr);
    } catch (error) {
      const status = error instanceof OidcVerificationError ? error.status : 401;
      return textResponse(status === 403 ? "Forbidden." : status === 502 ? "OIDC verification unavailable." : "Unauthorized.", status);
    }

    const registration = {
      url: body.url,
      sha: body.sha,
      updatedAt: new Date().toISOString(),
    };
    await this.state.storage.put(`pr:${body.pr}`, registration);
    return new Response(null, { status: 204 });
  }
}
