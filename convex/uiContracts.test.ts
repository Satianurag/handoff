/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import schema from "./schema";
import type { FunctionReturnType, PaginationResult } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
const paginationOpts = { numItems: 25, cursor: null };
async function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async ctx => {
    await ctx.db.insert("operatorSettings", { key: "pauseAutomaticOperations", enabled: true, updatedAt: Date.now() });
    return { owner: await ctx.db.insert("users", { email: "owner@example.test", emailVerificationTime: 1 }), recipient: await ctx.db.insert("users", { email: "recipient@example.test", emailVerificationTime: 1 }), outsider: await ctx.db.insert("users", { email: "outsider@example.test", emailVerificationTime: 1 }) };
  });
  const owner = t.withIdentity({ subject: ids.owner }), recipient = t.withIdentity({ subject: ids.recipient }), outsider = t.withIdentity({ subject: ids.outsider });
  const householdId = await owner.mutation(api.households.create, { nickname: "Test household", timezone: "America/New_York", firstTask: "First task", adultConfirmed: true, authorityStatement: "Synthetic test", noticeVersion: "test", emailImport: false, aiProcessing: false, requestId: "setup" });
  const membershipId = await t.run(ctx => ctx.db.insert("memberships", { householdId, userId: ids.recipient, role: "member", status: "active", joinedAt: Date.now(), emailNotifications: false, lastReadSequence: 0 }));
  const taskId = (await owner.query(api.tasks.list, { householdId, status: "open", paginationOpts })).page[0]._id;
  return { t, ids, owner, recipient, outsider, householdId, membershipId, taskId };
}

async function grantRecipientCare(s: Awaited<ReturnType<typeof setup>>) {
  await s.owner.mutation(api.care.saveProfile, { householdId:s.householdId, expectedVersion:0,
    preferredName:"Synthetic parent", dateOfBirth:"", allergiesState:"unknown", allergies:"", conditions:"",
    preferences:"", communication:"", emergencyInstructions:"", authorizedUserIds:[s.ids.recipient], authorityStatement:"Synthetic test only" });
}

test("ownership and due filters paginate all 61 matches beyond unrelated earlier rows", async () => {
  const { t, owner, recipient, ids, householdId } = await setup();
  await t.run(async ctx => {
    const base = { householdId, title: "Task", category: "logistics" as const, dueAt: null, ownerId: null, requestedOwnerId: null, status: "open" as const, note: "", sourceRefs: [], version: 1, createdBy: ids.owner, updatedAt: 1 };
    for (let i = 0; i < 70; i++) await ctx.db.insert("tasks", { ...base, ownerId: ids.owner });
    for (let i = 0; i < 61; i++) await ctx.db.insert("tasks", { ...base, title: `Request ${i}`, requestedOwnerId: ids.recipient });
  });
  const found = new Set(); let cursor: string | null = null;
  do {
    const result: PaginationResult<Doc<"tasks">> = await recipient.query(api.tasks.list, { householdId, status: "open", ownership: "requested", due: "undated", paginationOpts: { numItems: 25, cursor } });
    result.page.forEach(row => { expect(row.requestedOwnerId).toBe(ids.recipient); found.add(row._id); });
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  expect(found.size).toBe(61);
  expect((await owner.query(api.tasks.list, { householdId, status: "open", ownership: "requested", paginationOpts })).page).toHaveLength(0);
});

test.each([
  ["spring", Date.parse("2026-03-08T16:00Z"), Date.parse("2026-03-08T05:00Z"), Date.parse("2026-03-09T04:00Z")],
  ["fall", Date.parse("2026-11-01T17:00Z"), Date.parse("2026-11-01T04:00Z"), Date.parse("2026-11-02T05:00Z")],
])("dated filters use household midnight through %s DST and retain distant overdue/later records", async (_label, now, start, next) => {
  const {t, owner, recipient, outsider, ids, householdId} = await setup();
  await t.run(async ctx => {
    const base = {householdId, category:"logistics" as const, ownerId:ids.owner, requestedOwnerId:ids.recipient, status:"open" as const, note:"", sourceRefs:[], version:1, createdBy:ids.owner, updatedAt:1};
    for (const [title,dueAt] of [["Old",0],["Yesterday",start-1],["Midnight",start],["Before now",now-1],["Now",now],["Last instant",next-1],["Tomorrow",next],["Distant",Date.parse("2099-12-01T00:00Z")],["Undated",null]] as const) await ctx.db.insert("tasks",{...base,title,dueAt});
  });
  for (const [client,ownership] of [[owner,"mine"],[recipient,"requested"],[owner,"all"]] as const) {
    for (const [due,titles] of [["today",["Midnight","Before now","Now","Last instant"]],["overdue",["Old","Yesterday","Midnight","Before now"]],["later",["Tomorrow","Distant"]]] as const) {
      const found:string[]=[];let cursor:string|null=null;
      do {
        const result:PaginationResult<Doc<"tasks">>=await client.query(api.tasks.list,{householdId,status:"open",ownership,due,now,paginationOpts:{numItems:2,cursor}});
        found.push(...result.page.map(x=>x.title));cursor=result.isDone?null:result.continueCursor;
      } while(cursor);
      expect(found).toEqual(titles);
    }
  }
  expect((await owner.query(api.tasks.list,{householdId,status:"open",ownership:"unassigned",due:"today",now,paginationOpts})).page).toHaveLength(0);
  await expect(outsider.query(api.tasks.list,{householdId,status:"open",due:"today",now,paginationOpts})).rejects.toThrow("unavailable");
  await expect(owner.query(api.tasks.list,{householdId,status:"open",due:"today",paginationOpts})).rejects.toThrow("Refresh");
  await expect(owner.query(api.tasks.list,{householdId,status:"open",due:"today",now:Infinity,paginationOpts})).rejects.toThrow();
});

test("Today separates dated, undated, later and requested work and retains overdue visits", async () => {
  const { owner, householdId, ids } = await setup(); const now = Date.now();
  for (const [title, dueAt, requestedOwnerId] of [["Due", now, ids.owner], ["Later", now + 3 * 86400000, ids.owner], ["No date", null, ids.owner], ["Request", now, ids.recipient]] as const) await owner.mutation(api.tasks.create, { householdId, title, category: "logistics", dueAt, requestedOwnerId, note: "", requestId: title });
  await owner.mutation(api.visits.create, { householdId, title: "Unresolved visit", confirmedStartsAt: now - 86400000, timezone: "UTC", confirmedAddress: "", phone: "", note: "", checklist: [], requestId: "visit" });
  const result = await owner.query(api.today.get, { householdId, now, dayEnd: now + 3600000, mine: true });
  expect(result.tasks.map(x => x.title)).toEqual(["Due"]);
  expect(result.later.map(x => x.title)).toEqual(["Later"]);
  expect(result.undated.map(x => x.title)).toEqual(["No date"]);
  expect(result.overdueVisits).toHaveLength(1);
  expect(result.baselineAt).toBeNull();
});

test("coverage agenda includes blocks starting before range and can inspect cancelled history", async () => {
  const { owner, householdId } = await setup(); const from = Date.now(), to = from + 86400000;
  const active = await owner.mutation(api.coverage.create, { householdId, startsAt: from - 3600000, endsAt: from + 3600000, volunteer: false, note: "", requestId: "overlap" });
  const cancelled = await owner.mutation(api.coverage.create, { householdId, startsAt: from - 7200000, endsAt: from + 3600000, volunteer: false, note: "", requestId: "cancel" });
  await owner.mutation(api.coverage.transition, { coverageId: cancelled, expectedVersion: 1, operation: "cancel" });
  expect((await owner.query(api.upcoming.list, { householdId, kind: "coverage", from, to, paginationOpts })).page.map(x => x._id)).toEqual([active]);
  expect((await owner.query(api.upcoming.list, { householdId, kind: "coverage", from, to, includeCancelled: true, paginationOpts })).page).toHaveLength(2);
});

test("local date resolution rejects gaps and exposes both repeated instants and fractional offsets", async () => {
  const { owner, outsider, householdId } = await setup();
  const input = { householdId, timezone: "America/New_York", date: "2026-03-08", time: "02:30" };
  expect(await owner.query(api.dates.resolveLocal, input)).toEqual({ kind: "gap", choices: [] });
  const repeated = await owner.query(api.dates.resolveLocal, { ...input, date: "2026-11-01", time: "01:30" });
  expect(repeated.kind).toBe("ambiguous"); expect(repeated.choices[1].epochMilliseconds - repeated.choices[0].epochMilliseconds).toBe(3600000);
  const chosen = await owner.query(api.dates.resolveLocal, { ...input, date: "2026-11-01", time: "01:30", choice: "later" });
  expect(chosen.choices).toEqual([repeated.choices[1]]);
  const kathmandu = await owner.query(api.dates.resolveLocal, { ...input, timezone: "Asia/Kathmandu" });
  expect(kathmandu.choices[0].offset).toBe("+05:45");
  await expect(outsider.query(api.dates.resolveLocal, input)).rejects.toThrow("unavailable");
  await expect(owner.query(api.dates.resolveLocal, { ...input, date: "2026-02-30" })).rejects.toThrow("valid local date");
});

test("contact permission edits require current version; stale editor cannot unblock a contact", async () => {
  const s = await setup(); const { owner, recipient, householdId } = s;
  await expect(recipient.query(api.contacts.list,{householdId,state:"approved",paginationOpts})).rejects.toThrow("CARE_ACCESS_REQUIRED");
  await grantRecipientCare(s);
  const input = { householdId, email: "office@example.test", label: "Office", relationship: "Synthetic", allowSend: true, allowReceive: true, allowReply: true, state: "approved" as const };
  await owner.mutation(api.contacts.set, input);
  await recipient.mutation(api.contacts.set, { ...input, expectedVersion: 1, state: "blocked" });
  await expect(owner.mutation(api.contacts.set, { ...input, expectedVersion: 1 })).rejects.toThrow("changed");
  await expect(owner.mutation(api.contacts.set, input)).rejects.toThrow("Reload");
  expect((await owner.query(api.contacts.list, { householdId, state: "blocked", paginationOpts })).page[0].version).toBe(2);
});

test("saved handovers include unchanged visit and linked question context, then preserve personal baseline after receipt removal", async () => {
  const s = await setup(); const { t, owner, recipient, outsider, householdId, ids, taskId } = s;
  await grantRecipientCare(s);
  const visitId = await owner.mutation(api.visits.create, { householdId, title: "Visit context", confirmedStartsAt: Date.now() + 86400000, timezone: "America/New_York", confirmedAddress: "Synthetic location", phone: "", note: "", checklist: [], requestId: "visit" });
  const threadId = await t.run(ctx => ctx.db.insert("mailThreads", { householdId, inboxId: "test", providerThreadId: "test", related: { kind: "visit", id: visitId }, subject: "Which entrance?", state: "waiting", archived: false, quarantined: false, deleting: false, lastMessageAt: Date.now(), version: 1 }));
  const handoverId = await owner.mutation(api.handovers.prepare, { householdId, recipientId: ids.recipient, proposedTaskIds: [taskId], introduction: "", note: "", requestId: "handover" });
  const snapshot = await recipient.query(api.handovers.get, { handoverId });
  expect(snapshot.contextCaptured).toBe(true); expect(snapshot.context).toHaveLength(2);
  expect(snapshot.context.map(x => x.snapshot.kind).sort()).toEqual(["thread", "visit"]);
  expect((await owner.query(api.handovers.list, { householdId, status: "draft", direction: "outgoing", paginationOpts })).page[0]._id).toBe(handoverId);
  await expect(outsider.query(api.handovers.list, { householdId, status: "draft", direction: "all", paginationOpts })).rejects.toThrow("unavailable");
  await owner.mutation(api.handovers.publish, { handoverId, expectedVersion: 1 });
  const receiptId = await recipient.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [taskId], takeCoverage: false });
  await t.run(ctx => ctx.db.delete(receiptId));
  await owner.mutation(api.threads.update, { threadId, expectedVersion: 1, operation: "resolve" });
  const changes = await recipient.query(api.history.sinceAcceptance, { householdId, paginationOpts });
  expect(changes.baselineAt).not.toBeNull(); expect(changes.result.page.map(x => x.type)).toEqual(["thread.resolve"]);
  const historical = await recipient.query(api.handovers.get, { handoverId });
  expect(historical.context.find(x => x.snapshot.kind === "thread")?.snapshot).toMatchObject({ state: "waiting" });
});

test("privacy receipts survive deletion, remain requester-only and hide inaccessible exports", async () => {
  const { t, owner, recipient, householdId, ids } = await setup();
  await t.run(async ctx => {
    for (const kind of ["delete", "export"] as const) await ctx.db.insert("privacyJobs", { householdId, requestedBy: ids.owner, kind, state: "succeeded", stage: "done", processors: [], requestedAt: Date.now(), expiresAt: Date.now() + 86400000 });
    await ctx.db.patch(householdId, { status: "deleted" });
  });
  expect((await owner.query(api.privacyJobs.listMine, { paginationOpts })).page.map(x => x.kind)).toEqual(["delete"]);
  expect((await recipient.query(api.privacyJobs.listMine, { paginationOpts })).page).toHaveLength(0);
});

test("former-member recovery includes assignments and committed coverage", async () => {
  const { owner, householdId, ids, membershipId, t } = await setup();
  await owner.mutation(api.tasks.create, { householdId, title: "Requested", category: "errand", dueAt: null, requestedOwnerId: ids.recipient, note: "", requestId: "request" });
  const coverageId = await owner.mutation(api.coverage.create, { householdId, startsAt: Date.now(), endsAt: Date.now() + 3600000, volunteer: true, note: "", requestId: "coverage" });
  await t.run(ctx => ctx.db.patch(coverageId, { plannedOwnerId: ids.recipient }));
  await owner.mutation(api.team.remove, { householdId, memberId: membershipId });
  expect((await owner.query(api.team.requestedResponsibilities, { householdId, memberId: membershipId, paginationOpts })).page).toHaveLength(1);
  expect((await owner.query(api.team.coverage, { householdId, memberId: membershipId, state: "committed", paginationOpts })).page[0]._id).toBe(coverageId);
});

test("drafts and uncertain sends survive reload lists without exposing operation secrets", async () => {
  const { owner, householdId, t, ids, outsider } = await setup();
  const draftId = await t.run(ctx => ctx.db.insert("mailDrafts", { householdId, related: null, recipient: "office@example.test", subject: "Question", body: "Body", sourceRefs: [], version: 1, contentHash: "hash", editorId: ids.owner, state: "sending", updatedAt: 1, syncToken: "private-lock", providerDraftId: "private-provider" }));
  await t.run(ctx => ctx.db.insert("sendIntents", { householdId, draftId, draftVersion: 1, contentHash: "hash", logicalSendId: "private-logical", idempotencyKey: "private-idempotency", approvedBy: ids.owner, recipient: "office@example.test", subject: "Question", body: "Body", providerDraftId: "private-provider", consentVersion: 1, state: "unknown", delivery: "unknown", attempts: 1, createdAt: 1, reconciliation: "required" }));
  const drafts = await owner.query(api.drafts.list, { householdId, state: "sending", paginationOpts });
  expect(drafts.page[0]).toMatchObject({ _id: draftId, syncing: true }); expect(drafts.page[0]).not.toHaveProperty("syncToken");
  const sends = await owner.query(api.sendIntents.forDraft, { draftId, paginationOpts });
  expect(sends.page[0].state).toBe("unknown"); expect(sends.page[0]).not.toHaveProperty("idempotencyKey");
  await expect(outsider.query(api.sendIntents.forDraft, { draftId, paginationOpts })).rejects.toThrow("unavailable");
});

test("publication and acceptance reject missing saved visit context without changing ownership", async () => {
  const { t, owner, recipient, householdId, ids, taskId } = await setup();
  await owner.mutation(api.visits.create, { householdId, title: "Required context", confirmedStartsAt: Date.now() + 86400000, timezone: "UTC", confirmedAddress: "Synthetic", phone: "", note: "", checklist: [], requestId: "integrity-visit" });
  const handoverId = await owner.mutation(api.handovers.prepare, { householdId, recipientId: ids.recipient, proposedTaskIds: [taskId], introduction: "", note: "", requestId: "integrity-handover" });
  const context = (await owner.query(api.handovers.get, { handoverId })).context[0];
  await t.run(ctx => ctx.db.delete(context._id));
  await expect(owner.mutation(api.handovers.publish, { handoverId, expectedVersion: 1 })).rejects.toThrow("incomplete");
  expect((await t.run(ctx => ctx.db.get(handoverId)))?.status).toBe("draft");
  // Simulate a previously published row whose context is lost before acceptance.
  await t.run(ctx => ctx.db.patch(handoverId, { status: "pending", version: 2 }));
  await expect(recipient.mutation(api.handovers.acceptHandover, { handoverId, expectedVersion: 2, acceptedTaskIds: [taskId], takeCoverage: false })).rejects.toThrow("incomplete");
  expect((await t.run(ctx => ctx.db.get(taskId)))?.ownerId).toBeNull();
  expect(await t.run(ctx => ctx.db.query("handoverReceipts").withIndex("by_handoverId", q => q.eq("handoverId", handoverId)).first())).toBeNull();
});

test("Today finds personal incoming and outgoing handovers before applying preview limits",async()=>{
 const {t,owner,recipient,ids,householdId}=await setup();
 const incoming=await t.run(async ctx=>{
  const base={householdId,mailContextRestricted:false,senderId:ids.owner,recipientId:ids.recipient,baseMaterialRevision:0,lastReceiptId:null,introduction:'',note:'',coverage:null,status:'pending' as const,version:2,snapshotItemCount:0,snapshotChangeCount:0,snapshotProposalCount:0,createdAt:1,updatedAt:1};
  const first=await ctx.db.insert('handovers',base);
  // Newer outgoing records previously crowded this person's incoming row out.
  for(let i=0;i<30;i++)await ctx.db.insert('handovers',{...base,senderId:ids.recipient,recipientId:ids.owner});
  return first;
 });
 const args={householdId,now:Date.parse('2026-09-20T12:00Z'),dayEnd:Date.parse('2026-09-21T03:59:59.999Z'),mine:false};
 const mine=await recipient.query(api.today.get,args);
 expect(mine.handovers.map(h=>h._id)).toEqual([incoming]);expect(mine.more.handovers).toBe(false);
 expect(mine.outgoingHandovers).toHaveLength(20);expect(mine.more.outgoingHandovers).toBe(true);
 expect(mine.outgoingHandovers.every(h=>h.senderId===ids.recipient)).toBe(true);
 const theirs=await owner.query(api.today.get,args);
 expect(theirs.handovers).toHaveLength(20);expect(theirs.more.handovers).toBe(true);
 expect(theirs.outgoingHandovers.map(h=>h._id)).toEqual([incoming]);
});

test("conversation message and draft pages retain all records beyond former preview limits and enforce membership",async()=>{
 const {t,owner,outsider,householdId,ids}=await setup();
 const threadId=await t.run(async ctx=>{
  const threadId=await ctx.db.insert('mailThreads',{householdId,inboxId:'unit',providerThreadId:'paged',related:null,subject:'Pagination',state:'new',archived:false,quarantined:false,deleting:false,lastMessageAt:61,version:1});
  for(let i=0;i<61;i++){
   await ctx.db.insert('mailMessages',{householdId,threadId,inboxId:'unit',providerMessageId:`m-${i}`,direction:'inbound',from:'sender@example.test',to:['household@example.test'],plaintext:`Message ${i}`,subject:'Pagination',occurredAt:i,delivery:'unknown',attachmentOnly:false,truncated:false,retentionUntil:4102444800000,unresolvedReferences:1});
   await ctx.db.insert('mailDrafts',{householdId,threadId,related:null,recipient:'recipient@example.test',subject:`Draft ${i}`,body:'Test',sourceRefs:[],version:1,contentHash:'test',editorId:ids.owner,state:i<30?'deleted':'editable',updatedAt:i});
  }
  return threadId;
 });
 const messages:number[]=[];let cursor:string|null=null;
 do {const page:PaginationResult<Doc<'mailMessages'>>=await owner.query(api.threads.recentMessages,{threadId,paginationOpts:{numItems:25,cursor}});messages.push(...page.page.map(m=>m.occurredAt));cursor=page.isDone?null:page.continueCursor;}while(cursor);
 expect(messages).toEqual(Array.from({length:61},(_,i)=>60-i));
 const drafts=new Set<string>();cursor=null;
 do {const page:PaginationResult<Doc<'mailDrafts'>>=await owner.query(api.drafts.forThreadPage,{threadId,paginationOpts:{numItems:7,cursor}});page.page.forEach(d=>{expect(d.state).not.toBe('deleted');drafts.add(d._id);});cursor=page.isDone?null:page.continueCursor;}while(cursor);
 expect(drafts.size).toBe(31);
 await expect(outsider.query(api.threads.recentMessages,{threadId,paginationOpts})).rejects.toThrow('unavailable');
 await expect(outsider.query(api.drafts.forThreadPage,{threadId,paginationOpts})).rejects.toThrow('unavailable');
 await t.run(ctx=>ctx.db.patch(threadId,{deleting:true}));
 await expect(owner.query(api.threads.recentMessages,{threadId,paginationOpts})).rejects.toThrow('unavailable');
 await expect(owner.query(api.drafts.forThreadPage,{threadId,paginationOpts})).rejects.toThrow('unavailable');
});

test("archived inbox includes quarantined conversations without exposing deleted threads",async()=>{
 const {t,owner,householdId}=await setup();
 await t.run(async ctx=>{
  for(let i=0;i<35;i++)await ctx.db.insert('mailThreads',{householdId,inboxId:'unit',providerThreadId:`archived-${i}`,related:null,subject:`Archived ${i}`,state:'new',archived:true,quarantined:i%2===0,deleting:i===0,lastMessageAt:i,version:1});
 });
 let cursor:string|null=null;const found:Doc<'mailThreads'>[]=[];
 do {const page:PaginationResult<Doc<'mailThreads'>>=await owner.query(api.inbox.list,{householdId,filter:'archived',paginationOpts:{numItems:9,cursor}});found.push(...page.page);cursor=page.isDone?null:page.continueCursor;}while(cursor);
 expect(found).toHaveLength(34);expect(found.some(row=>row.quarantined)).toBe(true);expect(found.some(row=>!row.quarantined)).toBe(true);expect(found.some(row=>row.deleting)).toBe(false);
 expect(found.map(row=>row.lastMessageAt)).toEqual(Array.from({length:34},(_,i)=>34-i));
});


test("UI fixtures reject production and real households, replay safely, and clean only their own records",async()=>{
 const {t,householdId}=await setup();
 try{
  vi.stubEnv('CONVEX_SITE_URL','https://admired-fish-176.convex.site');
  await expect(t.mutation(internal.uiFixtures.inbox,{householdId})).rejects.toThrow('development-only');
  await expect(t.mutation(internal.uiFixtures.formerWork,{householdId})).rejects.toThrow('development-only');
  vi.stubEnv('CONVEX_SITE_URL','https://befitting-cobra-234.convex.site');
  await expect(t.mutation(internal.uiFixtures.inbox,{householdId})).rejects.toThrow('synthetic household');
  await expect(t.mutation(internal.uiFixtures.formerWork,{householdId})).rejects.toThrow('synthetic household');
  await t.run(ctx=>ctx.db.patch(householdId,{mode:'demo',expiresAt:Date.now()+86400000}));
  const former=await t.mutation(internal.uiFixtures.formerWork,{householdId});
  expect(await t.mutation(internal.uiFixtures.formerWork,{householdId})).toBe(former);
  expect(await t.mutation(internal.uiFixtures.cleanupFormerWork,{householdId})).toBe(3);
  expect(await t.run(ctx=>ctx.db.get(former))).toBeNull();
  expect(await t.mutation(internal.uiFixtures.cleanupFormerWork,{householdId})).toBe(0);
  const first=await t.mutation(internal.uiFixtures.inbox,{householdId});expect(first).toHaveLength(32);
  expect(await t.mutation(internal.uiFixtures.inbox,{householdId})).toEqual(first);
  const reply=await t.mutation(internal.uiFixtures.reply,{threadId:first[0],requestId:'once'});
  expect(await t.mutation(internal.uiFixtures.reply,{threadId:first[0],requestId:'once'})).toBe(reply);
  const untouched=await t.run(ctx=>ctx.db.insert('mailThreads',{householdId,inboxId:'other-inbox',providerThreadId:'other',related:null,subject:'Preserve',state:'new',archived:false,quarantined:false,deleting:false,lastMessageAt:1,version:1}));
  expect(await t.mutation(internal.uiFixtures.cleanup,{householdId})).toEqual({threads:32,messages:64,drafts:31});
  expect(await t.run(ctx=>ctx.db.get(untouched))).not.toBeNull();
  expect(await t.mutation(internal.uiFixtures.cleanup,{householdId})).toEqual({threads:0,messages:0,drafts:0});
 }finally{vi.unstubAllEnvs();}
});

test("former-owner work is filtered before pagination across statuses/dates and rejects active or foreign memberships",async()=>{
 const {t,owner,recipient,outsider,ids,householdId,membershipId}=await setup();
 await t.run(async ctx=>{
  const base={householdId,category:"logistics" as const,ownerId:ids.owner,requestedOwnerId:null,status:"open" as const,note:"",sourceRefs:[],version:1,createdBy:ids.owner,updatedAt:1};
  for(let i=0;i<80;i++)await ctx.db.insert("tasks",{...base,title:"Unrelated",dueAt:null});
  for(let i=0;i<61;i++)await ctx.db.insert("tasks",{...base,title:`Former task ${i}`,ownerId:ids.recipient,dueAt:null});
  for(const status of ["done","cancelled"] as const)await ctx.db.insert("tasks",{...base,title:status,ownerId:ids.recipient,status,dueAt:100});
 });
 await owner.mutation(api.team.remove,{householdId,memberId:membershipId});
 const args={householdId,ownership:"former" as const,formerMemberId:membershipId,status:"open" as const,due:"undated" as const};
 const found=new Set();let cursor:string|null=null;
 do{const page:PaginationResult<Doc<"tasks">>=await owner.query(api.tasks.list,{...args,paginationOpts:{numItems:25,cursor}});page.page.forEach(row=>{expect(row.ownerId).toBe(ids.recipient);found.add(row._id);});cursor=page.isDone?null:page.continueCursor;}while(cursor);
 expect(found.size).toBe(61);
 for(const status of ["done","cancelled"] as const)expect((await owner.query(api.tasks.list,{...args,status,due:"range",from:0,to:1000,paginationOpts})).page.map(row=>row.title)).toEqual([status]);
 await expect(recipient.query(api.tasks.list,{...args,paginationOpts})).rejects.toThrow("unavailable");
 await expect(outsider.query(api.formerWork.get,{householdId,memberId:membershipId})).rejects.toThrow("unavailable");
 expect(await owner.query(api.formerWork.get,{householdId,memberId:membershipId})).toMatchObject({userId:ids.recipient,status:"removed"});
 await t.run(ctx=>ctx.db.patch(membershipId,{status:"active"}));
 await expect(owner.query(api.tasks.list,{...args,paginationOpts})).rejects.toThrow("former member is unavailable");
 const foreignHousehold=await outsider.mutation(api.households.create,{nickname:"Other household",timezone:"UTC",firstTask:"Other task",adultConfirmed:true,authorityStatement:"Synthetic test",noticeVersion:"test",emailImport:false,aiProcessing:false,requestId:"other-household"});
 const foreign=await t.run(ctx=>ctx.db.insert("memberships",{householdId:foreignHousehold,userId:ids.outsider,role:"member",status:"left",joinedAt:1,emailNotifications:false,lastReadSequence:0}));
 await expect(owner.query(api.tasks.list,{...args,formerMemberId:foreign,paginationOpts})).rejects.toThrow("former member is unavailable");
});

test("former-member picker returns every page with a safe household-scoped name projection",async()=>{
 const {t,owner,recipient,householdId}=await setup();
 await t.run(async ctx=>{for(let i=0;i<31;i++){const userId=await ctx.db.insert("users",{email:`private-${i}@example.test`,name:`Former ${i}`});await ctx.db.insert("memberships",{householdId,userId,role:"member",status:"left",joinedAt:1,endedAt:i+1,emailNotifications:true,lastReadSequence:700});}});
 const found=[];let cursor:string|null=null;
 do{const page:FunctionReturnType<typeof api.formerWork.list>=await recipient.query(api.formerWork.list,{householdId,status:"left",paginationOpts:{numItems:25,cursor}});found.push(...page.page);cursor=page.isDone?null:page.continueCursor;}while(cursor);
 expect(found).toHaveLength(31);expect(new Set(found.map(row=>row._id)).size).toBe(31);
 for(const row of found){expect(Object.keys(row).sort()).toEqual(["_id","displayName","endedAt","status","userId"]);expect(row.displayName).toMatch(/^Former /);}
 expect((await owner.query(api.formerWork.list,{householdId,status:"removed",paginationOpts})).page).toHaveLength(0);
});

test("handover coverage options include all unexpired own/unassigned plans and exclude another member's commitments",async()=>{
 const {t,owner,recipient,outsider,ids,householdId}=await setup(),now=Date.now();
 await t.run(async ctx=>{
  const base={householdId,startsAt:now,endsAt:now+3600000,activeOwnerId:null,version:1,note:"Synthetic coverage",createdBy:ids.owner,updatedAt:now};
  for(let i=0;i<70;i++)await ctx.db.insert("coverage",{...base,state:"committed",plannedOwnerId:ids.recipient});
  for(let i=0;i<31;i++)await ctx.db.insert("coverage",{...base,state:"committed",plannedOwnerId:ids.owner});
  await ctx.db.insert("coverage",{...base,state:"planned",plannedOwnerId:null});
  await ctx.db.insert("coverage",{...base,state:"committed",plannedOwnerId:ids.owner,endsAt:now});
  await ctx.db.insert("coverage",{...base,state:"cancelled",plannedOwnerId:ids.owner});
 });
 const found=new Set();let cursor:string|null=null;
 do{const page:PaginationResult<Doc<"coverage">>=await owner.query(api.coverage.handoverOptions,{householdId,state:"committed",now,paginationOpts:{numItems:25,cursor}});page.page.forEach(row=>{expect(row.plannedOwnerId).toBe(ids.owner);found.add(row._id);});cursor=page.isDone?null:page.continueCursor;}while(cursor);
 expect(found.size).toBe(31);
 expect((await recipient.query(api.coverage.handoverOptions,{householdId,state:"planned",now,paginationOpts})).page).toHaveLength(1);
 await expect(outsider.query(api.coverage.handoverOptions,{householdId,state:"planned",now,paginationOpts})).rejects.toThrow("unavailable");
 await expect(owner.query(api.coverage.handoverOptions,{householdId,state:"planned",now:Infinity,paginationOpts})).rejects.toThrow();
});

test("planned coverage remains unchanged through preparation/publication and acknowledgment, then transfers only on explicit acceptance",async()=>{
 const {owner,recipient,householdId,ids}=await setup(),now=Date.now();
 const block=await owner.mutation(api.coverage.create,{householdId,startsAt:now+3600000,endsAt:now+7200000,volunteer:true,note:"Synthetic future coverage",requestId:"planned-offer"});
 const input={householdId,recipientId:ids.recipient,proposedTaskIds:[],coverageId:block,introduction:"",note:"",requestId:"offer"};
 const first=await owner.mutation(api.handovers.prepare,input);await owner.mutation(api.handovers.publish,{handoverId:first,expectedVersion:1});
 expect((await owner.query(api.coverage.get,{coverageId:block}))).toMatchObject({state:"committed",plannedOwnerId:ids.owner,activeOwnerId:null});
 await recipient.mutation(api.handovers.acceptHandover,{handoverId:first,expectedVersion:2,acceptedTaskIds:[],takeCoverage:false});
 expect((await owner.query(api.coverage.get,{coverageId:block}))).toMatchObject({state:"committed",plannedOwnerId:ids.owner,activeOwnerId:null});
 const second=await owner.mutation(api.handovers.prepare,{...input,requestId:"second-offer"});await owner.mutation(api.handovers.publish,{handoverId:second,expectedVersion:1});
 const receipt=await recipient.mutation(api.handovers.acceptHandover,{handoverId:second,expectedVersion:2,acceptedTaskIds:[],takeCoverage:true});
 expect(await recipient.mutation(api.handovers.acceptHandover,{handoverId:second,expectedVersion:2,acceptedTaskIds:[],takeCoverage:true})).toBe(receipt);
 expect((await owner.query(api.coverage.get,{coverageId:block}))).toMatchObject({state:"active",plannedOwnerId:ids.recipient,activeOwnerId:ids.recipient});
});

test("coverage cannot be offered on another member's behalf or accepted after another commitment wins",async()=>{
 const {owner,recipient,householdId,ids}=await setup(),now=Date.now();
 const other=await recipient.mutation(api.coverage.create,{householdId,startsAt:now,endsAt:now+3600000,volunteer:true,note:"",requestId:"other"});
 const input={householdId,recipientId:ids.recipient,proposedTaskIds:[],coverageId:other,introduction:"",note:"",requestId:"offer"};
 await expect(owner.mutation(api.handovers.prepare,input)).rejects.toThrow("own or unassigned");
 const expired=await owner.mutation(api.coverage.create,{householdId,startsAt:now-7200000,endsAt:now-3600000,volunteer:false,note:"",requestId:"expired"});
 await expect(owner.mutation(api.handovers.prepare,{...input,coverageId:expired})).rejects.toThrow("Update the coverage end");
 const unassigned=await owner.mutation(api.coverage.create,{householdId,startsAt:now,endsAt:now+3600000,volunteer:false,note:"",requestId:"unassigned"});
 const handoverId=await owner.mutation(api.handovers.prepare,{...input,coverageId:unassigned});await owner.mutation(api.handovers.publish,{handoverId,expectedVersion:1});
 await recipient.mutation(api.coverage.transition,{coverageId:unassigned,expectedVersion:1,operation:"volunteer"});
 await expect(recipient.mutation(api.handovers.acceptHandover,{handoverId,expectedVersion:2,acceptedTaskIds:[],takeCoverage:true})).rejects.toThrow("Information changed");
 const refreshed=await owner.mutation(api.handovers.refresh,{handoverId,expectedVersion:2,requestId:"refresh"});
 expect((await owner.query(api.handovers.get,{handoverId:refreshed})).handover.coverage).toBeNull();
});

test("history categories paginate all matches across unrelated events and retain native page boundaries", async () => {
  const {t,owner,outsider,householdId,taskId}=await setup();const from=Date.parse("2026-01-01T00:00Z"),to=from+86400000;
  await t.run(async ctx=>{
    const base={householdId,actorId:null,before:"",after:"Synthetic history",sourceRefs:[],retentionUntil:to+86400000};
    for(let i=0;i<70;i++)await ctx.db.insert("events",{...base,sequence:i+100,type:"household.renamed",entity:{kind:"household",id:householdId},timestamp:from+i});
    for(let i=0;i<61;i++)await ctx.db.insert("events",{...base,sequence:i+200,type:i%2?"task.created":"task.edited",entity:{kind:"task",id:taskId},timestamp:from+i});
    for(const timestamp of [from-1,to+1])await ctx.db.insert("events",{...base,sequence:300+timestamp,type:"task.created",entity:{kind:"task",id:taskId},timestamp});
  });
  const args={householdId,from,to,kind:"task" as const};const ids=new Set();let cursor:string|null=null;
  do{
    const result:FunctionReturnType<typeof api.history.list>=await owner.query(api.history.list,{...args,paginationOpts:{numItems:17,cursor}});
    result.page.forEach(row=>{expect(row.entity.kind).toBe("task");expect(row.targetAvailable).toBe(true);expect(ids.has(row._id)).toBe(false);ids.add(row._id);});cursor=result.isDone?null:result.continueCursor;
  }while(cursor);
  expect(ids.size).toBe(61);
  const first=await owner.query(api.history.list,{...args,paginationOpts:{numItems:17,cursor:null}});
  const bounded=await owner.query(api.history.list,{...args,paginationOpts:{numItems:100,cursor:null,endCursor:first.continueCursor,id:7}});
  expect(bounded.page.map(x=>x._id)).toEqual(first.page.map(x=>x._id));
  const intersection=await owner.query(api.history.list,{...args,type:"task.edited",paginationOpts:{numItems:100,cursor:null}});
  expect(intersection.page).toHaveLength(31);
  const exact=await owner.query(api.history.list,{householdId,from,to,type:"household.renamed",paginationOpts:{numItems:100,cursor:null}});expect(exact.page).toHaveLength(70);
  await expect(outsider.query(api.history.list,{...args,paginationOpts})).rejects.toThrow("unavailable");
  await expect(owner.query(api.history.list,{...args,to:from,paginationOpts})).rejects.toThrow("range");
});

test("category history after acceptance uses sequence boundaries even for coincident timestamps",async()=>{
  const {t,owner,recipient,outsider,householdId,membershipId,taskId}=await setup();const at=Date.now();
  await t.run(async ctx=>{
    await ctx.db.patch(membershipId,{lastAcceptedAt:at,lastAcceptedSequence:100});
    await ctx.db.patch(householdId,{eventSequence:162});
    for(let sequence=99;sequence<=162;sequence++)await ctx.db.insert("events",{householdId,actorId:null,sequence,type:sequence%2?"task.edited":"household.renamed",entity:sequence%2?{kind:"task",id:taskId}:{kind:"household",id:householdId},before:"",after:"Synthetic change",sourceRefs:[],timestamp:at,retentionUntil:at+86400000});
  });
  const sequences:number[]=[];let cursor:string|null=null;
  do{
    const value:FunctionReturnType<typeof api.history.sinceAcceptance>=await recipient.query(api.history.sinceAcceptance,{householdId,kind:"task",paginationOpts:{numItems:7,cursor}});
    expect(value.baselineAt).toBe(at);sequences.push(...value.result.page.map(x=>x.sequence));cursor=value.result.isDone?null:value.result.continueCursor;
  }while(cursor);
  expect(sequences).toEqual(Array.from({length:31},(_,i)=>161-i*2));
  expect((await owner.query(api.history.sinceAcceptance,{householdId,kind:"task",paginationOpts})).baselineAt).toBeNull();
  await expect(outsider.query(api.history.sinceAcceptance,{householdId,paginationOpts})).rejects.toThrow("unavailable");
});

test("history links react to removed targets, retired sources and missing accepted receipts",async()=>{
  const {t,owner,householdId,taskId,ids}=await setup();const from=Date.now()-1000,to=from+86400000;
  const linked=await t.run(async ctx=>{
    const sourceId=await ctx.db.insert("sources",{householdId,kind:"manual",contentHash:"synthetic",plaintext:"Synthetic quote",capturedAt:from,publishedAt:null,retentionUntil:to,extractionState:"ready",warnings:[],truncated:false,unresolvedReferences:0,version:1});
    const handoverId=await ctx.db.insert("handovers",{householdId,senderId:ids.owner,recipientId:ids.recipient,baseMaterialRevision:1,lastReceiptId:null,introduction:"",note:"",coverage:null,status:"accepted",version:1,snapshotItemCount:0,snapshotChangeCount:0,snapshotProposalCount:0,createdAt:from,updatedAt:from});
    const receiptId=await ctx.db.insert("handoverReceipts",{householdId,handoverId,senderId:ids.owner,recipientId:ids.recipient,acceptedAt:from,receiptRevision:1,eventSequence:1,tookCoverage:false,transferredTaskIds:[],retainedTaskIds:[],unassignedTaskIds:[],retentionUntil:to});
    const ref={sourceId,quote:"Synthetic",start:0,end:9};
    const eventId=await ctx.db.insert("events",{householdId,actorId:null,sequence:100,type:"task.handoverAccepted",entity:{kind:"task",id:taskId},before:"",after:"Synthetic",sourceRefs:[ref,ref],timestamp:from+1,retentionUntil:to,handoverId});
    return {eventId,sourceId,handoverId,receiptId};
  });
  const get=async()=>(await owner.query(api.history.list,{householdId,from,to,type:"task.handoverAccepted",paginationOpts})).page[0];
  expect(await get()).toMatchObject({targetAvailable:true,receiptAvailable:true,sourceLinks:[{sourceId:linked.sourceId,available:true}]});
  await t.run(async ctx=>{await ctx.db.delete(taskId);await ctx.db.patch(linked.sourceId,{retiring:true});await ctx.db.delete(linked.receiptId);});
  expect(await get()).toMatchObject({targetAvailable:false,receiptAvailable:false,sourceLinks:[{sourceId:linked.sourceId,available:false}]});
  await t.run(ctx=>ctx.db.delete(linked.sourceId));expect((await get()).sourceLinks[0].available).toBe(false);
});

test("personal history cursors survive new events and an acceptance change starts a distinct range",async()=>{
  const {t,recipient,outsider,householdId,membershipId,taskId}=await setup();const now=Date.now();
  await t.run(async ctx=>{
    await ctx.db.patch(membershipId,{lastAcceptedSequence:100,lastAcceptedAt:now});await ctx.db.patch(householdId,{eventSequence:130});
    for(let sequence=101;sequence<=130;sequence++)await ctx.db.insert("events",{householdId,sequence,actorId:null,type:"task.edited",entity:{kind:"task",id:taskId},before:"",after:"Synthetic",sourceRefs:[],timestamp:now,retentionUntil:now+86400000});
  });
  expect(await recipient.query(api.history.acceptanceBaseline,{householdId})).toEqual({sequence:100,at:now});
  const args={householdId,kind:"task" as const,afterSequence:100};
  const first=await recipient.query(api.history.sinceAcceptance,{...args,paginationOpts});
  await t.run(async ctx=>{await ctx.db.patch(householdId,{eventSequence:131});await ctx.db.insert("events",{householdId,sequence:131,actorId:null,type:"task.edited",entity:{kind:"task",id:taskId},before:"",after:"Later update",sourceRefs:[],timestamp:now+1,retentionUntil:now+86400000});});
  const next=await recipient.query(api.history.sinceAcceptance,{...args,paginationOpts:{numItems:25,cursor:first.result.continueCursor}});
  expect(next.result.page.map(e=>e.sequence)).toEqual([105,104,103,102,101]);
  expect((await recipient.query(api.history.sinceAcceptance,{...args,paginationOpts})).result.page[0].sequence).toBe(131);
  await t.run(ctx=>ctx.db.patch(membershipId,{lastAcceptedSequence:130,lastAcceptedAt:now+1}));
  expect(await recipient.query(api.history.acceptanceBaseline,{householdId})).toEqual({sequence:130,at:now+1});
  const oldRange=await recipient.query(api.history.sinceAcceptance,{...args,paginationOpts:{numItems:25,cursor:first.result.continueCursor}});
  expect(oldRange.result.page.map(e=>e.sequence)).toEqual([105,104,103,102,101]);expect(oldRange.baselineAt).toBeNull();
  const fresh=await recipient.query(api.history.sinceAcceptance,{...args,afterSequence:130,paginationOpts});expect(fresh.result.page.map(e=>e.sequence)).toEqual([131]);expect(fresh.baselineAt).toBe(now+1);
  await expect(recipient.query(api.history.sinceAcceptance,{...args,afterSequence:-1,paginationOpts})).rejects.toThrow("starting point");
  await expect(outsider.query(api.history.acceptanceBaseline,{householdId})).rejects.toThrow("unavailable");
});

async function sourceFixture(s: Awaited<ReturnType<typeof setup>>) {
  return s.t.run(async ctx=>{
    const sourceId=await ctx.db.insert("sources",{householdId:s.householdId,kind:"manual",contentHash:"source-review-fixture",plaintext:"Use the west entrance.",capturedAt:1,publishedAt:null,retentionUntil:Date.now()+86400000,extractionState:"ready",warnings:[],truncated:false,unresolvedReferences:1,version:1});
    const proposalId=await ctx.db.insert("proposals",{householdId:s.householdId,sourceId,target:{kind:"task",id:s.taskId},targetVersion:1,field:"note",proposedValue:"Use the west entrance.",previousValue:"Old saved note",quote:"Use the west entrance.",quoteStart:0,quoteEnd:22,status:"pending",version:1});
    return {sourceId,proposalId};
  });
}
test("proposal projections show current target values and hide retired evidence",async()=>{
 const s=await setup(),{sourceId,proposalId}=await sourceFixture(s);
 await s.t.run(ctx=>ctx.db.patch(s.taskId,{note:"Current confirmed note",version:2}));
 const item=await s.recipient.query(api.proposals.get,{proposalId});
 expect(item.previousValue).toBe("Old saved note");expect(item.targetInfo).toMatchObject({value:"Current confirmed note",version:2,status:"open"});expect(item.sourceAvailable).toBe(true);
 const page=await s.owner.query(api.proposals.forSource,{sourceId,status:"pending",paginationOpts});expect(page.page[0].targetInfo?.value).toBe("Current confirmed note");
 await s.owner.mutation(api.proposals.review,{proposalId,expectedVersion:1,decision:"dismiss",reason:"Synthetic dismissed suggestion"});
 const dismissed=await s.recipient.query(api.proposals.forSource,{sourceId,status:"dismissed",paginationOpts});expect(dismissed.page[0]).toMatchObject({reviewedBy:s.ids.owner,reason:"Synthetic dismissed suggestion",status:"dismissed"});
 await s.t.run(async ctx=>{await ctx.db.patch(sourceId,{retiring:true});await ctx.db.delete(s.taskId);});
 await expect(s.owner.query(api.proposals.get,{proposalId})).rejects.toThrow("CARE_ACCESS_REQUIRED");
 expect((await s.owner.query(api.proposals.list,{householdId:s.householdId,status:"dismissed",paginationOpts})).page).toHaveLength(0);
 await expect(s.outsider.query(api.proposals.get,{proposalId})).rejects.toThrow("unavailable");
});
test("unmatched suggestions have complete compatible candidate pages including distant visits",async()=>{
 const s=await setup(),{proposalId}=await sourceFixture(s);
 await s.t.run(async ctx=>{
  await ctx.db.patch(proposalId,{target:null,targetVersion:null});
  const base={householdId:s.householdId,title:"Synthetic",category:"logistics" as const,dueAt:null,ownerId:null,requestedOwnerId:null,note:"",sourceRefs:[],version:1,createdBy:s.ids.owner,updatedAt:1};
  for(let i=0;i<61;i++)await ctx.db.insert("tasks",{...base,status:"open",title:`Candidate ${i}`});
  for(let i=0;i<40;i++)await ctx.db.insert("tasks",{...base,status:"done"});
 });
 let cursor:string|null=null;const ids=new Set();
 do{const result:FunctionReturnType<typeof api.proposals.matchCandidates>=await s.recipient.query(api.proposals.matchCandidates,{proposalId,kind:"task" as const,paginationOpts:{numItems:13,cursor}});result.page.forEach(row=>ids.add(row._id));cursor=result.isDone?null:result.continueCursor;}while(cursor);
 expect(ids.size).toBe(62);
 const visitId=await s.owner.mutation(api.visits.create,{householdId:s.householdId,title:"Distant visit",confirmedStartsAt:Date.parse("2099-12-01T00:00Z"),timezone:"UTC",confirmedAddress:"",phone:"",note:"",checklist:[],requestId:"distant-source-candidate"});
 expect((await s.owner.query(api.proposals.matchCandidates,{proposalId,kind:"visit",paginationOpts})).page.map(row=>row._id)).toEqual([visitId]);
 await s.t.run(ctx=>ctx.db.patch(proposalId,{field:"address"}));
 await expect(s.owner.query(api.proposals.matchCandidates,{proposalId,kind:"task",paginationOpts})).rejects.toThrow("compatible");
 await expect(s.outsider.query(api.proposals.matchCandidates,{proposalId,kind:"visit",paginationOpts})).rejects.toThrow("unavailable");
 await s.t.run(ctx=>ctx.db.patch(proposalId,{target:{kind:"visit",id:visitId}}));
 await expect(s.owner.query(api.proposals.matchCandidates,{proposalId,kind:"visit",paginationOpts})).rejects.toThrow("unmatched");
});
test("source view restores extraction state and uses actual retained sender metadata",async()=>{
 const s=await setup(),{sourceId}=await sourceFixture(s),now=Date.now();
 await grantRecipientCare(s);
 const {messageId,threadId,jobId}=await s.t.run(async ctx=>{
  await ctx.db.patch(s.householdId,{aiProcessing:true,emailImport:true});
  const threadId=await ctx.db.insert("mailThreads",{householdId:s.householdId,inboxId:"synthetic",providerThreadId:"synthetic",related:null,subject:"Synthetic",state:"new",archived:false,quarantined:false,deleting:false,lastMessageAt:now,version:1});
  const messageId=await ctx.db.insert("mailMessages",{householdId:s.householdId,threadId,inboxId:"synthetic",providerMessageId:"synthetic",direction:"inbound",from:"actual-sender@example.test",to:[],plaintext:"Forwarded from an unverified author",subject:"Synthetic",sourceId,occurredAt:now,delivery:"unknown",attachmentOnly:false,truncated:false,retentionUntil:now+86400000,unresolvedReferences:1});
  await ctx.db.patch(sourceId,{kind:"email",threadId,plaintext:"Forwarded from an unverified author",extractionState:"processing"});
  const jobId=await ctx.db.insert("jobs",{householdId:s.householdId,operationKey:"synthetic-extraction",kind:"extractLogistics",requestedBy:s.ids.owner,target:{kind:"source",id:sourceId},state:"running",attempts:1,createdAt:now,updatedAt:now,consentVersion:1});
  for(let i=0;i<60;i++)await ctx.db.insert("jobs",{householdId:s.householdId,operationKey:`other-${i}`,kind:"other",requestedBy:null,target:{kind:"source",id:sourceId},state:"succeeded",attempts:1,createdAt:now,updatedAt:now,consentVersion:1});
  return {messageId,threadId,jobId};
 });
 const view=await s.recipient.query(api.sources.view,{sourceId});
 expect(view).toMatchObject({sender:"actual-sender@example.test",receivedAt:now,threadAvailable:true,extractionBlockedReason:null,latestExtraction:{_id:jobId,state:"running"}});
 await s.t.run(async ctx=>{await ctx.db.patch(messageId,{retiring:true});await ctx.db.patch(threadId,{quarantined:true});await ctx.db.patch(jobId,{state:"failed",safeError:"MODEL_HTTP_429"});});
 const failed=await s.recipient.query(api.sources.view,{sourceId});expect(failed.sender).toBeNull();expect(failed.extractionBlockedReason).toMatch(/actual email sender/);expect(failed.latestExtraction?.state).toBe("failed");
 await s.t.run(ctx=>ctx.db.patch(s.householdId,{aiProcessing:false}));expect((await s.owner.query(api.sources.view,{sourceId})).extractionBlockedReason).toMatch(/AI processing is off/);
 await expect(s.outsider.query(api.sources.view,{sourceId})).rejects.toThrow("unavailable");
 await s.t.run(ctx=>ctx.db.patch(sourceId,{retiring:true}));await expect(s.owner.query(api.sources.view,{sourceId})).rejects.toThrow("removed");
});

test("member detail follows ownership, removal and rejoin without exposing another household or account",async()=>{
 const {t,owner,recipient,outsider,ids,householdId,membershipId}=await setup();
 await recipient.mutation(api.team.setDisplayName,{displayName:"Recipient profile"});
 expect(await owner.query(api.team.get,{householdId,memberId:membershipId})).toMatchObject({displayName:"Recipient profile",viewerIsOwner:true,viewerIsSelf:false,membership:{status:"active",role:"member"}});
 expect(await recipient.query(api.team.get,{householdId,memberId:membershipId})).toMatchObject({viewerIsOwner:false,viewerIsSelf:true});
 await expect(outsider.query(api.team.get,{householdId,memberId:membershipId})).rejects.toThrow("unavailable");
 await expect(t.query(api.team.get,{householdId,memberId:membershipId})).rejects.toThrow("Sign in");
 const other=await outsider.mutation(api.households.create,{nickname:"Other",timezone:"UTC",firstTask:"Other task",adultConfirmed:true,authorityStatement:"Synthetic test",noticeVersion:"test",emailImport:false,aiProcessing:false,requestId:"other"});
 await expect(outsider.query(api.team.get,{householdId:other,memberId:membershipId})).rejects.toThrow("unavailable");
 await owner.mutation(api.team.transferOwnership,{householdId,newOwnerId:ids.recipient});
 expect(await owner.query(api.team.get,{householdId,memberId:membershipId})).toMatchObject({viewerIsOwner:false,membership:{role:"owner"}});
 expect(await recipient.query(api.team.get,{householdId,memberId:membershipId})).toMatchObject({viewerIsOwner:true,viewerIsSelf:true});
 await recipient.mutation(api.team.transferOwnership,{householdId,newOwnerId:ids.owner});
 await owner.mutation(api.team.remove,{householdId,memberId:membershipId});
 expect(await owner.query(api.team.get,{householdId,memberId:membershipId})).toMatchObject({displayName:"Recipient profile",membership:{status:"removed"}});
 await expect(recipient.query(api.team.get,{householdId,memberId:membershipId})).rejects.toThrow("unavailable");
 const hash="e".repeat(64);await owner.mutation(internal.inviteStore.create,{householdId,email:"recipient@example.test",tokenHash:hash});
 await recipient.mutation(internal.inviteStore.respond,{tokenHash:hash,accept:true});
 expect(await recipient.query(api.team.get,{householdId,memberId:membershipId})).toMatchObject({viewerIsOwner:false,viewerIsSelf:true,membership:{status:"active",role:"member"}});
});

test("demo member restoration is restricted to development and the existing anonymous second role",async()=>{
 const {t,householdId,ids,membershipId}=await setup();
 try{
  vi.stubEnv('CONVEX_SITE_URL','https://admired-fish-176.convex.site');
  await expect(t.mutation(internal.uiFixtures.restoreDemoSecondRole,{householdId})).rejects.toThrow('development-only');
  vi.stubEnv('CONVEX_SITE_URL','https://befitting-cobra-234.convex.site');
  await expect(t.mutation(internal.uiFixtures.restoreDemoSecondRole,{householdId})).rejects.toThrow('synthetic household');
  await t.run(async ctx=>{
   await ctx.db.patch(householdId,{mode:'demo',expiresAt:Date.now()+86400000});
   await ctx.db.insert('demoSessions',{householdId,creatorId:ids.owner,secondRoleId:ids.recipient,capabilityHash:'test',fixtureVersion:1,expiresAt:Date.now()+86400000});
   await ctx.db.patch(membershipId,{status:'removed',endedAt:Date.now()});
  });
  await expect(t.mutation(internal.uiFixtures.restoreDemoSecondRole,{householdId})).rejects.toThrow('anonymous second role');
  await t.run(ctx=>ctx.db.patch(ids.recipient,{isAnonymous:true,email:undefined,emailVerificationTime:undefined}));
  expect(await t.mutation(internal.uiFixtures.restoreDemoSecondRole,{householdId})).toBe(membershipId);
  expect(await t.run(ctx=>ctx.db.get(membershipId))).toMatchObject({status:'active',role:'member',userId:ids.recipient});
  expect(await t.mutation(internal.uiFixtures.restoreDemoSecondRole,{householdId})).toBe(membershipId);
  await t.run(ctx=>ctx.db.patch(householdId,{ownerId:ids.recipient}));
  await expect(t.mutation(internal.uiFixtures.restoreDemoSecondRole,{householdId})).rejects.toThrow('creator as owner');
 }finally{vi.unstubAllEnvs();}
});

test('draft mailbox status follows only the current version and denies inaccessible drafts',async()=>{
 const {t,owner,outsider,ids,householdId}=await setup();
 const draftId=await t.run(ctx=>ctx.db.insert('mailDrafts',{householdId,related:null,recipient:'fixture@example.test',subject:'Synthetic save status',body:'No provider mail',sourceRefs:[],version:2,contentHash:'fixture',editorId:ids.owner,state:'editable',updatedAt:Date.now(),providerDraftId:'synthetic-provider-id',providerSyncedVersion:1}));
 expect(await owner.query(api.drafts.mailboxStatus,{draftId})).toMatchObject({state:null,ready:false,blocker:'emailPaused'});
 await expect(outsider.query(api.drafts.mailboxStatus,{draftId})).rejects.toThrow();
 await t.run(async ctx=>{
  await ctx.db.patch(householdId,{emailImport:true});
  const account=await ctx.db.query('mailAccounts').withIndex('by_householdId',q=>q.eq('householdId',householdId)).unique();
  await ctx.db.patch(account!._id,{status:'ready',contactSyncState:'ready',inboxId:'synthetic-inbox'});
  await ctx.db.insert('jobs',{householdId,kind:'syncDraft',operationKey:`draft:${draftId}:1`,requestedBy:ids.owner,target:{kind:'household',id:householdId},draftId,state:'succeeded',attempts:1,createdAt:1,updatedAt:1,consentVersion:1});
 });
 expect(await owner.query(api.drafts.mailboxStatus,{draftId})).toMatchObject({state:null,ready:false,blocker:null});
 const jobId=await t.run(ctx=>ctx.db.insert('jobs',{householdId,kind:'syncDraft',operationKey:`draft:${draftId}:2`,requestedBy:ids.owner,target:{kind:'household',id:householdId},draftId,state:'queued',attempts:0,createdAt:2,updatedAt:2,consentVersion:1}));
 expect((await owner.query(api.drafts.mailboxStatus,{draftId})).state).toBe('queued');
 await t.run(ctx=>ctx.db.patch(jobId,{state:'cancelled'}));
 expect((await owner.query(api.drafts.mailboxStatus,{draftId})).state).toBe('cancelled');
 await t.run(ctx=>ctx.db.patch(draftId,{providerSyncedVersion:2}));
 expect((await owner.query(api.drafts.mailboxStatus,{draftId})).ready).toBe(true);
 await t.run(ctx=>ctx.db.patch(draftId,{state:'deleted'}));
 await expect(owner.query(api.drafts.mailboxStatus,{draftId})).rejects.toThrow('Draft unavailable');
});
