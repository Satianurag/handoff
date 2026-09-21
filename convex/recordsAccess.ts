import type { QueryCtx,MutationCtx } from "./_generated/server";
import type { Doc,Id } from "./_generated/dataModel";
import { member,fail,type UserQueryCtx,type UserMutationCtx } from "./model/access";
export function canReadRecord(row:Doc<"records">,userId:Id<"users">){return row.createdBy===userId||row.readerIds.includes(userId);}
export async function canReadRecordFor(ctx:QueryCtx|MutationCtx,row:Doc<"records">,userId:Id<"users">){
 if(!canReadRecord(row,userId))return false;
 const membership=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",row.householdId).eq("userId",userId)).unique(),household=await ctx.db.get(row.householdId);
 if(row.createdBy!==userId&&membership&&"privacyRevokedAt" in membership&&typeof membership.privacyRevokedAt==="number"&&(row.readerGrantedAt?.[userId]??0)<=membership.privacyRevokedAt)return false;
 return membership?.status==="active"&&!("accessPreset" in membership&&membership.accessPreset==="limited_helper")&&household?.status==="active";
}
export async function recordAccess(ctx:UserQueryCtx|UserMutationCtx,recordId:Id<"records">,write=false){
 const row=await ctx.db.get(recordId);if(!row)return fail("NOT_FOUND","Record unavailable.");await member(ctx,row.householdId);
 if(!await canReadRecordFor(ctx,row,ctx.user._id)||(write&&row.createdBy!==ctx.user._id))return fail("NOT_FOUND","Record unavailable or not editable.");return row;
}
