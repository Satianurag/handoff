import { v } from "convex/values";

export const category = v.union(v.literal("meal"), v.literal("checkin"), v.literal("errand"), v.literal("ride"), v.literal("logistics"));
export const taskStatus = v.union(v.literal("open"), v.literal("done"), v.literal("cancelled"));
export const coverageState = v.union(v.literal("planned"), v.literal("committed"), v.literal("active"), v.literal("ended"), v.literal("cancelled"));
export const visitStatus = v.union(v.literal("upcoming"), v.literal("completed"), v.literal("cancelled"));
export const consentScope = v.union(v.literal("coordination"), v.literal("emailImport"), v.literal("aiProcessing"));
export const entity = v.union(
  v.object({ kind: v.literal("task"), id: v.id("tasks") }),
  v.object({ kind: v.literal("visit"), id: v.id("visits") }),
  v.object({ kind: v.literal("coverage"), id: v.id("coverage") }),
  v.object({ kind: v.literal("handover"), id: v.id("handovers") }),
  v.object({ kind: v.literal("thread"), id: v.id("mailThreads") }),
  v.object({ kind: v.literal("source"), id: v.id("sources") }),
  v.object({ kind: v.literal("household"), id: v.id("households") }),
);
export const sourceRef = v.object({ sourceId: v.id("sources"), quote: v.string(), start: v.number(), end: v.number() });
export const checklistItem = v.object({ key: v.string(), label: v.string(), done: v.boolean() });
export const proposalValue = v.union(v.string(), v.number(), v.null());
export const proposalField = v.union(v.literal("startsAt"), v.literal("address"), v.literal("phone"), v.literal("note"), v.literal("title"), v.literal("dueAt"));
export const handoverState = v.union(v.literal("draft"), v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("cancelled"), v.literal("superseded"));
export const jobState = v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("cancelled"), v.literal("needsReview"));
export const delivery = v.union(v.literal("pending"), v.literal("sent"), v.literal("delivered"), v.literal("bounced"), v.literal("rejected"), v.literal("unknown"));
export const processingState = v.union(v.literal("pending"), v.literal("processing"), v.literal("ready"), v.literal("failed"), v.literal("unsupported"), v.literal("quarantined"), v.literal("paused"));
export const taskSnapshot = v.object({
  taskId: v.id("tasks"), version: v.number(), title: v.string(), status: taskStatus,
  ownerId: v.union(v.id("users"), v.null()), dueAt: v.union(v.number(), v.null()),
  proposed: v.boolean(), note: v.string(), sourceRefs: v.array(sourceRef),
});
export const coverageSnapshot = v.object({
  coverageId: v.id("coverage"), version: v.number(), startsAt: v.number(), endsAt: v.number(),
  activeOwnerId: v.union(v.id("users"), v.null()), plannedOwnerId: v.union(v.id("users"), v.null()),
  state: coverageState, note: v.string(),
});

export const sourceUseTarget=v.union(v.object({kind:v.literal("task"),id:v.id("tasks")}),v.object({kind:v.literal("visit"),id:v.id("visits")}),v.object({kind:v.literal("draft"),id:v.id("mailDrafts")}),v.object({kind:v.literal("handover"),id:v.id("handovers")}));

export const visitTransport=v.object({pickupAddress:v.string(),pickupAt:v.union(v.number(),v.null()),arrivalAt:v.union(v.number(),v.null()),returnAt:v.union(v.number(),v.null()),returnAddress:v.string(),accessibilityNote:v.string(),accompanyingNote:v.string()});

export const accessPreset=v.union(v.literal("care_circle"),v.literal("limited_helper"));
