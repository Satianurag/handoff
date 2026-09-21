import {v} from "convex/values";
import schema from "./schema";
import {userQuery,userMutation,fail,checkVersion} from "./model/access";
import {requireMailAccess,canReadMail} from "./model/mailAccess";
import {followUpAccess,mailUnread,receivedForFollowUp,visibleFollowUp} from "./followUpMailAccess";
import {recordAccess,canReadRecordFor} from "./recordsAccess";
export const detail=userQuery({args:{followUpId:v.id("followUps")},returns:v.object({followUp:schema.doc("followUps"),mailAccess:v.boolean(),unread:v.boolean(),revision:v.number(),threads:v.array(schema.doc("mailThreads")),records:v.array(schema.doc("records"))}),handler:async(ctx,args)=>{
 const followUp=await followUpAccess(ctx,args.followUpId),mailAccess=await canReadMail(ctx,followUp.householdId,ctx.user._id),records=[];
 for(const id of followUp.recordIds??[]){const row=await ctx.db.get(id);if(row&&await canReadRecordFor(ctx,row,ctx.user._id))records.push(row);}
 const threads=mailAccess?(await ctx.db.query("mailThreads").withIndex("by_followUpId",q=>q.eq("followUpId",followUp._id)).take(51)).filter(t=>!t.deleting&&!t.quarantined):[];
 return {followUp:await visibleFollowUp(ctx,followUp,ctx.user._id),mailAccess,unread:await mailUnread(ctx,followUp,ctx.user._id),revision:mailAccess?followUp.mailRevision??0:0,threads,records};
}});
export const markRead=userMutation({args:{followUpId:v.id("followUps"),throughRevision:v.number()},returns:v.null(),handler:async(ctx,args)=>{
 const row=await followUpAccess(ctx,args.followUpId);await requireMailAccess(ctx,row.householdId);if(!Number.isSafeInteger(args.throughRevision)||args.throughRevision<0||args.throughRevision>(row.mailRevision??0))fail("INVALID_REVISION","Refresh this waiting item before marking it reviewed.");
 const read=await ctx.db.query("followUpReads").withIndex("by_followUpId_and_userId",q=>q.eq("followUpId",row._id).eq("userId",ctx.user._id)).unique();
 if(read)await ctx.db.patch(read._id,{seenRevision:Math.max(read.seenRevision,args.throughRevision),seenAt:Date.now()});else await ctx.db.insert("followUpReads",{householdId:row.householdId,followUpId:row._id,userId:ctx.user._id,seenRevision:args.throughRevision,seenAt:Date.now()});return null;
}});
export const linkThread=userMutation({args:{threadId:v.id("mailThreads"),expectedVersion:v.number(),followUpId:v.union(v.id("followUps"),v.null())},returns:v.null(),handler:async(ctx,args)=>{
 const thread=await ctx.db.get(args.threadId);if(!thread||thread.deleting||thread.quarantined)fail("NOT_FOUND","Review the sender before linking this conversation.");await requireMailAccess(ctx,thread.householdId);checkVersion(thread,args.expectedVersion);
 if(thread.followUpId)await followUpAccess(ctx,thread.followUpId);
 if(args.followUpId){const row=await followUpAccess(ctx,args.followUpId);if(row.householdId!==thread.householdId)fail("NOT_FOUND","Waiting item unavailable.");const linked=await ctx.db.query("mailThreads").withIndex("by_followUpId",q=>q.eq("followUpId",row._id)).take(51);if(!linked.some(t=>t._id===thread._id)&&linked.length>=50)fail("LIMIT","This waiting item already has fifty conversations.");}
 if(thread.followUpId===args.followUpId||(!thread.followUpId&&!args.followUpId))return null;
 await ctx.db.patch(thread._id,{followUpId:args.followUpId??undefined,version:thread.version+1});
 if(args.followUpId&&thread.lastInboundAt)await receivedForFollowUp(ctx,{...thread,followUpId:args.followUpId});return null;
}});
export const linkRecord=userMutation({args:{followUpId:v.id("followUps"),recordId:v.id("records"),linked:v.boolean(),messageId:v.optional(v.id("mailMessages"))},returns:v.null(),handler:async(ctx,args)=>{
 const row=await followUpAccess(ctx,args.followUpId),record=await recordAccess(ctx,args.recordId);if(row.householdId!==record.householdId)fail("NOT_FOUND","Record unavailable.");
 if(args.messageId){await requireMailAccess(ctx,row.householdId);const message=await ctx.db.get(args.messageId),thread=message?await ctx.db.get(message.threadId):null;if(!message||message.retiring||!thread||thread.deleting||thread.quarantined||thread.followUpId!==row._id)fail("NOT_FOUND","Message no longer linked to this waiting item.");const retainedOrigin=await ctx.db.query("recordMailOrigins").withIndex("by_recordId_and_messageId_and_attachmentId",q=>q.eq("recordId",record._id).eq("messageId",message._id)).first();const originals=await ctx.db.query("recordVersions").withIndex("by_recordId",q=>q.eq("recordId",record._id)).take(50);if(!retainedOrigin&&!originals.some(file=>file.sourceMessageId===message._id&&file.sourceAttachmentId))fail("SOURCE_MISMATCH","This record has no original imported from the selected message. Link the existing record separately after reviewing it.");}
 const ids=new Set(row.recordIds??[]);if(args.linked)ids.add(record._id);else ids.delete(record._id);if(ids.size>30)fail("LIMIT","Choose at most thirty records.");
 if(ids.size===(row.recordIds??[]).length&&[...ids].every(id=>row.recordIds?.includes(id)))return null;
 await ctx.db.patch(row._id,{recordIds:[...ids],version:row.version+1,updatedAt:Date.now()});return null;
}});
