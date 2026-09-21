/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentmailWebhook from "../agentmailWebhook.js";
import type * as auth from "../auth.js";
import type * as care from "../care.js";
import type * as careAccess from "../careAccess.js";
import type * as careHandover from "../careHandover.js";
import type * as careSchema from "../careSchema.js";
import type * as careShares from "../careShares.js";
import type * as careSharesSchema from "../careSharesSchema.js";
import type * as consents from "../consents.js";
import type * as contacts from "../contacts.js";
import type * as coverage from "../coverage.js";
import type * as crons from "../crons.js";
import type * as dates from "../dates.js";
import type * as demoFixtures from "../demoFixtures.js";
import type * as demoStore from "../demoStore.js";
import type * as demoTokens from "../demoTokens.js";
import type * as drafts from "../drafts.js";
import type * as fixtures_extraction from "../fixtures/extraction.js";
import type * as followUpMail from "../followUpMail.js";
import type * as followUpMailAccess from "../followUpMailAccess.js";
import type * as formerWork from "../formerWork.js";
import type * as generate from "../generate.js";
import type * as generationEvaluation from "../generationEvaluation.js";
import type * as generationEvaluationStore from "../generationEvaluationStore.js";
import type * as generationStore from "../generationStore.js";
import type * as generationWorkflows from "../generationWorkflows.js";
import type * as handovers from "../handovers.js";
import type * as helpers from "../helpers.js";
import type * as history from "../history.js";
import type * as householdTimezone from "../householdTimezone.js";
import type * as households from "../households.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as inviteStore from "../inviteStore.js";
import type * as invites from "../invites.js";
import type * as jobs from "../jobs.js";
import type * as mail from "../mail.js";
import type * as mailStore from "../mailStore.js";
import type * as mailWorkflows from "../mailWorkflows.js";
import type * as maintenance from "../maintenance.js";
import type * as model_access from "../model/access.js";
import type * as model_agentmail from "../model/agentmail.js";
import type * as model_delivery from "../model/delivery.js";
import type * as model_documentExtraction from "../model/documentExtraction.js";
import type * as model_entities from "../model/entities.js";
import type * as model_events from "../model/events.js";
import type * as model_generationContract from "../model/generationContract.js";
import type * as model_generationValidation from "../model/generationValidation.js";
import type * as model_limits from "../model/limits.js";
import type * as model_mail from "../model/mail.js";
import type * as model_mailAccess from "../model/mailAccess.js";
import type * as model_operations from "../model/operations.js";
import type * as model_privacy from "../model/privacy.js";
import type * as model_publicDns from "../model/publicDns.js";
import type * as model_publicUrl from "../model/publicUrl.js";
import type * as model_recurrence from "../model/recurrence.js";
import type * as model_requests from "../model/requests.js";
import type * as model_responses from "../model/responses.js";
import type * as model_retention from "../model/retention.js";
import type * as model_sourceText from "../model/sourceText.js";
import type * as model_sourceUses from "../model/sourceUses.js";
import type * as model_workflowCleanup from "../model/workflowCleanup.js";
import type * as model_workflows from "../model/workflows.js";
import type * as notificationMail from "../notificationMail.js";
import type * as notificationMaintenance from "../notificationMaintenance.js";
import type * as notificationStore from "../notificationStore.js";
import type * as notifications from "../notifications.js";
import type * as onboarding from "../onboarding.js";
import type * as operationActions from "../operationActions.js";
import type * as operationStore from "../operationStore.js";
import type * as operationalWorkflows from "../operationalWorkflows.js";
import type * as operator from "../operator.js";
import type * as placeSearch from "../placeSearch.js";
import type * as places from "../places.js";
import type * as placesSchema from "../placesSchema.js";
import type * as privacyExport from "../privacyExport.js";
import type * as privacyExportStore from "../privacyExportStore.js";
import type * as privacyJobs from "../privacyJobs.js";
import type * as privacyScopeStore from "../privacyScopeStore.js";
import type * as privacyStore from "../privacyStore.js";
import type * as privacyWorkflows from "../privacyWorkflows.js";
import type * as proposals from "../proposals.js";
import type * as recordReview from "../recordReview.js";
import type * as records from "../records.js";
import type * as recordsAccess from "../recordsAccess.js";
import type * as recordsFiles from "../recordsFiles.js";
import type * as recordsHttp from "../recordsHttp.js";
import type * as recordsMail from "../recordsMail.js";
import type * as recordsSchema from "../recordsSchema.js";
import type * as recordsStore from "../recordsStore.js";
import type * as recordsWorkflow from "../recordsWorkflow.js";
import type * as recovery from "../recovery.js";
import type * as recurrence from "../recurrence.js";
import type * as retention from "../retention.js";
import type * as retentionFixtures from "../retentionFixtures.js";
import type * as retentionHistory from "../retentionHistory.js";
import type * as retentionMail from "../retentionMail.js";
import type * as retentionRawStore from "../retentionRawStore.js";
import type * as retentionSourceStore from "../retentionSourceStore.js";
import type * as retentionWorkflows from "../retentionWorkflows.js";
import type * as sendIntents from "../sendIntents.js";
import type * as sources from "../sources.js";
import type * as tasks from "../tasks.js";
import type * as team from "../team.js";
import type * as threads from "../threads.js";
import type * as today from "../today.js";
import type * as uiFixtures from "../uiFixtures.js";
import type * as upcoming from "../upcoming.js";
import type * as validators from "../validators.js";
import type * as visits from "../visits.js";
import type * as watches from "../watches.js";
import type * as web from "../web.js";
import type * as webStore from "../webStore.js";
import type * as webhookStore from "../webhookStore.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentmailWebhook: typeof agentmailWebhook;
  auth: typeof auth;
  care: typeof care;
  careAccess: typeof careAccess;
  careHandover: typeof careHandover;
  careSchema: typeof careSchema;
  careShares: typeof careShares;
  careSharesSchema: typeof careSharesSchema;
  consents: typeof consents;
  contacts: typeof contacts;
  coverage: typeof coverage;
  crons: typeof crons;
  dates: typeof dates;
  demoFixtures: typeof demoFixtures;
  demoStore: typeof demoStore;
  demoTokens: typeof demoTokens;
  drafts: typeof drafts;
  "fixtures/extraction": typeof fixtures_extraction;
  followUpMail: typeof followUpMail;
  followUpMailAccess: typeof followUpMailAccess;
  formerWork: typeof formerWork;
  generate: typeof generate;
  generationEvaluation: typeof generationEvaluation;
  generationEvaluationStore: typeof generationEvaluationStore;
  generationStore: typeof generationStore;
  generationWorkflows: typeof generationWorkflows;
  handovers: typeof handovers;
  helpers: typeof helpers;
  history: typeof history;
  householdTimezone: typeof householdTimezone;
  households: typeof households;
  http: typeof http;
  inbox: typeof inbox;
  inviteStore: typeof inviteStore;
  invites: typeof invites;
  jobs: typeof jobs;
  mail: typeof mail;
  mailStore: typeof mailStore;
  mailWorkflows: typeof mailWorkflows;
  maintenance: typeof maintenance;
  "model/access": typeof model_access;
  "model/agentmail": typeof model_agentmail;
  "model/delivery": typeof model_delivery;
  "model/documentExtraction": typeof model_documentExtraction;
  "model/entities": typeof model_entities;
  "model/events": typeof model_events;
  "model/generationContract": typeof model_generationContract;
  "model/generationValidation": typeof model_generationValidation;
  "model/limits": typeof model_limits;
  "model/mail": typeof model_mail;
  "model/mailAccess": typeof model_mailAccess;
  "model/operations": typeof model_operations;
  "model/privacy": typeof model_privacy;
  "model/publicDns": typeof model_publicDns;
  "model/publicUrl": typeof model_publicUrl;
  "model/recurrence": typeof model_recurrence;
  "model/requests": typeof model_requests;
  "model/responses": typeof model_responses;
  "model/retention": typeof model_retention;
  "model/sourceText": typeof model_sourceText;
  "model/sourceUses": typeof model_sourceUses;
  "model/workflowCleanup": typeof model_workflowCleanup;
  "model/workflows": typeof model_workflows;
  notificationMail: typeof notificationMail;
  notificationMaintenance: typeof notificationMaintenance;
  notificationStore: typeof notificationStore;
  notifications: typeof notifications;
  onboarding: typeof onboarding;
  operationActions: typeof operationActions;
  operationStore: typeof operationStore;
  operationalWorkflows: typeof operationalWorkflows;
  operator: typeof operator;
  placeSearch: typeof placeSearch;
  places: typeof places;
  placesSchema: typeof placesSchema;
  privacyExport: typeof privacyExport;
  privacyExportStore: typeof privacyExportStore;
  privacyJobs: typeof privacyJobs;
  privacyScopeStore: typeof privacyScopeStore;
  privacyStore: typeof privacyStore;
  privacyWorkflows: typeof privacyWorkflows;
  proposals: typeof proposals;
  recordReview: typeof recordReview;
  records: typeof records;
  recordsAccess: typeof recordsAccess;
  recordsFiles: typeof recordsFiles;
  recordsHttp: typeof recordsHttp;
  recordsMail: typeof recordsMail;
  recordsSchema: typeof recordsSchema;
  recordsStore: typeof recordsStore;
  recordsWorkflow: typeof recordsWorkflow;
  recovery: typeof recovery;
  recurrence: typeof recurrence;
  retention: typeof retention;
  retentionFixtures: typeof retentionFixtures;
  retentionHistory: typeof retentionHistory;
  retentionMail: typeof retentionMail;
  retentionRawStore: typeof retentionRawStore;
  retentionSourceStore: typeof retentionSourceStore;
  retentionWorkflows: typeof retentionWorkflows;
  sendIntents: typeof sendIntents;
  sources: typeof sources;
  tasks: typeof tasks;
  team: typeof team;
  threads: typeof threads;
  today: typeof today;
  uiFixtures: typeof uiFixtures;
  upcoming: typeof upcoming;
  validators: typeof validators;
  visits: typeof visits;
  watches: typeof watches;
  web: typeof web;
  webStore: typeof webStore;
  webhookStore: typeof webhookStore;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  generationWorkflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"generationWorkflow">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
};
