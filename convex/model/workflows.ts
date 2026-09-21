import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "../_generated/api";
export const operationalWorkflow = new WorkflowManager(components.workflow, { workpoolOptions: { maxParallelism: 4, retryActionsByDefault: false } });
export const generationWorkflow = new WorkflowManager(components.generationWorkflow, { workpoolOptions: { maxParallelism: 1, retryActionsByDefault: false } });
export const generationKinds = new Set(["extractLogistics", "draftQuestion", "introduceHandover"]);
