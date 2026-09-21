import { mountSharedPack } from './views/shared-pack.js';
import { mountSharedRecord } from './views/shared-record.js';
import { mountAccount } from './views/account.js';
import { mayLeave, hasUnsavedChanges } from './ui/core.js';
import { mountPrivacy } from "./views/privacy.js";
import { mountWorkspace } from "./workspace-app.js";
import { isAppRoute } from "./routes.js";
import { householdDayEnd, watchDeadline } from "./time.js";
const $ = (s, root = document) => root.querySelector(s);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const storage = {
  get(key, fallback = null) {
    try {
      return JSON.parse(sessionStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  },
};
const lockIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></svg>';
const mailIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
const peopleIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/></svg>';
const switchIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/></svg>';
const homeIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/></svg>';
let auth,
  viewer,
  subscriptions = [],
  interval,
  routeVersion = 0,
  households = [],
  board = null;
let workspaceDispose, sessionMessage = "", routeLoading = false, offlineRoute = false;
let historyIndex=Number.isInteger(history.state?.handoffIndex)?history.state.handoffIndex:0;
history.replaceState({...history.state,handoffIndex:historyIndex},'',location.href);
let restoringHistory=false, pendingBack=null;
// Intercept user navigation before view-specific handlers can discard a form.
document.addEventListener('click',async event=>{
 const anchor=event.target.closest('a[href]');
 if(!anchor||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||anchor.hasAttribute('download')||anchor.target==='_blank')return;
 const target=new URL(anchor.href,location.href);
 if(!hasUnsavedChanges()&&!document.querySelector('form[aria-busy="true"]'))return;
 event.preventDefault();event.stopImmediatePropagation();
 if(!await mayLeave())return;
 document.querySelectorAll('form[data-dirty]').forEach(form=>form.dataset.dirty='');
 if(target.origin===location.origin&&isAppRoute(target.pathname))go(target.pathname+target.search+target.hash);
 else location.assign(target.href);
},true);
window.addEventListener('beforeunload',event=>{if(hasUnsavedChanges()||document.querySelector('form[aria-busy="true"]')){event.preventDefault();event.returnValue='';}});
let pending = storage.get("handoff.code");
if (pending && Date.now() - pending.sentAt > 15 * 60 * 1000) {
  pending = null;
  storage.remove("handoff.code");
}
const blankDraft = () => ({
  displayName: viewer?.displayName || "",
  nickname: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  timezoneConfirmed: false,
  adultConfirmed: false,
  authority: false,
  firstTask: "",
  firstAction: "record",
  emailImport: false,
  aiProcessing: false,
  step: 1,
  requestId: crypto.randomUUID(),
});
let draft;
function announce(text) {
  $("#announcement").textContent = text;
}
function clearSubscriptions() {
  workspaceDispose?.(); workspaceDispose = null;
  for (const unsubscribe of subscriptions) unsubscribe();
  subscriptions = [];
  clearInterval(interval);
  board = null;
}
function go(path, replace = false) {
  if (auth?.sampleSession && (/^\/h\//.test(path) || path.startsWith("/privacy-requests") || path.startsWith("/households") || path.startsWith("/account"))) {
    const url = new URL(path, location.origin); url.searchParams.set("sample", "1"); path = url.pathname + url.search;
  }
  (replace ? history.replaceState : history.pushState).call(
    history,
    {handoffIndex: replace ? historyIndex : ++historyIndex},
    "",
    path,
  );
  route();
}
function safeNext() {
  const path = new URLSearchParams(location.search).get("next");
  return path && path.startsWith("/") && isAppRoute(path.split("?")[0]) && !path.startsWith("/sign-in") ? path : null;
}
function footer() {
  return '<footer class="auth-footer"><span>A little less to carry.</span><a href="/privacy" data-route>Privacy</a><a href="/consumer-health-privacy" data-route>Care data</a><a href="/help" data-route>Help</a></footer>';
}
function shell(content, wide = false) {
  $("#app").innerHTML =
    `${navigator.onLine ? "" : '<div class="offline" role="status">You’re offline. Reconnect to save or sign in.</div>'}<div class="sky-shell"><img class="cloud one" src="/assets/cloud.svg" alt=""><img class="cloud two" src="/assets/cloud.svg" alt=""><header class="auth-header"><a href="/" class="wordmark">Handoff</a>${viewer ? '<button class="quiet-link" data-signout>Sign out</button>' : '<a href="/" class="quiet-link">← Back to Handoff</a>'}</header><main id="main" class="auth-main"><section class="auth-card ${wide ? "wide" : ""}">${content}</section></main>${footer()}</div>`;
  bindCommon();
  const heading = $("h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  document
    .querySelectorAll("input,select")
    .forEach((el) =>
      el.addEventListener("input", () => el.removeAttribute("aria-invalid")),
    );
}

function bindCommon() {
  document.querySelectorAll("[data-route]").forEach((a) =>
    a.addEventListener("click", (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        go(a.getAttribute("href"));
      }
    }),
  );
  $("[data-signout]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await auth.signOut();
    } catch {
      button.disabled = false;
      showError("You’re signed out on this browser. We couldn’t confirm server sign-out; reconnect before using a shared device.");
    }
  });
}
function showError(message, target = "#form-status") {
  let el = $("dialog[open] .status") || $(target);
  if (!el) {
    el = document.createElement("div");
    el.id = "form-status";
    el.className = "status";
    $("#main").prepend(el);
  }
  el.setAttribute("role", "alert");
  el.className = "status";
  el.textContent = message;
}
function readable(
  error,
  fallback = "Something didn’t save. Please try again.",
) {
  const code = error?.data?.code;
  const known = {
    UNAUTHENTICATED: "Your session ended. Sign in again to continue.",
    INVALID_EMAIL: "Enter a valid email address.",
    EMAIL_UNAVAILABLE:
      "The code couldn’t be sent. Please wait a moment and try again.",
    WRONG_ACCOUNT:
      "This invitation belongs to a different email. Sign out and use the address it was sent to.",
    INVALID_INVITE:
      "This invitation has expired or is no longer available. Ask the household owner for a new link.",
    NOT_FOUND: "This household is no longer available to your account.",
    CONFLICT:
      "This responsibility changed. Review the latest details and try again.",
    RATE_LIMITED: "Too many attempts. Please wait before trying again.",
    VERIFIED_ACCOUNT_REQUIRED: "Verify your email before creating a household.",
  };
  if (known[code]) return known[code];
  if (/rate|too many/i.test(error?.message || ""))
    return "Too many attempts. Please wait a minute before trying again.";
  return navigator.onLine
    ? fallback
    : "You’re offline. Your entries are still here. Reconnect and try again.";
}
async function submit(form, label, operation) {
  if (form.dataset.busy) return;
  const button = form.querySelector("[type=submit]"),
    previous = button.innerHTML;
  const buttons = [...(form.closest('.auth-card') || form).querySelectorAll('button')].map(el => [el, el.disabled]);
  const focused = document.activeElement;
  form.dataset.busy = "true";
  for (const [el] of buttons) el.disabled = true;
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label}`;
  form.setAttribute("aria-busy", "true");
  const status = form.querySelector(".status");
  if (status) status.textContent = "";
  try {
    if (!navigator.onLine) throw Error("offline");
    await operation();
  } catch (error) {
    if (form.isConnected) showError(readable(error));
  } finally {
    delete form.dataset.busy;
    for (const [el, disabled] of buttons) el.disabled = disabled;
    button.innerHTML = previous;
    form.removeAttribute("aria-busy");
    if (form.isConnected && focused?.isConnected && !focused.disabled && document.activeElement === document.body) focused.focus({preventScroll:true});
  }
}
function signInScreen(message = "") {
  document.title = "Sign in — Handoff";
  shell(
    `<div class="symbol">${pending ? mailIcon : homeIcon}</div><div class="eyebrow">YOUR SHARED SPACE FOR CARE</div><h1>${pending ? "Check your inbox." : "A little less<br>to carry."}</h1><p class="intro">${pending ? `We sent an 8-digit sign-in code to<br><span class="email-line">${escape(pending.email)}</span>` : "Keep your parent’s records, visits and family responsibilities together.<br>Sign in or create your account with your email."}</p><form id="auth-form" novalidate>${pending ? '<label class="field"><span>Sign-in code</span><input id="code" name="code" class="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]{8}" placeholder="00000000" aria-describedby="code-hint form-status"><small id="code-hint">Use the newest code. It expires after 15 minutes.</small></label>' : `<label class="field"><span>Email address</span><input id="email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${escape(storage.get("handoff.email", ""))}" aria-describedby="email-hint form-status"><small id="email-hint">We’ll send a code. No password to remember.</small></label>`}<div class="status" id="form-status" role="alert">${escape(message)}</div><button class="primary full" type="submit">${pending ? "Verify & continue" : "Continue with email"} <span aria-hidden="true">→</span></button></form>${pending ? '<div class="resend"><button class="text-button" id="change-email">← Change email</button><button class="text-button" id="resend">Send a new code</button></div>' : '<p class="fineprint">Evaluation release: use fictional care information.<br><a href="/privacy" data-route>How we handle your information</a></p>'}<div class="private-note">${lockIcon}Your household is only visible to its members.</div>`,
  );
  const form = $("#auth-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $(pending ? "#code" : "#email"),
      value = input.value.trim();
    const valid = pending
      ? /^\d{8}$/.test(value)
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    input.setAttribute("aria-invalid", String(!valid));
    if (!valid) {
      showError(
        pending
          ? "Enter the 8-digit code from your email."
          : "Enter a valid email address, like you@example.com.",
      );
      input.focus();
      return;
    }
    submit(form, pending ? "Verifying…" : "Sending your code…", async () => {
      if (pending) {
        let signedIn;
        try {
          signedIn = await auth.signIn(pending.email, value);
        } catch (error) {
          showError(
            readable(
              error,
              "That code is incorrect or has expired. Try the newest code, or request another.",
            ),
          );
          input.setAttribute("aria-invalid", "true");
          input.focus();
          return;
        }
        if (!signedIn) {
          showError(
            "That code could not be verified. Please request a new one.",
          );
          return;
        }
        pending = null;
        storage.remove("handoff.code");
        storage.remove("handoff.email");
        await finishSignIn();
      } else {
        const email = value.toLowerCase();
        await auth.signIn(email);
        pending = { email, sentAt: Date.now() };
        storage.set("handoff.code", pending);
        storage.set("handoff.email", email);
        signInScreen();
        announce("Code sent. Check your email.");
      }
    });
  });
  $("#change-email")?.addEventListener("click", () => {
    pending = null;
    storage.remove("handoff.code");
    signInScreen();
    $("#email").focus();
  });
  $("#resend")?.addEventListener("click", async (event) => {
    const b = event.currentTarget;
    if (b.dataset.busy || form.dataset.busy) return;
    const address = pending.email;
    b.dataset.busy = "true";
    b.disabled = true;
    b.textContent = "Sending…";
    try {
      await auth.signIn(address);
      if (!b.isConnected || pending?.email !== address) return;
      pending.sentAt = Date.now();
      storage.set("handoff.code", pending);
      $("#code").value = "";
      signInScreen();
      announce("A new code has been sent.");
    } catch (error) {
      showError(
        readable(
          error,
          "We couldn’t send another code. Please wait and retry.",
        ),
      );
    } finally {
      delete b.dataset.busy;
      updateCooldown();
    }
  });
  clearInterval(interval);
  interval = setInterval(updateCooldown, 1000);
  updateCooldown();
  function updateCooldown() {
    const b = $("#resend");
    if (!b || !pending || b.dataset.busy) return;
    const left = Math.max(
      0,
      Math.ceil((pending.sentAt + 60000 - Date.now()) / 1000),
    );
    b.disabled = left > 0 || !!form.dataset.busy;
    b.textContent = left ? `Resend in ${left}s` : "Send a new code";
  }
}
async function finishSignIn() {
  viewer = await auth.client.query("onboarding:viewer", {});
  if (!viewer) throw Error("Session not ready");
  const next = safeNext();
  go(next || "/households", true);
}
async function loadHouseholds() {
  let page = await auth.client.query("households:list", {
    paginationOpts: { numItems: 50, cursor: null },
  });
  households = page.page.filter((h) => h.status === "active");
  return households;
}
function loadDraft() {
  const key = `handoff.setup.${viewer.id}`,
    saved = storage.get(key);
  if (saved && saved.savedAt > Date.now() - 3600000) draft = saved;
  else {
    storage.remove(key);
    draft = blankDraft();
  }
}
function saveDraft() {
  draft.savedAt = Date.now();
  storage.set(`handoff.setup.${viewer.id}`, draft);
}
function stepScreen() {
  document.title = "Set up your household — Handoff";
  const step = draft.step;
  if (!["record","visit","task"].includes(draft.firstAction)) draft.firstAction=draft.firstTask?"task":"record";
  const heading =
    step === 1
      ? "Who’s in your corner?"
      : step === 2
        ? "What do you<br>need first?"
        : "Your space.<br>Your choices.";
  const intro =
    step === 1
      ? "A few details to make this space yours. You can use a nickname for the person you’re supporting."
      : step === 2
        ? "Choose where to begin. We’ll open the right place as soon as your household is ready."
        : "Keep coordination simple, or choose a little extra help. You can change these choices later.";
  let fields = "";
  if (step === 1) {
    const zones = [
      ...new Set([
        draft.timezone,
        "UTC",
        ...(Intl.supportedValuesOf
          ? Intl.supportedValuesOf("timeZone")
          : [
              "America/New_York",
              "America/Chicago",
              "America/Denver",
              "America/Los_Angeles",
              "Europe/London",
              "Asia/Kolkata",
            ]),
      ]),
    ].sort();
    fields = `<p class="hint">This evaluation release is for fictional care information. Use a sample person and sample records. <a href="/consumer-health-privacy" data-route>Care data details.</a></p><label class="field"><span>Your first name</span><input name="displayName" autocomplete="given-name" maxlength="80" value="${escape(draft.displayName)}" placeholder="What should we call you?" required></label><label class="field"><span>Who are you supporting?</span><input name="nickname" maxlength="80" value="${escape(draft.nickname)}" placeholder="For example, Dad or Alex" required><small>A nickname is enough. No medical details needed.</small></label><label class="field"><span>Household time zone</span><select name="timezone">${zones.map((z) => `<option value="${escape(z)}" ${z === draft.timezone ? "selected" : ""}>${escape(z.replaceAll("_", " "))}</option>`).join("")}</select></label><label class="check"><input type="checkbox" name="timezoneConfirmed" ${draft.timezoneConfirmed ? "checked" : ""}><span>This is the time zone we’ll use for household plans.</span></label>`;
  } else if (step === 2) {
    fields = `<div class="summary"><span class="avatar">${escape(draft.nickname[0]?.toUpperCase())}</span><div><strong>${escape(draft.nickname)}’s household</strong><small>${escape(draft.timezone.replaceAll("_", " "))}</small></div></div><fieldset style="border:0;padding:0;margin:0"><legend class="eyebrow">START WITH WHAT YOU HAVE</legend>${[
      ["record","Upload a care record","A report, prescription or discharge summary. Choose the file after setup; it starts private to you."],
      ["visit","Add an appointment","Enter a confirmed date and place, then arrange the ride and prepare your questions."],
      ["task","Add a responsibility","Name a practical next step, such as arranging a return ride or calling about a result."]
    ].map(([value,label,detail])=>`<label class="check choice"><input type="radio" name="firstAction" value="${value}" ${draft.firstAction===value?'checked':''}><span><strong>${label}</strong><small>${detail}</small></span></label>`).join('')}</fieldset><div data-first-task ${draft.firstAction==='task'?'':'hidden'}><label class="field"><span>Your first responsibility</span><input name="firstTask" maxlength="160" value="${escape(draft.firstTask)}" placeholder="e.g. Arrange Dad’s return ride" ${draft.firstAction==='task'?'required':'disabled'} aria-describedby="task-hint"><small id="task-hint">It starts unassigned. Someone must explicitly accept responsibility.</small></label><div class="suggestions" aria-label="Responsibility ideas">${["Arrange the return ride","Call about the test result","Bring the appointment paperwork"].map(t=>`<button type="button" data-suggestion="${escape(t)}">${escape(t)}</button>`).join('')}</div></div><p class="hint" style="margin-top:22px">You can add the other pieces whenever you need them.</p>`;
  } else {
    fields = `<label class="check"><input type="checkbox" name="adultConfirmed" ${draft.adultConfirmed ? "checked" : ""}><span>I’m 18 or older, and we’re supporting an adult.</span></label><label class="check"><input type="checkbox" name="authority" ${draft.authority ? "checked" : ""}><span>I have permission or authority to share this person’s care-coordination information with our household.<small>Choose care-circle access or a limited helper who sees only their assignments. Medical records have separate sharing choices.</small></span></label><div class="divider"></div><div class="eyebrow">OPTIONAL — OFF UNLESS YOU CHOOSE</div><label class="check choice"><input type="checkbox" name="emailImport" ${draft.emailImport ? "checked" : ""}><span><strong>A household email address</strong><small>AgentMail processes messages you forward to a separate household inbox. This does not connect your personal inbox.</small></span></label><label class="check choice"><input type="checkbox" name="aiProcessing" ${draft.aiProcessing ? "checked" : ""}><span><strong>Help organizing updates</strong><small>Google Gemini processes selected text, PDFs and images to suggest source-linked next steps and handover introductions. You review suggestions before they change a plan.</small></span></label><p class="hint">Manual coordination works with both switched off. <a href="/consumer-health-privacy" data-route>Read about care data and your choices.</a></p>`;
  }
  shell(
    `<div class="steps" aria-label="Step ${step} of 3">${[1, 2, 3].map((n) => `<i class="${n <= step ? "active" : ""}"></i>`).join("")}</div><div class="eyebrow">${step === 1 ? "1 · YOUR HOUSEHOLD" : step === 2 ? "2 · YOUR FIRST STEP" : "3 · SHARING & PRIVACY"}</div><h1>${heading}</h1><p class="intro">${intro}</p><form id="setup-form" novalidate>${fields}<div id="form-status" class="status" role="alert"></div><div class="button-row">${step > 1 ? '<button class="secondary" id="step-back" type="button">← Back</button>' : ""}<button class="primary" type="submit">${step === 3 ? "Create our household" : "Continue"} <span aria-hidden="true">→</span></button></div></form>`,
    true,
  );
  const form = $("#setup-form");
  function collect() {
    for (const el of form.elements) {
      if (el.name && (el.type !== "radio" || el.checked))
        draft[el.name] = el.type === "checkbox" ? el.checked : el.value;
    }
    saveDraft();
  }
  form.addEventListener("input", collect);
  form.addEventListener("change", collect);
  if(step===2){const syncFirstAction=()=>{const task=draft.firstAction==='task';$('[data-first-task]',form).hidden=!task;form.elements.firstTask.disabled=!task;form.elements.firstTask.required=task;};form.addEventListener('change',syncFirstAction);syncFirstAction();}
  $("#step-back")?.addEventListener("click", () => {
    collect();
    draft.step--;
    saveDraft();
    stepScreen();
  });
  document.querySelectorAll("[data-suggestion]").forEach((b) =>
    b.addEventListener("click", () => {
      form.elements.firstTask.value = b.dataset.suggestion;
      collect();
      form.elements.firstTask.focus();
    }),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    collect();
    let bad, message;
    if (step === 1) {
      if (!draft.displayName.trim()) {
        bad = "displayName";
        message = "Enter the name your household should see.";
      } else if (!draft.nickname.trim()) {
        bad = "nickname";
        message = "Add a name or nickname for the person you’re supporting.";
      } else if (!draft.timezoneConfirmed) {
        bad = "timezoneConfirmed";
        message = "Confirm the household time zone to continue.";
      }
    }
    if (step === 2 && draft.firstAction === "task" && !draft.firstTask.trim()) {
      bad = "firstTask";
      message = "Name the responsibility you want to add.";
    }
    if (step === 3 && (!draft.adultConfirmed || !draft.authority)) {
      bad = !draft.adultConfirmed ? "adultConfirmed" : "authority";
      message =
        "Please confirm both statements before creating this household.";
    }
    if (bad) {
      showError(message);
      form.elements[bad].setAttribute("aria-invalid", "true");
      form.elements[bad].focus();
      return;
    }
    if (step < 3) {
      draft.step++;
      saveDraft();
      stepScreen();
      return;
    }
    submit(form, "Creating your household…", async () => {
      const args = {
        nickname: draft.nickname.trim(),
        displayName: draft.displayName.trim(),
        timezone: draft.timezone,
        ...(draft.firstAction === "task" ? {firstTask:draft.firstTask.trim()} : {}),
        adultConfirmed: true,
        authorityStatement:
          "I have permission or authority to share this person’s care-coordination information with our household.",
        noticeVersion: "2026-09-20",
        emailImport: draft.emailImport,
        aiProcessing: draft.aiProcessing,
        requestId: draft.requestId,
      };
      // Keep the same key for ambiguous retries; a changed payload gets a new key.
      const fingerprint = JSON.stringify({ ...args, requestId: undefined });
      if (
        draft.submittedFingerprint &&
        draft.submittedFingerprint !== fingerprint
      ) {
        draft.requestId = crypto.randomUUID();
        args.requestId = draft.requestId;
      }
      draft.submittedFingerprint = fingerprint;
      saveDraft();
      const id = await auth.client.mutation("households:create", args);
      storage.remove(`handoff.setup.${viewer.id}`);
      viewer = await auth.client.query("onboarding:viewer", {});
      storage.set("handoff.just-created", id);
      go(`/h/${id}/${draft.firstAction === "record" ? "records?upload=1" : draft.firstAction === "visit" ? "visits/new" : "today"}`, true);
    });
  });
}
async function householdScreen() {
  document.title = "Your households — Handoff";
  await loadHouseholds();
  if (!households.length) {
    go("/start", true);
    return;
  }
  if (
    households.length === 1 &&
    !new URLSearchParams(location.search).has("choose")
  ) {
    go(`/h/${households[0].householdId}/${households[0].accessPreset==="limited_helper"?"my-responsibilities":"today"}`, true);
    return;
  }
  const sampleSuffix=auth.sampleSession?"?sample=1":"";
  shell(
    `<div class="eyebrow">WELCOME BACK</div><h1>Your households.</h1><p class="intro">Choose the space you’d like to open.</p>${households.map((h) => `<a class="household-option" data-route href="/h/${h.householdId}/${h.accessPreset==="limited_helper"?"my-responsibilities":"today"}${sampleSuffix}"><span class="avatar">${escape(h.nickname[0].toUpperCase())}</span><strong>${escape(h.nickname)}</strong><span aria-hidden="true">→</span></a>`).join("")}<div class="divider"></div>${auth.sampleSession?'<a class="secondary full" href="/sign-in">Use your own account</a>':'<a class="secondary full" href="/start" data-route>Create another household</a>'}<p class="fineprint"><a href="/account${sampleSuffix}" data-route>Your account</a> · <a href="/privacy-requests${sampleSuffix}" data-route>My data requests</a></p>`,
  );
}
async function joinScreen(token) {
  const version = routeVersion;
  const unavailable = error => {
    if (version !== routeVersion) return;
    shell(
      `<div class="eyebrow">INVITATION</div><h1>Let’s check<br>that link.</h1><p class="intro">${escape(readable(error, "This invitation is unavailable. Ask the household owner for a new link."))}</p><a href="/households" data-route class="primary full">Go to my households</a><p class="fineprint">Signed in as ${escape(viewer.email)}. Use Sign out above to change accounts.</p>`,
    );
  };
  document.title = "Join a household — Handoff";
  shell(
    '<div class="eyebrow">INVITATION</div><h1>One moment.</h1><p class="intro" role="status">Checking your invitation…</p>',
  );
  try {
    const invite = await auth.client.action("invites:preview", { token });
    if (version !== routeVersion) return;
    const accepted = invite.status === "accepted";
    shell(
      `<div class="symbol">${homeIcon}</div><div class="eyebrow">${accepted ? "YOUR HOUSEHOLD" : "YOU’RE INVITED"}</div><h1>${accepted ? "Welcome back." : "Care is better<br>shared."}</h1><p class="intro">${escape(invite.inviterName)} invited you to <strong>${escape(invite.nickname)}’s household</strong>.</p><div class="summary"><span class="avatar">${escape(invite.nickname[0])}</span><div><strong>${escape(invite.nickname)}</strong><small>A private household</small></div></div><p class="hint">${accepted ? "You already joined this household. Open it to see the current shared plan." : invite.accessPreset === "limited_helper" ? "You are joining as a limited helper. You will see only your requested or accepted responsibilities, their practical travel details, and your own availability. Accepting a responsibility is a separate choice." : "You are joining the care circle, with access to shared responsibilities, visits and updates. Medical information and email require separate access. Taking on a responsibility is always a separate choice."}</p><form id="join-form">${accepted || viewer.displayName ? "" : '<label class="field"><span>Your first name</span><input name="displayName" autocomplete="given-name" maxlength="80" required></label>'}${accepted ? "" : '<label class="check"><input name="accept" type="checkbox" required><span>I’m an adult and agree to join this shared household.</span></label>'}<div class="status" id="form-status" role="alert"></div><button class="primary full" type="submit">${invite.status === "accepted" ? "Open household" : "Join household"} →</button></form>${accepted ? "" : '<button class="text-button" id="decline">Decline invitation</button>'}`,
    );
    $("#join-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      submit(form, accepted ? "Opening…" : "Joining…", async () => {
        if (form.elements.displayName) {
          await auth.client.mutation("team:setDisplayName", {
            displayName: form.elements.displayName.value,
          });
          viewer = await auth.client.query("onboarding:viewer", {});
        }
        const id = await auth.client.action("invites:respond", {
          token,
          accept: true,
        });
        if (version === routeVersion) go(`/h/${id}/${invite.accessPreset==="limited_helper"?"my-responsibilities":"today"}`, true);
      });
    });
    $("#decline")?.addEventListener("click", () => {
      submit($("#join-form"), "Declining…", async () => {
        await auth.client.action("invites:respond", { token, accept: false });
        if (version === routeVersion) go("/households", true);
      });
    });
    if (!accepted) subscriptions.push(watchDeadline(invite.expiresAt, expired => {
      // A device clock ahead of the server must not trigger preview → expired
      // → preview indefinitely. Clear joining controls locally; the server
      // independently checks the deadline for every submitted response.
      if (expired) unavailable({data:{message:"This invitation has expired. Ask the household owner for a new link."}});
    }));
  } catch (error) {
    unavailable(error);
  }
}
function taskMarkup(task) {
  return `<div class="task-row"><button class="task-complete" data-complete="${task._id}" aria-label="Complete ${escape(task.title)}"></button><div class="task-content"><strong>${escape(task.title)}</strong><small>${task.ownerId === viewer.id ? "You’re taking this" : task.ownerId ? "Assigned to a household member" : "Not yet assigned"}</small></div>${!task.ownerId ? `<button class="secondary" data-claim="${task._id}">I’ll take this</button>` : ""}</div>`;
}
async function todayScreen(id, version) {
  await loadHouseholds();
  if (routeVersion !== version) return;
  const household = households.find((h) => h.householdId === id);
  if (!household) throw { data: { code: "NOT_FOUND" } };
  document.title = `${household.nickname}’s household — Handoff`;
  $("#app").innerHTML =
    `<div class="app-shell"><aside class="sidebar"><a class="wordmark" href="/">Handoff</a><div class="space-name"><span class="avatar">${escape(household.nickname[0]?.toUpperCase())}</span><span>${escape(household.nickname)}’s household</span></div><nav aria-label="Household"><a class="current" href="/h/${id}/today" data-route>${homeIcon}<span>Today</span></a><button id="team-button">${peopleIcon}<span>People</span></button><button id="preferences-button">${lockIcon}<span>Sharing & privacy</span></button><a href="/households?choose=1" data-route>${switchIcon}<span>Switch household</span></a></nav><div class="sidebar-foot"><p>${escape(viewer.displayName || "Your account")}</p><button class="quiet-link" data-signout>Sign out</button><a href="/help" data-route class="quiet-link">Help with Handoff</a></div></aside><main id="main" class="workspace"><div class="workspace-top"><span class="eyebrow">YOUR SHARED SPACE</span><span class="live" id="connection-status">Connecting…</span></div><div class="page-heading"><div><h1>A little more together.</h1><p>Here’s what’s happening for ${escape(household.nickname)}.</p></div><button class="primary" id="add-task">+ Add responsibility</button></div>${household.role === "owner" && storage.get("handoff.just-created") === id ? '<div class="welcome-note"><div><strong>Your household is ready.</strong><p>Your care space is ready. Invite someone when you want help with the next steps.</p></div><button class="secondary" id="invite-first">Invite someone →</button></div>' : ""}<div id="form-status" class="status" role="alert"></div><div id="board" aria-busy="true"><div class="panel"><p role="status">Loading your household…</p></div></div><div id="mail-connection"></div></main></div><dialog class="modal" id="workspace-dialog" aria-labelledby="dialog-title"></dialog>`;
  bindCommon();
  $("#add-task").onclick = () => taskDialog(id);
  $("#team-button").onclick = () => teamDialog(id);
  $("#invite-first")?.addEventListener("click", () => inviteDialog(id));
  $("#preferences-button").onclick = () => preferencesDialog(id);
  const details = await auth.client.query("households:get", {
    householdId: id,
  });
  if (routeVersion !== version) return;
  let stopToday;
  const subscribeToday = () => {
    stopToday?.();
    const now = Date.now();
    stopToday = auth.client.onUpdate(
      "today:get",
      {
        householdId: id,
        now,
        dayEnd: householdDayEnd(now, details.timezone),
        mine: false,
      },
      (data) => {
        if (routeVersion !== version) return;
        board = data;
        $("#connection-status").textContent = navigator.onLine
          ? "Live updates"
          : "Offline";
        $("#board").removeAttribute("aria-busy");
        const tasks = [
          ...new Map(
            [...data.tasks, ...data.unassigned].map((t) => [t._id, t]),
          ).values(),
        ];
        $("#board").innerHTML =
          `<div class="board-grid"><section class="panel"><div class="eyebrow">THE EVERYDAY THINGS</div><h3>Responsibilities <span class="tag">${tasks.length} open</span></h3>${tasks.length ? tasks.map(taskMarkup).join("") : '<div class="empty-state">No open responsibilities for today.<br>Add the next thing whenever you’re ready.</div>'}${data.more.tasks ? '<p class="hint">Showing the first 20 responsibilities.</p>' : ""}</section><div><section class="panel"><div class="eyebrow">IN THIS TOGETHER</div><h3>Who’s here</h3><p>${data.coverage ? "Someone has started a coverage period. Check with your household for the latest." : "No one has started a coverage period. A plan alone doesn’t mean someone has arrived."}</p></section><section class="panel"><div class="eyebrow">NEXT VISIT</div>${data.nextVisit ? `<h3>${escape(data.nextVisit.title || "Upcoming visit")}</h3><p>${escape(new Date(data.nextVisit.confirmedStartsAt).toLocaleString(undefined, { timeZone: data.household.timezone, dateStyle: "medium", timeStyle: "short" }))}</p>` : "<h3>A little breathing room.</h3><p>No upcoming visit has been added.</p>"}</section></div></div>`;
        for (const b of document.querySelectorAll(
          "[data-complete],[data-claim]",
        ))
          b.onclick = async () => {
            const task = tasks.find(
              (t) => t._id === (b.dataset.complete || b.dataset.claim),
            );
            b.disabled = true;
            try {
              await auth.client.mutation("tasks:transition", {
                taskId: task._id,
                expectedVersion: task.version,
                operation: b.dataset.complete ? "complete" : "claim",
              });
              announce(
                b.dataset.complete
                  ? "Responsibility completed."
                  : "You’ve taken this responsibility.",
              );
            } catch (error) {
              showError(readable(error));
              b.disabled = false;
            }
          };
      },
      (error) => {
        if (routeVersion === version) {
          ++routeVersion;
          document.title = "Household unavailable — Handoff";
          clearSubscriptions();
          shell(
            `<div class="eyebrow">YOUR HOUSEHOLD</div><h1>This space is<br>unavailable.</h1><p class="intro">${escape(readable(error))}</p><a href="/households" data-route class="primary full">My households</a>`,
          );
        }
      },
    );
  };
  subscribeToday();
  interval = setInterval(subscribeToday, 60000);
  subscriptions.push(() => stopToday?.());
  const connectionChanged = (state) => {
    const el = $("#connection-status");
    if (routeVersion !== version || !el) return;
    el.textContent = !navigator.onLine
      ? "Offline"
      : state.isWebSocketConnected
        ? "Live updates"
        : "Reconnecting…";
    el.classList.toggle("disconnected", !state.isWebSocketConnected);
  };
  subscriptions.push(auth.client.subscribeToConnectionState(connectionChanged));
  connectionChanged(auth.client.connectionState());
  subscriptions.push(
    auth.client.onUpdate(
      "inbox:connection",
      { householdId: id },
      (connection) => {
        if (routeVersion !== version) return;
        $("#mail-connection").innerHTML =
          connection?.status === "ready"
            ? `<p class="hint" style="margin-top:24px">Household inbox: <strong>${escape(connection.address)}</strong></p>`
            : board?.household.emailImport
              ? `<p class="hint" style="margin-top:24px">${connection?.status === "failed" ? "Your email address couldn’t be prepared. Manual coordination still works." : "Preparing your household email address. You can keep going."}</p>`
              : "";
      },
      () => {
        if (routeVersion === version)
          $("#mail-connection").textContent =
            "Household email is currently unavailable. Responsibilities remain usable.";
      },
    ),
  );
}
function openDialog(title, body) {
  const d = $("#workspace-dialog");
  d.innerHTML = `<div class="modal-head"><h2 id="dialog-title">${title}</h2><button class="close" aria-label="Close dialog">×</button></div>${body}`;
  d.querySelector(".close").onclick = () => d.close();
  d.showModal();
  return d;
}
function taskDialog(id) {
  const d = openDialog(
    "One more thing.",
    `<form id="task-form"><label class="field"><span>Responsibility</span><input name="title" maxlength="160" required placeholder="What needs doing?"></label><label class="check"><input name="mine" type="checkbox"><span>I’ll take responsibility for this.</span></label><div class="status" id="task-status" role="alert"></div><button class="primary full" type="submit">Add responsibility</button></form>`,
  );
  const requestId = crypto.randomUUID();
  $("#task-form").onsubmit = (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    submit(f, "Saving…", async () => {
      await auth.client.mutation("tasks:create", {
        householdId: id,
        title: f.elements.title.value,
        category: "logistics",
        dueAt: null,
        note: "",
        requestedOwnerId: f.elements.mine.checked ? viewer.id : null,
        requestId,
      });
      d.close();
    });
  };
}
function inviteDialog(id) {
  const d = openDialog(
    "Bring someone in.",
    `<p>Choose one adult you share care with. Only that email address can use the invitation.</p><form id="invite-form"><label class="field"><span>Their email address</span><input name="email" type="email" autocomplete="off" required></label><div class="status" id="invite-status" role="alert"></div><button class="primary full" type="submit">Create private invitation link</button></form><p class="hint">You’ll get a link to share yourself. No email is sent automatically.</p>`,
  );
  $("#invite-form").onsubmit = (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    submit(f, "Creating link…", async () => {
      const result = await auth.client.action("invites:create", {
        householdId: id,
        email: f.elements.email.value,
      });
      const url = `${location.origin}/join/${result.token}`;
      d.innerHTML = `<div class="modal-head"><h2 id="dialog-title">A place for them.</h2><button class="close" aria-label="Close dialog">×</button></div><p>Share this private link with the person you invited. It expires in seven days.</p><label class="field"><span>Invitation link</span><input id="invite-link" readonly value="${escape(url)}"></label><button class="primary full" id="copy-invite">Copy invitation link</button><p id="copy-status" role="status"></p>`;
      d.querySelector(".close").onclick = () => d.close();
      $("#copy-invite").onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          $("#copy-status").textContent = "Link copied. Share it privately.";
        } catch {
          $("#invite-link").select();
          $("#copy-status").textContent = "Select and copy the link above.";
        }
      };
    });
  };
}
async function teamDialog(id) {
  const d = openDialog(
    "In this together.",
    '<p role="status">Loading household members…</p>',
  );
  try {
    const data = await auth.client.query("team:list", { householdId: id });
    d.innerHTML = `<div class="modal-head"><h2 id="dialog-title">In this together.</h2><button class="close" aria-label="Close dialog">×</button></div>${data.members.map((m) => `<div class="members"><span class="avatar">${escape(m.displayName[0])}</span><div><p>${escape(m.displayName)}</p><small>${m.membership.role === "owner" ? "Household owner" : "Household member"}</small></div></div>`).join("")}${data.invites.length ? `<p>${data.invites.length} pending invitation${data.invites.length === 1 ? "" : "s"}.</p>` : ""}${households.find((h) => h.householdId === id)?.role === "owner" ? '<button id="team-invite" class="primary full">Invite someone</button>' : ""}`;
    d.querySelector(".close").onclick = () => d.close();
    d.querySelector(".close").focus();
    $("#team-invite")?.addEventListener("click", () => {
      d.close();
      inviteDialog(id);
    });
  } catch (error) {
    d.innerHTML = `<p>${escape(readable(error))}</p><button class="secondary" id="close-error">Close</button>`;
    $("#close-error").onclick = () => d.close();
  }
}
async function preferencesDialog(id) {
  if (!board) return;
  const h = board.household;
  const owner = households.find((x) => x.householdId === id)?.role === "owner";
  const d = openDialog(
    "Sharing & privacy.",
    `<p>Optional processing stays under your household’s control. Turning it off stops new processing.</p><form id="preferences-form"><label class="check choice"><input type="checkbox" name="emailImport" ${h.emailImport ? "checked" : ""} ${owner ? "" : "disabled"}><span>Household email<small>AgentMail processes forwarded messages.</small></span></label><label class="check choice"><input type="checkbox" name="aiProcessing" ${h.aiProcessing ? "checked" : ""} ${owner ? "" : "disabled"}><span>Help organizing updates<small>Google Gemini processes selected text and documents for suggestions.</small></span></label><div id="preferences-status" class="status" role="alert"></div>${owner ? '<button class="primary full" type="submit">Save choices</button>' : "<p>Only the household owner can change these choices.</p>"}</form><p><a href="/consumer-health-privacy">Care data policy</a></p>`,
  );
  $("#preferences-form").onsubmit = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    submit(form, "Saving…", async () => {
      for (const scope of ["emailImport", "aiProcessing"]) {
        const granted = form.elements[scope].checked;
        if (granted !== h[scope])
          await auth.client.mutation("consents:set", {
            householdId: id,
            scope,
            granted,
            noticeVersion: "2026-09-20",
            authorityStatement: "Household owner controls optional processing.",
          });
      }
      d.close();
      announce("Sharing choices saved.");
    });
  };
}
const policies = {
  "/privacy": [
    "Privacy, plainly.",
    "Handoff stores your verified email, display name, household membership, responsibilities and the coordination details you choose to add. Convex stores and synchronizes this information for authorized household members.",
    "An AgentMail inbox sends your sign-in code. Optional household email uses a separate AgentMail inbox for messages you forward; it does not grant access to your personal mailbox. Optional AI processing sends selected text, PDFs or images to Google Gemini to propose source-linked information for your review. Public logistics pages are fetched through Firecrawl without including your household notes.",
    "We do not include advertising, session replay or third-party tracking on these screens. Fonts and interface assets load from Handoff. Opening a map sends the viewed area to OpenFreeMap; a place search sends the search text to Photon. Use public locations in place search and enter a private home manually. Session tokens are stored in this browser so you can return without signing in every time. Setup drafts stay in this tab for up to one hour and are cleared when you sign out or complete setup.",
    "Invite people who should see the shared coordination plan, and choose medical-record readers separately. You can switch off optional processing under Settings → Sharing & processing. Already delivered email cannot be recalled. See the care data policy for the limits of this release.",
  ],
  "/consumer-health-privacy": [
    "Care data is personal.",
    "Names, care arrangements, appointment logistics and free text can reveal health information. Use a nickname and include only the practical details your household needs. Records, reference medicine lists, allergies and care contacts may contain sensitive information. Share only what you have authority to share; keep emergency arrangements outside the app.",
    "Household coordination requires your authority to share the information. Email import and AI processing are separate, optional choices and start switched off. AgentMail processes forwarded email when enabled. Google Gemini processes selected text and documents when AI is enabled. Both may receive sensitive information you include.",
    "A new medical record is private to its uploader until readers are selected. Care profile access is granted separately. Limited helpers see their assigned responsibilities and the travel details needed for them, without access to medical reports. We do not sell care data or use advertising trackers. Care-circle members can request an export of information they can access under Settings → Your data. The household owner can request household deletion there; private progress receipts remain under My data requests. This evaluation release is for synthetic information only.",
    "You can immediately stop new optional processing under Settings → Sharing & processing. Existing shared records remain until removed through the service’s deletion process. This release has not established a public rights-contact address; use synthetic information during evaluation.",
  ],
  "/terms": [
    "A shared place for the everyday.",
    "Handoff is for adults coordinating everyday support for an adult family member. Only share information you have permission or authority to share, and invite people you trust.",
    "Handoff does not provide medical advice, monitor emergencies or confirm that a person is safe. Coverage and task status reflect what household members record. Use your existing care arrangements for urgent needs.",
    "Email delivery, public sources and generated suggestions can be delayed or incorrect. Review suggestions and verify important plans with the people involved. This evaluation release comes without an uptime or response-time guarantee.",
  ],
  "/help": [
    "A little help getting started.",
    "Use your email to request an eight-digit sign-in code. Keep this tab open, check your inbox and spam folder, then enter the newest code. Codes expire after 15 minutes; resend becomes available after one minute.",
    "Create a household with a nickname and a confirmed time zone. Choose your first step: upload a record, add an appointment or name a responsibility. Optional email and AI processing can stay off. A new responsibility starts unassigned; choose “Take this” when you are ready to own it. Use fictional care information in this evaluation release.",
    "Invite someone by entering their email and sharing the private link yourself. They must sign in with that same email and accept. An invitation does not assign work automatically.",
    "Your setup entries survive a refresh in the same tab for one hour. If your connection drops, reconnect before saving. Handoff does not make offline changes to shared responsibilities.",
  ],
};
function legalScreen(path) {
  const [title, ...paragraphs] = policies[path];
  document.title = `${title} — Handoff`;
  $("#app").innerHTML =
    `<div class="sky-shell"><header class="auth-header"><a class="wordmark" href="/">Handoff</a><a class="quiet-link" href="/sign-in" data-route>Open my space →</a></header><main id="main" class="auth-main"><article class="legal"><button class="quiet-link" id="legal-back">← Back</button><div class="eyebrow">HANDOFF · UPDATED 21 SEPTEMBER 2026</div><h1>${title}</h1>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</article></main>${footer()}</div>`;
  bindCommon();
  const heading = $("h1");
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  $("#legal-back").onclick = () => {
    if (history.length > 1) history.back();
    else go("/sign-in");
  };
}
function offlineScreen() {
  document.title = "Connection unavailable — Handoff";
  shell('<div class="eyebrow">CONNECTION UNAVAILABLE</div><h1>You’re offline.</h1><p class="intro">Reconnect to open your space. Your household will load automatically when your connection returns.</p><button class="primary full" id="retry-page">Try again</button><p class="fineprint">No household information is stored for offline viewing.</p>');
  $("#retry-page").onclick = route;
}
async function route() {
  if(workspaceDispose?.routePanel?.(location.pathname+location.search))return;
  const version = ++routeVersion;
  clearSubscriptions();
  routeLoading = false;
  offlineRoute = false;
  announce("");
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (policies[path]) {
    legalScreen(path);
    return;
  }
  if (!navigator.onLine) {
    offlineRoute = true;
    offlineScreen();
    return;
  }
  routeLoading = true;
  if (document.querySelector('.product-shell')) {
    document.querySelector('#view').innerHTML = '<p role="status" class="ui-hint">Opening…</p>';
  } else shell(
    '<div class="eyebrow">YOUR SHARED SPACE</div><h1>One moment.</h1><p class="intro" role="status"><span class="spinner" aria-hidden="true"></span> Opening your space…</p>',
  );
  try {
    if (path === "/demo" || path === "/demo/join") {
      // Sample entry includes one-use authentication and household creation.
      // Do not automatically replay those actions after a connection change.
      routeLoading = false;
      if (path === "/demo/join") {
        const token = location.hash.slice(1);
        history.replaceState({}, "", location.pathname);
        if (!token) throw {data:{message:"This sample role link has expired. Open a new role link from the sample household."}};
        await auth.signInSample(token);
      } else if (!auth.hasSession()) await auth.signInSample();
      viewer = await auth.client.query("onboarding:viewer", {});
      if (version !== routeVersion) return;
      const id = path === "/demo" ? await auth.client.action("demoTokens:create", {}) : (await auth.client.query("households:list", {paginationOpts:{numItems:25,cursor:null}})).page.find(h=>h.status==='active')?.householdId;
      if (!id) throw Error("Sample household unavailable");
      const intent=new URLSearchParams(location.search).get('intent');
      go(`/h/${id}/${intent==='handover'?'handovers/new':'today'}?sample=1`, true); return;
    }
    viewer = auth.hasSession()
      ? await auth.client.query("onboarding:viewer", {})
      : null;
    if (version !== routeVersion) return;
    if (!viewer || (viewer.anonymous && !auth.sampleSession)) {
      viewer = null;
      if (path !== "/sign-in") {
        go(`/sign-in?next=${encodeURIComponent(path+location.search)}`, true);
        return;
      }
      signInScreen(sessionMessage); sessionMessage = "";
      return;
    }
    if (path === "/sign-in") {
      await finishSignIn();
      return;
    }
    if (path === "/start") {
      loadDraft();
      stepScreen();
      return;
    }
    if (path === "/households") {
      await householdScreen();
      return;
    }
    if (path === "/visit-packs/shared") {
      workspaceDispose = mountSharedPack({auth,viewer,go,isCurrent:()=>version===routeVersion,shareId:new URLSearchParams(location.search).get("shareId")});return;
    }
    if (path === "/records/shared") {
      workspaceDispose = mountSharedRecord({auth,viewer,go,isCurrent:()=>version===routeVersion,shareId:new URLSearchParams(location.search).get("shareId")});return;
    }
    if (path === "/account") {
      workspaceDispose = mountAccount({auth,go,isCurrent:()=>version===routeVersion});return;
    }
    if (path.startsWith('/privacy-requests')) {
      workspaceDispose = mountPrivacy({auth,viewer,go,isCurrent:()=>version===routeVersion});return;
    }
    const join = path.match(/^\/join\/([^/]+)$/);
    if (join) {
      await joinScreen(join[1]);
      return;
    }
    if (/^\/h\/[a-z0-9]+\//.test(path)) {
      const dispose = await mountWorkspace({auth, viewer, go, isCurrent: () => version === routeVersion});
      if (version === routeVersion) workspaceDispose = dispose; else dispose();
      return;
    }
    go("/households", true);
  } catch (error) {
    if (version !== routeVersion) return;
    shell(
      `<div class="eyebrow">LET’S TRY THAT AGAIN</div><h1>A small pause.</h1><p class="intro">${escape(readable(error, "We couldn’t open your space. Check your connection and try again."))}</p><button class="primary full" id="retry-page">Try again</button><a class="quiet-link" href="/households" data-route>My households</a>`,
    );
    $("#retry-page").onclick = route;
  } finally {
    if (version === routeVersion) routeLoading = false;
  }
}
window.addEventListener("popstate",async event=>{
 const nextIndex=event.state?.handoffIndex;
 if(restoringHistory){restoringHistory=false;const resume=pendingBack;pendingBack=null;resume?.();return;}
 if((hasUnsavedChanges()||document.querySelector('form[aria-busy="true"]'))&&Number.isInteger(nextIndex)&&nextIndex!==historyIndex){
  const delta=nextIndex-historyIndex;restoringHistory=true;
  pendingBack=async()=>{if(await mayLeave()){document.querySelectorAll('form[data-dirty]').forEach(form=>form.dataset.dirty='');history.go(delta);}};
  history.go(-delta);return;
 }
 historyIndex=Number.isInteger(nextIndex)?nextIndex:historyIndex;
 route();
});
window.addEventListener("handoff:session-ended", (event) => {
  sessionMessage = event.detail?.remoteRevoked === false ? "You’re signed out on this browser. Server sign-out couldn’t be confirmed because the connection failed." : "";
  clearSubscriptions();
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const k = sessionStorage.key(i);
    if (k?.startsWith("handoff.")) sessionStorage.removeItem(k);
  }
  viewer = null;
  pending = null;
  const next = location.pathname.startsWith("/join/")
    ? `?next=${encodeURIComponent(location.pathname)}`
    : "";
  go(`/sign-in${next}`, true);
});
window.addEventListener("handoff:session-changed", route);
window.addEventListener("offline", () => {
  // A bootstrap read may wait for the WebSocket indefinitely. Replace only
  // that loading route; an already-open editor must keep its unsaved values.
  if (routeLoading) {
    ++routeVersion;
    clearSubscriptions();
    routeLoading = false;
    offlineRoute = true;
    offlineScreen();
  }
  announce("You’re offline. Reconnect before saving.");
  const el = $("#connection-status");
  if (el) el.textContent = "Offline";
});
window.addEventListener("online", () => {
  if (offlineRoute) { void route(); return; }
  announce("Connection restored.");
  const el = $("#connection-status");
  if (el) el.textContent = "Reconnecting…";
});
try {
  auth = await import("./auth-client.js");
  await route();
} catch {
  shell(
    '<div class="eyebrow">CONNECTION UNAVAILABLE</div><h1>A small pause.</h1><p class="intro">Handoff couldn’t connect. Please reload and try again.</p><a class="primary full" href="/sign-in">Reload sign-in</a>',
  );
}
