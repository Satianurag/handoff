import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  exportJWK, exportPKCS8, generateKeyPair, importPKCS8, importJWK,
  SignJWT, jwtVerify,
} from "jose";

const root = fileURLToPath(new URL("../", import.meta.url));
function convex(args, input) {
  const result = spawnSync("npx", ["convex", "env", ...args], {
    cwd: root, input, encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    // CLI output can contain secret values. Never forward it or embed it in errors.
    throw new Error(`Convex environment command failed (${args[0]}). Output withheld.`);
  }
  return result.stdout.trim();
}

for (const deployment of ["dev", "prod"]) {
  const select = ["--deployment", deployment];
  const names = new Set(convex(["list", "--names-only", ...select]).split(/\s+/));
  const privatePresent = names.has("JWT_PRIVATE_KEY");
  const publicPresent = names.has("JWKS");
  if (privatePresent !== publicPresent) {
    throw new Error(`${deployment}: incomplete signing key pair; refusing automatic replacement.`);
  }
  if (!privatePresent) {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const pem = await exportPKCS8(pair.privateKey);
    const jwks = JSON.stringify({ keys: [{ use: "sig", ...await exportJWK(pair.publicKey) }] });
    convex(["set", "JWT_PRIVATE_KEY", ...select], pem);
    convex(["set", "JWKS", ...select], jwks);
  }
  const privateKey = await importPKCS8(convex(["get", "JWT_PRIVATE_KEY", ...select]), "RS256");
  const keySet = JSON.parse(convex(["get", "JWKS", ...select]));
  const publicKey = await importJWK(keySet.keys[0], "RS256");
  const token = await new SignJWT({ purpose: "environment-verification" })
    .setProtectedHeader({ alg: "RS256" }).setExpirationTime("1m").sign(privateKey);
  await jwtVerify(token, publicKey, { algorithms: ["RS256"] });
  console.log(`${deployment}: signing key pair stored and cryptographically verified.`);
}
