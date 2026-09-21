import type {MutationCtx} from "../_generated/server";
import type {Id} from "../_generated/dataModel";
import {internal} from "../_generated/api";
import {operationalWorkflow} from "./workflows";
export const householdTables=["memberships", "invites", "consents", "taskSeries", "tasks", "coverage", "visits", "watches", "sources", "proposals", "handovers", "handoverItems", "handoverChanges", "handoverContextItems", "handoverReceipts", "events", "mailAccounts", "contacts", "mailThreads", "mailMessages", "mailDrafts", "sendIntents", "webhookEvents", "deliveryReceipts", "jobs", "notifications", "demoSessions", "generationRuns", "notificationSends", "sourceUses", "records", "recordVersions", "recordProposals", "recordVisitLinks", "recordShares", "careProfiles", "careProviders", "medicineEntries", "medicineVersions", "careNotes", "visitQuestions", "visitPacks", "followUps", "memberAvailability", "replacementRequests", "places", "visitPlaces", "handoverCareSnapshots", "careShares", "followUpReads", "recordMailOrigins"] as const;
export type HouseholdTable=typeof householdTables[number];
export async function startPrivacy(ctx:MutationCtx,privacyJobId:Id<"privacyJobs">){
 const job=await ctx.db.get(privacyJobId);if(!job||job.workflowId||!["queued","failed"].includes(job.state))return;
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)return;
 const workflowId=await operationalWorkflow.start(ctx,internal.privacyWorkflows.execute,{privacyJobId},{startAsync:true,onComplete:internal.privacyWorkflows.completed,context:{privacyJobId}});
 await ctx.db.patch(job._id,{workflowId,state:"queued",safeError:undefined});
}
