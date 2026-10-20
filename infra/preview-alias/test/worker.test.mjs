import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { isValidPreviewUrl, verifyGithubOidc, verifyRegistrationToken } from "../src/worker.js";

const now = Math.floor(Date.now() / 1000);
const keyPair = await webcrypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const publicJwk = {
  ...(await webcrypto.subtle.exportKey("jwk", keyPair.publicKey)),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const jwks = { keys: [publicJwk] };

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function makeToken({ header = {}, claims = {}, signingKey = keyPair.privateKey } = {}) {
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", kid: "test-key", ...header }));
  const encodedClaims = base64Url(
    JSON.stringify({
      iss: "https://token.actions.githubusercontent.com",
      aud: "https://handoff-previews.satimon.com",
      repository: "Satianurag/handoff",
      repository_id: "1379115807",
      repository_owner_id: "85240125",
      event_name: "pull_request",
      ref: "refs/pull/42/merge",
      workflow_ref: "Satianurag/handoff/.github/workflows/preview.yml@refs/pull/42/merge",
      exp: now + 300,
      nbf: now - 1,
      iat: now - 1,
      ...claims,
    }),
  );
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  if (header.alg === "none") {
    return `${signingInput}.`;
  }
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

async function assertTokenStatus(token, status, options = {}) {
  await assert.rejects(
    verifyGithubOidc(token, { jwks, now, expectedPr: 42, ...options }),
    (error) => error.status === status,
  );
}

test("verifies a correctly signed GitHub Actions OIDC token", async () => {
  const claims = await verifyGithubOidc(await makeToken(), { jwks, now, expectedPr: 42 });
  assert.equal(claims.repository, "Satianurag/handoff");
  assert.equal(claims.repository_id, "1379115807");
  assert.equal(claims.repository_owner_id, "85240125");
});

test("rejects a token with the wrong audience", async () => {
  await assertTokenStatus(await makeToken({ claims: { aud: "https://example.com" } }), 401);
});

test("rejects a token for a different repository", async () => {
  await assertTokenStatus(await makeToken({ claims: { repository: "attacker/handoff" } }), 403);
});

test("rejects a token with the wrong repository ID", async () => {
  await assertTokenStatus(await makeToken({ claims: { repository_id: "1" } }), 403);
});

test("rejects a token with the wrong repository owner ID", async () => {
  await assertTokenStatus(await makeToken({ claims: { repository_owner_id: "1" } }), 403);
});

test("rejects a token whose ref names another pull request", async () => {
  await assertTokenStatus(await makeToken({ claims: { ref: "refs/pull/43/merge" } }), 403);
});

test("rejects a token whose workflow_ref names another workflow", async () => {
  await assertTokenStatus(
    await makeToken({
      claims: {
        workflow_ref: "Satianurag/handoff/.github/workflows/ci.yml@refs/pull/42/merge",
      },
    }),
    403,
  );
});

test("rejects a token from a push event", async () => {
  await assertTokenStatus(await makeToken({ claims: { event_name: "push" } }), 403);
});

test("rejects an expired token", async () => {
  await assertTokenStatus(await makeToken({ claims: { exp: now - 61 } }), 401);
});

test("rejects a token with a tampered signature", async () => {
  const token = await makeToken();
  const parts = token.split(".");
  const signature = Buffer.from(parts[2], "base64url");
  signature[0] ^= 1;
  await assertTokenStatus(`${parts[0]}.${parts[1]}.${signature.toString("base64url")}`, 401);
});

test("rejects an unknown key id", async () => {
  await assertTokenStatus(await makeToken({ header: { kid: "unknown-key" } }), 401);
});

test("throttles forced JWKS refreshes for unknown key IDs", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify(jwks), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const token = await makeToken({ header: { kid: "unknown-key" } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        verifyRegistrationToken(token, 42),
        (error) => error.status === 401 && error.reason === "unknown_kid",
      );
    }
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects alg none", async () => {
  await assertTokenStatus(await makeToken({ header: { alg: "none" } }), 401);
});

test("accepts only exact HTTPS Convex site URLs", () => {
  assert.equal(isValidPreviewUrl("https://cool-elk-581.convex.site"), true);
  assert.equal(isValidPreviewUrl("https://evil.com"), false);
  assert.equal(isValidPreviewUrl("http://x.convex.site"), false);
  assert.equal(isValidPreviewUrl("https://a.convex.site.evil.com"), false);
});
