import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sampleRoleLinkFailureMessage,
  sampleRoleLinkRecoveryAction,
  sampleRoleLinkUnavailableMessage,
  signInWithSampleRole,
} from "../web/ui/demo-role-link.js";

test("one-use role sign-in failures normalize to the expired-link guidance", async () => {
  const auth = {
    async signInSample(token) {
      assert.equal(token, "used-token");
      throw new Error("DEMO_UNAVAILABLE");
    },
  };

  await assert.rejects(signInWithSampleRole(auth, "used-token"), {
    data: { message: sampleRoleLinkUnavailableMessage },
  });
  assert.equal(
    sampleRoleLinkFailureMessage("/demo/join", {
      data: { message: sampleRoleLinkUnavailableMessage },
    }),
    sampleRoleLinkUnavailableMessage,
  );
});

test("role link failures offer a new sample instead of retrying", () => {
  assert.equal(
    sampleRoleLinkUnavailableMessage,
    "This sample role link expired or was already used. Open a new role link from Sample controls in the sample household.",
  );
  assert.equal(
    sampleRoleLinkRecoveryAction("/demo/join"),
    '<a class="primary full" href="/demo" data-route>Open a new sample</a>',
  );
  assert.equal(
    sampleRoleLinkRecoveryAction("/demo"),
    '<button class="primary full" id="retry-page">Try again</button>',
  );
  assert.equal(
    sampleRoleLinkFailureMessage("/demo", {
      data: { message: sampleRoleLinkUnavailableMessage },
    }),
    null,
  );
});
