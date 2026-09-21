import {v} from "convex/values";
import type {Infer} from "convex/values";
import type {MutationCtx} from "../_generated/server";
import type {Id} from "../_generated/dataModel";
import {sourceRef,sourceUseTarget} from "../validators";
import {fail} from "./access";
export {sourceUseTarget} from "../validators";
export async function linkEvidence(ctx:MutationCtx,householdId:Id<"households">,target:Infer<typeof sourceUseTarget>,refs:Infer<typeof sourceRef>[],fresh=false){
 const sourceIds=new Set(refs.map(r=>r.sourceId));
 if(sourceIds.size>1500)return fail("TOO_MANY_SOURCES","This snapshot has too many distinct sources to save atomically; review or close older work first. Nothing was omitted.");
 for(const sourceId of sourceIds){
  const source=await ctx.db.get(sourceId);if(!source||source.householdId!==householdId||source.retiring)return fail("SOURCE_REMOVED","Original evidence was removed or is being retired. Wait for cleanup, then refresh.");
  const prior=fresh?null:await ctx.db.query("sourceUses").withIndex("by_sourceId_and_target",q=>q.eq("sourceId",sourceId).eq("target",target)).unique();
  if(!prior)await ctx.db.insert("sourceUses",{householdId,sourceId,target});
 }
 const h=await ctx.db.get(householdId);if(h)await ctx.db.patch(h._id,{evidenceRevision:(h.evidenceRevision??0)+1});
}
