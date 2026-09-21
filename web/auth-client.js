// Convex Auth owns codes, sessions, token rotation and verification. This small
// adapter connects its public actions to the official framework-free SDK.
const { ConvexClient, ConvexHttpClient } = window.convex;
const config = window.HANDOFF_CONFIG;
if (!config?.convexUrl)
  throw new Error("Handoff connection is not configured.");
const createClient = () => new ConvexClient(config.convexUrl, { verbose: false, logger: false });
export let client = createClient();
function resetClient() {
  // Never reuse a query cache across account boundaries.
  const previous = client;
  client = createClient();
  void previous.close();
  connectAuth();
}
const authHttp = new ConvexHttpClient(config.convexUrl, { logger: false });
export const sampleSession = location.pathname.startsWith("/demo") || new URLSearchParams(location.search).get("sample") === "1";
const storage = sampleSession ? sessionStorage : localStorage;
const key = `handoff.auth.${new URL(config.convexUrl).hostname}${sampleSession ? ".sample" : ""}`;
let memory = null;
let refreshing = null;
export function readTokens() {
  try {
    return JSON.parse(storage.getItem(key)) ?? memory;
  } catch {
    return memory;
  }
}
function writeTokens(tokens) {
  memory = tokens;
  try {
    if (tokens) storage.setItem(key, JSON.stringify(tokens));
    else storage.removeItem(key);
  } catch {
    /* In-memory sign-in still works when storage is unavailable. */
  }
}
export function hasSession() {
  return !!readTokens()?.token;
}
export async function fetchToken({ forceRefreshToken = false } = {}) {
  const current = readTokens();
  if (!current?.token) return null;
  if (!forceRefreshToken) return current.token;
  if (refreshing) return refreshing;
  const before = current.token;
  const refresh = async () => {
    const latest = readTokens();
    if (!latest) return null;
    if (latest.token !== before) return latest.token;
    const result = await authHttp.action("auth:signIn", {
      refreshToken: latest.refreshToken,
    });
    // Ignore stale refresh results after sign-out or another sign-in.
    const after = readTokens();
    if (!after) return null;
    if (after.token !== latest.token) return after.token;
    if (!result.tokens) {
      writeTokens(null);
      resetClient();
      window.dispatchEvent(new Event("handoff:session-ended"));
      return null;
    }
    // A sign-out in another tab must not be undone by an in-flight refresh.
    writeTokens(result.tokens);
    return result.tokens.token;
  };
  refreshing = (
    navigator.locks ? navigator.locks.request(key, refresh) : refresh()
  ).finally(() => {
    refreshing = null;
  });
  return refreshing;
}
export function connectAuth() {
  client.setAuth(fetchToken);
}
export async function signIn(email, code) {
  const result = await authHttp.action("auth:signIn", {
    provider: "agentmail-otp",
    params: { email, ...(code ? { code } : {}) },
  });
  if (result.tokens) {
    writeTokens(result.tokens);
    resetClient();
  }
  return !!result.tokens;
}
export async function signInSample(token) {
  if (!sampleSession) throw Error("Open a separate sample tab first.");
  const result = await authHttp.action("auth:signIn", token
    ? { provider: "demo-role", params: { token } }
    : { provider: "anonymous", params: {} });
  if (!result.tokens) throw Error("Sample sign-in unavailable.");
  writeTokens(result.tokens); resetClient();
}
export async function signOut() {
  const tokens = readTokens();
  let remoteRevoked = !tokens?.token;
  try {
    if (tokens?.token) {
      authHttp.setAuth(tokens.token);
      await authHttp.action("auth:signOut", {});
      remoteRevoked = true;
    }
  } finally {
    // Local privacy must not depend on a successful network request.
    authHttp.clearAuth();
    writeTokens(null);
    resetClient();
    window.dispatchEvent(new CustomEvent("handoff:session-ended", {
      detail: { remoteRevoked },
    }));
  }
}
window.addEventListener("storage", (event) => {
  if (sampleSession || event.key !== key) return;
  memory = null;
  if (!hasSession()) {
    resetClient();
    window.dispatchEvent(new Event("handoff:session-ended"));
  } else {
    resetClient();
    window.dispatchEvent(new Event("handoff:session-changed"));
  }
});
connectAuth();
