import type {QueryCtx} from "../_generated/server";
import type {Id} from "../_generated/dataModel";
export async function threadNeedsEvidence(ctx:QueryCtx,threadId:Id<"mailThreads">){
 const thread=await ctx.db.get(threadId);if(!thread)return false;
 if(thread.deleting)return true;
 if(!thread.quarantined&&thread.state!=="resolved")return true;
 if(thread.followUpId){const waiting=await ctx.db.get(thread.followUpId);if(waiting&&waiting.status!=="closed")return true;}
 if(thread.related){const related=await ctx.db.get(thread.related.id);if(related&&"status" in related&&["open","upcoming"].includes(related.status))return true;}
 for(const state of ["generating","editable","approved","sending","failed"] as const){
  if(await ctx.db.query("mailDrafts").withIndex("by_threadId_and_state",q=>q.eq("threadId",threadId).eq("state",state)).first())return true;
 }
 return false;
}
