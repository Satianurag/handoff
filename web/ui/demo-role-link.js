export const sampleRoleLinkUnavailableMessage =
  "This sample role link expired or was already used. Open a new role link from Sample controls in the sample household.";

export async function signInWithSampleRole(auth, token) {
  try {
    return await auth.signInSample(token);
  } catch {
    throw { data: { message: sampleRoleLinkUnavailableMessage } };
  }
}

export function sampleRoleLinkFailureMessage(path, error) {
  return path === "/demo/join" &&
    error?.data?.message === sampleRoleLinkUnavailableMessage
    ? sampleRoleLinkUnavailableMessage
    : null;
}

export function sampleRoleLinkRecoveryAction(path) {
  return path === "/demo/join"
    ? '<a class="primary full" href="/demo" data-route>Open a new sample</a>'
    : '<button class="primary full" id="retry-page">Try again</button>';
}
