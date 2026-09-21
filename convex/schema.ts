import {sourceUseTarget} from "./validators";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { category, taskStatus, coverageState, visitStatus, visitTransport, accessPreset, consentScope, entity, sourceRef, checklistItem, proposalValue, proposalField, handoverState, jobState, delivery, processingState, taskSnapshot, coverageSnapshot } from "./validators";

import { careTables } from "./careSchema";
import { careShareTables } from "./careSharesSchema";
import { recordTables } from "./recordsSchema";
import { placesTables } from "./placesSchema";

const householdId = v.id("households");
const userId = v.id("users");
const nullableUser = v.union(userId, v.null());
const time = v.number();
const version = v.number();

export default defineSchema({
  ...authTables,
  ...recordTables,
  ...careTables,
  ...careShareTables,
  ...placesTables,
  profiles: defineTable({ userId, displayName: v.string(), updatedAt: time }).index("by_userId", ["userId"]),
  households: defineTable({
    ownerId: userId, nickname: v.string(), timezone: v.string(), mode: v.union(v.literal("real"), v.literal("demo")),
    status: v.union(v.literal("active"), v.literal("deleting"), v.literal("deleted")),
    materialRevision: version, evidenceRevision:v.optional(version), eventSequence: v.number(), consentVersion: version,
    currentCoverageId: v.union(v.id("coverage"), v.null()), lastReceiptId: v.union(v.id("handoverReceipts"), v.null()), lastAcceptedSequence:v.optional(v.number()),
    provisioning: processingState, emailImport: v.boolean(), aiProcessing: v.boolean(),
    createdAt: time, updatedAt: time, expiresAt: v.optional(time),
  }).index("by_status_and_expiresAt", ["status", "expiresAt"]).index("by_ownerId", ["ownerId"])
    .index("by_mode_and_status_and_expiresAt", ["mode", "status", "expiresAt"]),
  memberships: defineTable({
    householdId, userId, privacyRevokedAt:v.optional(time), accessPreset:v.optional(accessPreset), role: v.union(v.literal("owner"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("removed"), v.literal("left")),
    lastAcceptedSequence: v.optional(v.number()), lastAcceptedAt: v.optional(time),
    joinedAt: time, endedAt: v.optional(time), emailNotifications: v.boolean(), lastReadSequence: v.number(),
  }).index("by_householdId_and_userId", ["householdId", "userId"])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_householdId_and_status", ["householdId", "status"]).index("by_householdId", ["householdId"]),
  invites: defineTable({
    householdId, accessPreset:v.optional(accessPreset), email: v.string(), tokenHash: v.string(), invitedBy: userId, expiresAt: time,
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("revoked")),
    acceptedBy: v.optional(userId), resolvedAt: v.optional(time),
  }).index("by_tokenHash", ["tokenHash"]).index("by_householdId_and_status", ["householdId", "status"]).index("by_householdId", ["householdId"]),
  consents: defineTable({
    householdId, actorId: userId, scope: consentScope, granted: v.boolean(), noticeVersion: v.string(),
    authorityStatement: v.string(), adultConfirmed: v.boolean(), recordedAt: time,
  }).index("by_householdId_and_scope", ["householdId", "scope"]).index("by_householdId", ["householdId"]),
  taskSeries: defineTable({
    previousSeriesId: v.optional(v.id("taskSeries")), nextSeriesId: v.optional(v.id("taskSeries")),
    householdId, title: v.string(), category, note: v.string(), localTime: v.string(), timezone: v.string(),
    weekdays: v.array(v.number()), activeFrom: v.string(), activeUntil: v.union(v.string(), v.null()),
    proposedOwnerId: nullableUser, status: v.union(v.literal("active"), v.literal("cancelled")), version,
    generatedThrough: v.union(v.string(), v.null()), nextGenerationAt:v.optional(time), suppressedDates: v.optional(v.array(v.string())), createdBy: userId, updatedAt: time,
  }).index("by_householdId_and_status", ["householdId", "status"]).index("by_status_and_generatedThrough", ["status", "generatedThrough"]).index("by_status_and_nextGenerationAt",["status","nextGenerationAt"]).index("by_householdId", ["householdId"]),
  tasks: defineTable({
    householdId, seriesId: v.optional(v.id("taskSeries")), occurrenceKey: v.optional(v.string()),
    occurrenceLocalDate: v.optional(v.string()), dstAdjustment: v.optional(v.string()),
    title: v.string(), category, dueAt: v.union(time, v.null()), ownerId: nullableUser, requestedOwnerId: nullableUser,
    status: taskStatus, note: v.string(), placeId:v.optional(v.union(v.id("places"),v.null())), visitId: v.optional(v.id("visits")), sourceRefs: v.array(sourceRef), version,
    createdBy: userId, updatedAt: time, completedBy: v.optional(userId), completedAt: v.optional(time),
    cancelledAt: v.optional(time), retentionUntil: v.optional(time), seriesException: v.optional(v.boolean()),
  }).index("by_householdId_and_status_and_dueAt", ["householdId", "status", "dueAt"])
    .index("by_householdId_and_ownerId_and_status", ["householdId", "ownerId", "status"])
    .index("by_householdId_and_requestedOwnerId_and_status", ["householdId", "requestedOwnerId", "status"])
    .index("by_householdId_and_ownerId_and_status_and_dueAt", ["householdId", "ownerId", "status", "dueAt"])
    .index("by_householdId_and_requestedOwnerId_and_status_and_dueAt", ["householdId", "requestedOwnerId", "status", "dueAt"])
    .index("by_seriesId_and_occurrenceKey", ["seriesId", "occurrenceKey"])
    .index("by_seriesId_and_occurrenceLocalDate", ["seriesId", "occurrenceLocalDate"]).index("by_status_and_dueAt",["status","dueAt"])
    .index("by_placeId",["placeId"]).index("by_placeId_and_status",["placeId","status"]).index("by_visitId", ["visitId"]).index("by_visitId_and_status",["visitId","status"]).index("by_retentionUntil", ["retentionUntil"]).index("by_householdId", ["householdId"]),
  coverage: defineTable({
    householdId, startsAt: time, endsAt: time, plannedOwnerId: nullableUser, activeOwnerId: nullableUser,
    state: coverageState, actualStart: v.optional(time), actualEnd: v.optional(time), version, note: v.string(),
    createdBy: userId, updatedAt: time, retentionUntil: v.optional(time),
  }).index("by_householdId_and_startsAt", ["householdId", "startsAt"])
    .index("by_householdId_and_plannedOwnerId_and_state", ["householdId", "plannedOwnerId", "state"])
    .index("by_householdId_and_activeOwnerId_and_state", ["householdId", "activeOwnerId", "state"])
    .index("by_householdId_and_plannedOwnerId_and_state_and_endsAt", ["householdId", "plannedOwnerId", "state", "endsAt"])
    .index("by_householdId_and_state", ["householdId", "state"]).index("by_retentionUntil", ["retentionUntil"]).index("by_householdId", ["householdId"]),
  visits: defineTable({
    householdId, providerId:v.optional(v.union(v.id("careProviders"),v.null())), title: v.string(), confirmedStartsAt: time, timezone: v.string(), confirmedAddress: v.string(),
    phone: v.string(), note: v.string(), rideTaskId: v.union(v.id("tasks"), v.null()), returnRideTaskId:v.optional(v.union(v.id("tasks"),v.null())), companionTaskId:v.optional(v.union(v.id("tasks"),v.null())), transport:v.optional(visitTransport), checklist: v.array(checklistItem),
    status: visitStatus, version, sourceRefs: v.array(sourceRef), createdBy: userId, updatedAt: time,
    completedAt: v.optional(time), retentionUntil: v.optional(time),
  }).index("by_householdId_and_confirmedStartsAt", ["householdId", "confirmedStartsAt"])
    .index("by_householdId_and_status_and_confirmedStartsAt", ["householdId", "status", "confirmedStartsAt"])
    .index("by_retentionUntil", ["retentionUntil"]).index("by_householdId", ["householdId"]),
  watches: defineTable({
    householdId, visitId: v.id("visits"), url: v.string(), tag: v.string(), schemaVersion: v.number(), settingsHash: v.string(),
    lastSuccessfulSourceId: v.union(v.id("sources"), v.null()), lastAttemptAt: v.optional(time), lastResult: v.optional(v.string()),
    nextCheckAt: time, active: v.boolean(), state: processingState, createdBy: userId, version, currentJobId: v.optional(v.id("jobs")),
  }).index("by_active_and_nextCheckAt", ["active", "nextCheckAt"])
    .index("by_householdId_and_active", ["householdId", "active"]).index("by_visitId", ["visitId"]).index("by_householdId", ["householdId"]),
  sources: defineTable({
    householdId, kind: v.union(v.literal("email"), v.literal("web"), v.literal("manual")),
    providerMessageId: v.optional(v.string()), watchId: v.optional(v.id("watches")), url: v.optional(v.string()),
    threadId: v.optional(v.id("mailThreads")), previousSourceId: v.optional(v.id("sources")),
    contentHash: v.string(), plaintext: v.string(), capturedAt: time, publishedAt: v.union(time, v.null()),
    retentionUntil: time, extractionState: processingState, warnings: v.array(v.string()), truncated: v.boolean(),
    unresolvedReferences: v.number(), version, retiring:v.optional(v.boolean()), providerRemoved:v.optional(v.boolean()), logisticsHash: v.optional(v.string()), comparison: v.optional(v.union(v.literal("baseline"), v.literal("changed"), v.literal("unchanged"), v.literal("unknown"))),
  }).index("by_householdId_and_providerMessageId", ["householdId", "providerMessageId"])
    .index("by_watchId_and_contentHash", ["watchId", "contentHash"]).index("by_extractionState",["extractionState"]).index("by_previousSourceId",["previousSourceId"]).index("by_previousSourceId_and_extractionState",["previousSourceId","extractionState"]).index("by_householdId", ["householdId"])
    .index("by_unresolvedReferences_and_retentionUntil", ["unresolvedReferences", "retentionUntil"]).index("by_threadId",["threadId"]),
  sourceUses:defineTable({householdId,sourceId:v.id("sources"),target:sourceUseTarget}).index("by_sourceId_and_target",["sourceId","target"]).index("by_householdId",["householdId"]),
  proposals: defineTable({
    householdId, sourceId: v.id("sources"), target: v.union(entity, v.null()), targetVersion: v.union(version, v.null()),
    field: proposalField, proposedValue: proposalValue, previousValue: proposalValue, rawDateText: v.optional(v.string()),
    quote: v.string(), quoteStart: v.number(), quoteEnd: v.number(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("dismissed"), v.literal("invalid")),
    reviewedBy: v.optional(userId), reviewedAt: v.optional(time), reason: v.optional(v.string()), version,
  }).index("by_householdId_and_status", ["householdId", "status"]).index("by_sourceId", ["sourceId"]).index("by_sourceId_and_status",["sourceId","status"]).index("by_householdId", ["householdId"]),
  handovers: defineTable({
    householdId, senderId: userId, recipientId: userId, baseMaterialRevision: version,
    lastReceiptId: v.union(v.id("handoverReceipts"), v.null()), introduction: v.string(), note: v.string(), introductionEventIds: v.optional(v.array(v.id("events"))),
    coverage: v.union(coverageSnapshot, v.null()), status: handoverState, version,
    publishedAt: v.optional(time), resolvedAt: v.optional(time), reason: v.optional(v.string()),
    supersedesId: v.optional(v.id("handovers")), supersededById: v.optional(v.id("handovers")),
    mailContextRestricted:v.optional(v.boolean()), careSnapshotCaptured:v.optional(v.boolean()), snapshotSchemaVersion: v.optional(v.number()), snapshotContextCount: v.optional(v.number()),
    retiring:v.optional(v.boolean()), snapshotItemCount: v.number(), snapshotChangeCount: v.number(), snapshotProposalCount: v.number(),
    createdAt: time, updatedAt: time, retentionUntil: v.optional(time),
  }).index("by_householdId_and_status", ["householdId", "status"])
    .index("by_householdId_and_senderId_and_status", ["householdId", "senderId", "status"])
    .index("by_householdId_and_recipientId_and_status", ["householdId", "recipientId", "status"])
    .index("by_retentionUntil", ["retentionUntil"]).index("by_householdId", ["householdId"]),
  handoverItems: defineTable({ householdId, handoverId: v.id("handovers"), snapshot: taskSnapshot })
    .index("by_handoverId", ["handoverId"]).index("by_householdId", ["householdId"]),
  handoverContextItems: defineTable({
    householdId, handoverId: v.id("handovers"), sourceRefs: v.array(sourceRef),
    snapshot: v.union(
      v.object({ kind: v.literal("visit"), visitId: v.id("visits"), version, title: v.string(), status: visitStatus, confirmedStartsAt: time, timezone: v.string(), confirmedAddress: v.string(), phone: v.string(), note: v.string(), checklist: v.array(checklistItem), transport:v.optional(visitTransport), returnRide:v.optional(v.union(v.object({taskId:v.id("tasks"),title:v.string(),status:taskStatus,ownerId:nullableUser}),v.null())), companion:v.optional(v.union(v.object({taskId:v.id("tasks"),title:v.string(),status:taskStatus,ownerId:nullableUser}),v.null())), ride: v.union(v.object({ taskId: v.id("tasks"), title: v.string(), status: taskStatus, ownerId: nullableUser }), v.null()) }),
      v.object({ kind: v.literal("thread"), threadId: v.id("mailThreads"), version, subject: v.string(), state: v.union(v.literal("new"), v.literal("waiting"), v.literal("replyReceived")), related: entity, lastMessageAt: time })
    ),
  }).index("by_handoverId", ["handoverId"]).index("by_householdId", ["householdId"]),
  handoverChanges: defineTable({
    householdId, handoverId: v.id("handovers"),
    kind: v.union(v.literal("event"), v.literal("proposal")), referenceId: v.string(), summary: v.string(),
    sourceRefs: v.array(sourceRef),
  }).index("by_handoverId", ["handoverId"]).index("by_householdId", ["householdId"]),
  handoverReceipts: defineTable({
    householdId, handoverId: v.id("handovers"), senderId: userId, recipientId: userId, acceptedAt: time,
    receiptRevision: version, eventSequence: v.number(), tookCoverage: v.boolean(),
    transferredTaskIds: v.array(v.id("tasks")), retainedTaskIds: v.array(v.id("tasks")), unassignedTaskIds: v.array(v.id("tasks")),
    retentionUntil: time,
  }).index("by_handoverId", ["handoverId"]).index("by_householdId_and_recipientId", ["householdId", "recipientId"])
    .index("by_retentionUntil", ["retentionUntil"]).index("by_householdId", ["householdId"]),
  events: defineTable({
    householdId, sequence: v.number(), actorId: nullableUser, type: v.string(), entity,
    before: v.string(), after: v.string(), sourceRefs: v.array(sourceRef), timestamp: time,
    handoverId: v.optional(v.id("handovers")), retentionUntil: time,
  }).index("by_householdId_and_sequence", ["householdId", "sequence"])
    .index("by_householdId_and_type_and_timestamp", ["householdId", "type", "timestamp"])
    .index("by_householdId_and_entityKind_and_timestamp", ["householdId", "entity.kind", "timestamp"])
    .index("by_householdId_and_entityKind_and_sequence", ["householdId", "entity.kind", "sequence"])
    .index("by_householdId_and_entity", ["householdId", "entity"])
    .index("by_householdId_and_timestamp", ["householdId", "timestamp"])
    .index("by_retentionUntil", ["retentionUntil"]).index("by_householdId", ["householdId"]),
  mailAccounts: defineTable({
    householdId, podId: v.optional(v.string()), inboxId: v.optional(v.string()), address: v.optional(v.string()),
    status: processingState, contactSyncState: processingState, version, lastError: v.optional(v.string()), capacityReached: v.optional(v.boolean()),
    syncToken: v.optional(v.string()), syncUntil: v.optional(time),
  }).index("by_householdId", ["householdId"]).index("by_inboxId", ["inboxId"]),
  contacts: defineTable({
    householdId, label: v.string(), email: v.string(), confirmedBy: userId, relationship: v.string(),
    allowSend: v.boolean(), allowReceive: v.boolean(), allowReply: v.boolean(),
    state: v.union(v.literal("approved"), v.literal("blocked")), version, updatedAt: time,
  }).index("by_householdId_and_email", ["householdId", "email"]).index("by_householdId_and_state", ["householdId", "state"]).index("by_householdId", ["householdId"]),
  mailThreads: defineTable({
    householdId, followUpId:v.optional(v.id("followUps")), inboxId: v.string(), providerThreadId: v.string(), related: v.union(entity, v.null()), subject: v.string(),
    state: v.union(v.literal("new"), v.literal("waiting"), v.literal("replyReceived"), v.literal("resolved")),
    archived: v.boolean(), quarantined: v.boolean(), deleting: v.boolean(), lastMessageAt: time,
    lastInboundAt: v.optional(time), version, lastProviderCursor: v.optional(v.string()),
  }).index("by_followUpId",["followUpId"]).index("by_householdId_related_deleting_quarantined_state", ["householdId", "related", "deleting", "quarantined", "state"])
    .index("by_householdId_and_related_and_lastMessageAt", ["householdId", "related", "lastMessageAt"])
    .index("by_inboxId_and_providerThreadId", ["inboxId", "providerThreadId"])
    .index("by_householdId_and_archived_and_lastMessageAt", ["householdId", "archived", "lastMessageAt"])
    .index("by_householdId_and_state_and_lastMessageAt", ["householdId", "state", "lastMessageAt"])
    .index("by_householdId_and_quarantined", ["householdId", "quarantined"]).index("by_householdId_and_deleting_and_lastMessageAt",["householdId","deleting","lastMessageAt"]).index("by_inbox_view",["householdId","deleting","quarantined","archived","lastMessageAt"]).index("by_waiting_view",["householdId","deleting","quarantined","archived","state","lastMessageAt"]).index("by_state_and_lastMessageAt",["state","lastMessageAt"]).index("by_householdId", ["householdId"]),
  mailMessages: defineTable({
    householdId, threadId: v.id("mailThreads"), providerMessageId: v.string(), inboxId: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")), from: v.string(), to: v.array(v.string()),
    plaintext: v.string(), subject: v.string(), sourceId: v.optional(v.id("sources")), occurredAt: time,
    delivery, deliveryAt: v.optional(time), attachmentOnly: v.boolean(), truncated: v.boolean(),
    retentionUntil: time, unresolvedReferences: v.number(), retiring:v.optional(v.boolean()),
  }).index("by_inboxId_and_providerMessageId", ["inboxId", "providerMessageId"])
    .index("by_threadId_and_direction_and_occurredAt", ["threadId", "direction", "occurredAt"])
    .index("by_threadId_and_occurredAt", ["threadId", "occurredAt"]).index("by_householdId", ["householdId"]).index("by_sourceId",["sourceId"])
    .index("by_unresolvedReferences_and_retentionUntil", ["unresolvedReferences", "retentionUntil"]),
  mailDrafts: defineTable({
    householdId, providerDraftId: v.optional(v.string()), threadId: v.optional(v.id("mailThreads")),
    related: v.union(entity, v.null()), recipient: v.string(), subject: v.string(), body: v.string(),
    inReplyTo: v.optional(v.string()), sourceRefs: v.array(sourceRef), version, contentHash: v.string(),
    correctionDraftId: v.optional(v.id("mailDrafts")), replacesDraftId: v.optional(v.id("mailDrafts")), replacementCleanupJobId: v.optional(v.id("privacyJobs")), recoveryRequestedBy: v.optional(userId), correctsSendIntentId: v.optional(v.id("sendIntents")),
    editorId: userId, approvedThreadVersion: v.optional(version),
    state: v.union(v.literal("generating"), v.literal("editable"), v.literal("approved"), v.literal("sending"), v.literal("sent"), v.literal("failed"), v.literal("deleted")),
    updatedAt: time, rawRemovedAt:v.optional(time), lastError: v.optional(v.string()), providerSyncedVersion: v.optional(version),
    syncToken: v.optional(v.string()), syncUntil: v.optional(time),
  }).index("by_householdId_and_state_and_updatedAt", ["householdId", "state", "updatedAt"])
    .index("by_householdId_and_state", ["householdId", "state"]).index("by_threadId", ["threadId"])
    .index("by_replacesDraftId", ["replacesDraftId"]).index("by_providerDraftId", ["providerDraftId"]).index("by_threadId_and_state",["threadId","state"]).index("by_state_and_updatedAt",["state","updatedAt"]).index("by_householdId_and_syncUntil",["householdId","syncUntil"]).index("by_householdId", ["householdId"]),
  sendIntents: defineTable({
    householdId, draftId: v.id("mailDrafts"), draftVersion: version, contentHash: v.string(),
    correctionDraftId: v.optional(v.id("mailDrafts")), logicalSendId: v.string(), idempotencyKey: v.string(), approvedBy: userId,
    recipient: v.string(), subject: v.string(), body: v.string(), providerDraftId: v.string(),
    approvedThreadVersion: v.optional(version), consentVersion: version,
    state: v.union(v.literal("approved"), v.literal("sending"), v.literal("sent"), v.literal("failed"), v.literal("unknown"), v.literal("cancelled")),
    delivery, providerMessageId: v.optional(v.string()), providerThreadId: v.optional(v.string()),
    attempts: v.number(), createdAt: time, lastReconciledAt:v.optional(time), firstAttemptAt: v.optional(time), lastAttemptAt: v.optional(time),
    rawRemovedAt:v.optional(time), lastError: v.optional(v.string()), reconciliation: v.union(v.literal("none"), v.literal("required"), v.literal("confirmed"), v.literal("manual")),
  }).index("by_householdId_and_logicalSendId", ["householdId", "logicalSendId"])
    .index("by_draftId_and_createdAt", ["draftId", "createdAt"])
    .index("by_draftId", ["draftId"]).index("by_providerMessageId", ["providerMessageId"])
    .index("by_state_and_lastAttemptAt", ["state", "lastAttemptAt"]).index("by_householdId_and_state",["householdId","state"]).index("by_state_and_lastReconciledAt",["state","lastReconciledAt"]).index("by_householdId", ["householdId"]),
  webhookEvents: defineTable({
    providerEventId: v.string(), eventType: v.string(), inboxId: v.string(), householdId: v.optional(householdId),
    payloadHash: v.string(), providerMessageId: v.optional(v.string()), receivedAt: time, occurredAt: time,
    state: jobState, workflowId: v.optional(v.string()), safeError: v.optional(v.string()), retentionUntil: time,
  }).index("by_providerEventId", ["providerEventId"]).index("by_householdId", ["householdId"])
    .index("by_state_and_receivedAt", ["state", "receivedAt"]).index("by_householdId_and_state",["householdId","state"]).index("by_retentionUntil", ["retentionUntil"]),
  deliveryReceipts: defineTable({ householdId, inboxId: v.string(), providerMessageId: v.string(), delivery, occurredAt: time, retentionUntil: time })
    .index("by_inboxId_and_providerMessageId", ["inboxId", "providerMessageId"]).index("by_householdId", ["householdId"]).index("by_retentionUntil", ["retentionUntil"]),
  jobs: defineTable({
    householdId, operationKey: v.string(), kind: v.string(), requestedBy: nullableUser, target: v.union(entity, v.null()),
    workflowId: v.optional(v.string()), state: jobState, safeError: v.optional(v.string()), attempts: v.number(), retryAt: v.optional(time),
    createdAt: time, updatedAt: time, consentVersion: version,
    messageId:v.optional(v.id("mailMessages")), sourceId:v.optional(v.id("sources")), notificationId:v.optional(v.id("notifications")), draftId: v.optional(v.id("mailDrafts")), sendIntentId: v.optional(v.id("sendIntents")), watchId: v.optional(v.id("watches")),
  }).index("by_householdId_and_operationKey", ["householdId", "operationKey"])
    .index("by_householdId_and_state", ["householdId", "state"])
    .index("by_householdId_and_target", ["householdId", "target"]).index("by_householdId_and_target_and_kind", ["householdId", "target", "kind"]).index("by_state_and_updatedAt", ["state", "updatedAt"]).index("by_draftId",["draftId"]).index("by_householdId", ["householdId"]),
  notifications: defineTable({
    householdId, userId, target: entity, eventId: v.optional(v.id("events")), type: v.string(),
    dedupeKey: v.string(), readAt: v.union(time, v.null()), createdAt: time,
    emailState: v.union(v.literal("disabled"), v.literal("pending"), v.literal("sent"), v.literal("cancelled"), v.literal("failed"),v.literal("sending"),v.literal("unknown")),
  }).index("by_userId_and_householdId_and_readAt", ["userId", "householdId", "readAt"])
    .index("by_householdId_and_userId", ["householdId", "userId"])
    .index("by_dedupeKey", ["dedupeKey"]).index("by_emailState_and_createdAt", ["emailState", "createdAt"]).index("by_householdId", ["householdId"]),
  notificationSends:defineTable({householdId,notificationId:v.id("notifications"),userId,recipient:v.string(),inboxId:v.string(),subject:v.string(),body:v.string(),idempotencyKey:v.string(),state:v.union(v.literal("sending"),v.literal("sent"),v.literal("unknown"),v.literal("failed")),createdAt:time,lastCheckedAt:time,providerMessageId:v.optional(v.string()),providerThreadId:v.optional(v.string()),retentionUntil:time,retiring:v.optional(v.boolean()),rawRemovedAt:v.optional(time)})
    .index("by_notificationId",["notificationId"]).index("by_householdId",["householdId"]).index("by_state_and_lastCheckedAt",["state","lastCheckedAt"]).index("by_state_and_retiring_and_lastCheckedAt",["state","retiring","lastCheckedAt"]).index("by_retentionUntil",["retentionUntil"]),
  maintenanceCursors:defineTable({key:v.string(),cursor:v.union(v.string(),v.null()),cutoff:v.optional(time)}).index("by_key",["key"]),
  privacyJobs: defineTable({
    householdId, requestedBy: userId, kind: v.union(v.literal("export"), v.literal("delete"), v.literal("deleteThread"), v.literal("deleteDraft")),
    draftId: v.optional(v.id("mailDrafts")),
    threadId: v.optional(v.id("mailThreads")), state: jobState, stage: v.string(),
    processors: v.array(v.object({ name: v.string(), state: jobState, safeError: v.optional(v.string()) })),
    requestedAt: time, completedAt: v.optional(time), safeError: v.optional(v.string()),
    exportStorageId: v.optional(v.id("_storage")), quiesceUntil:v.optional(time), workflowId: v.optional(v.string()), expiresAt: time,
  }).index("by_requestedBy", ["requestedBy"]).index("by_householdId", ["householdId"])
    .index("by_state_and_requestedAt", ["state", "requestedAt"]).index("by_householdId_and_kind_and_state",["householdId","kind","state"]).index("by_expiresAt", ["expiresAt"]),
  requests: defineTable({ userId, operation: v.string(), requestId: v.string(), resultId: v.string(), fingerprint: v.string(), expiresAt: time })
    .index("by_userId_and_operation_and_requestId", ["userId", "operation", "requestId"]).index("by_expiresAt", ["expiresAt"]).index("by_resultId",["resultId"]),
  demoSessions: defineTable({
    householdId, creatorId: userId, secondRoleId: v.optional(userId), capabilityHash: v.string(),
    capabilityUsedAt: v.optional(time), fixtureVersion: v.number(), expiresAt: time,
    officeInboxId: v.optional(v.string()), officeAddress: v.optional(v.string()),
  }).index("by_creatorId", ["creatorId"]).index("by_householdId", ["householdId"])
    .index("by_capabilityHash", ["capabilityHash"]).index("by_expiresAt", ["expiresAt"]),
  operatorSettings: defineTable({
    key: v.string(), enabled: v.boolean(), numericValue: v.optional(v.number()), textValue: v.optional(v.string()), updatedAt: time,
  }).index("by_key", ["key"]),
  exportParts:defineTable({householdId,privacyJobId:v.id("privacyJobs"),partKey:v.string(),filename:v.string(),storageId:v.id("_storage"),bytes:v.number(),sha256:v.string(),rows:v.number(),createdAt:time,expiresAt:time,accessRecordIds:v.optional(v.array(v.id("records"))),accessPlaceIds:v.optional(v.array(v.id("places"))),requiresCareAccess:v.optional(v.boolean()),requiresMailAccess:v.optional(v.boolean()),visitPackIds:v.optional(v.array(v.id("visitPacks")))})
    .index("by_privacyJobId_and_partKey",["privacyJobId","partKey"]).index("by_householdId",["householdId"]).index("by_expiresAt",["expiresAt"]),
  evaluationReservations: defineTable({ day: v.string(), fixtureId: v.string(), reservedInput: v.number(), reservedOutput: v.number(), createdAt: time, settled: v.boolean(), inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()) }).index("by_createdAt", ["createdAt"]),
  generationRuns: defineTable({
    householdId, jobId: v.id("jobs"), operation: v.union(v.literal("extractLogistics"), v.literal("draftQuestion"), v.literal("introduceHandover")),
    provider: v.union(v.literal("gemini"), v.literal("openai")), model: v.string(), state: jobState,
    sourceId: v.optional(v.id("sources")), draftId: v.optional(v.id("mailDrafts")), handoverId: v.optional(v.id("handovers")), expectedVersion: v.number(), instruction: v.string(),
    promptVersion: v.string(), schemaVersion: v.string(), reservedInput: v.optional(v.number()), reservedOutput: v.optional(v.number()), budgetDay: v.optional(v.string()),
    inputHash: v.string(), inputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
    createdAt: time, completedAt: v.optional(time), safeError: v.optional(v.string()), retryable: v.optional(v.boolean()), retryAfterAt: v.optional(time),
  }).index("by_jobId", ["jobId"]).index("by_householdId", ["householdId"]).index("by_sourceId",["sourceId"]).index("by_draftId",["draftId"]),
});
