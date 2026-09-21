import {canReadRecordFor} from "./recordsAccess";
import type {Doc,Id} from "./_generated/dataModel";
import type {MutationCtx,QueryCtx} from "./_generated/server";
import {canReadCare,canReadCareSource} from "./careAccess";
import {canReadMail} from "./model/mailAccess";
import {fail,member,type UserMutationCtx,type UserQueryCtx} from "./model/access";
export async function followUpAccess(ctx:UserQueryCtx|UserMutationCtx,followUpId:Id<"followUps">){
 const row=await ctx.db.get(followUpId);if(!row)fail("NOT_FOUND","Waiting item unavailable.");await member(ctx,row.householdId);
 if(!await canReadCare(ctx,row.householdId,ctx.user._id)||!await canReadCareSource(ctx,row.source,ctx.user._id))fail("NOT_FOUND","Waiting item unavailable.");return row;
}
export async function mailUnread(ctx:QueryCtx|MutationCtx,row:Doc<"followUps">,userId:Id<"users">){
 if(!await canReadMail(ctx,row.householdId,userId))return false;
 const linked=await ctx.db.query("mailThreads").withIndex("by_followUpId",q=>q.eq("followUpId",row._id)).take(51);if(!linked.some(thread=>!thread.deleting&&!thread.quarantined&&thread.lastInboundAt))return false;
 const read=await ctx.db.query("followUpReads").withIndex("by_followUpId_and_userId",q=>q.eq("followUpId",row._id).eq("userId",userId)).unique();
 return (row.mailRevision??0)>(read?.seenRevision??0);
}
// Called only after provider-message dedupe. Arrival changes evidence, never resolution.
export async function receivedForFollowUp(ctx:MutationCtx,thread:Pick<Doc<"mailThreads">,"followUpId"|"householdId">){
 if(!thread.followUpId)return;const row=await ctx.db.get(thread.followUpId);if(!row||row.householdId!==thread.householdId)return;
 await ctx.db.patch(row._id,{mailRevision:(row.mailRevision??0)+1,latestMailAt:Date.now(),version:row.version+1,updatedAt:Date.now()});
}

export async function visibleFollowUp(ctx:QueryCtx|MutationCtx,row:Doc<"followUps">,userId:Id<"users">){
 const recordIds=[];for(const id of row.recordIds??[]){const record=await ctx.db.get(id);if(record&&await canReadRecordFor(ctx,record,userId))recordIds.push(id);}
 const mailAccess=await canReadMail(ctx,row.householdId,userId);return {...row,recordIds,...(!mailAccess?{mailRevision:undefined,latestMailAt:undefined}:{})};
}
