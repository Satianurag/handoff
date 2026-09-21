import type {WorkflowId,WorkflowManager} from "@convex-dev/workflow";
import type {MutationCtx} from "../_generated/server";
export async function cleanSettledWorkflow(ctx:MutationCtx,manager:WorkflowManager,workflowId:string,cancel=false){
 try{
  const status=await manager.status(ctx,workflowId as WorkflowId);
  if(status.type==="inProgress"){
   if(cancel)await manager.cancel(ctx,workflowId as WorkflowId);
   return false;
  }
  return await manager.cleanup(ctx,workflowId as WorkflowId);
 }catch(error){
  if(error instanceof Error&&error.message.includes(`Workflow not found: ${workflowId}`))return true;
  throw error;
 }
}
