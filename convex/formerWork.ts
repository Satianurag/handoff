import {paginationOptsValidator,paginationResultValidator} from "convex/server";
import {v} from "convex/values";
import {type QueryCtx} from "./_generated/server";
import type {Id,Doc} from "./_generated/dataModel";
import {member,fail,userQuery} from "./model/access";
const projection=v.object({_id:v.id("memberships"),userId:v.id("users"),displayName:v.string(),status:v.union(v.literal("removed"),v.literal("left")),endedAt:v.union(v.number(),v.null())});
export async function requireFormerMember(ctx:QueryCtx,householdId:Id<"households">,memberId:Id<"memberships">){
 const row=await ctx.db.get(memberId);
 if(!row||row.householdId!==householdId||row.status==="active")return fail("NOT_FOUND","This former member is unavailable. Choose another person or Everyone.");
 return row;
}
async function label(ctx:QueryCtx,row:Doc<"memberships">){
 const profile=await ctx.db.query("profiles").withIndex("by_userId",q=>q.eq("userId",row.userId)).unique();
 const user=await ctx.db.get(row.userId);
 return {_id:row._id,userId:row.userId,displayName:profile?.displayName??user?.name??"Former member",status:row.status as "removed"|"left",endedAt:row.endedAt??null};
}
export const list=userQuery({
 args:{householdId:v.id("households"),status:v.union(v.literal("removed"),v.literal("left")),paginationOpts:paginationOptsValidator},returns:paginationResultValidator(projection),
 handler:async(ctx,args)=>{
  await member(ctx,args.householdId);
  const result=await ctx.db.query("memberships").withIndex("by_householdId_and_status",q=>q.eq("householdId",args.householdId).eq("status",args.status)).order("desc").paginate(args.paginationOpts);
  return {...result,page:await Promise.all(result.page.map(row=>label(ctx,row)))};
 }
});
export const get=userQuery({args:{householdId:v.id("households"),memberId:v.id("memberships")},returns:projection,handler:async(ctx,args)=>{await member(ctx,args.householdId);return label(ctx,await requireFormerMember(ctx,args.householdId,args.memberId));}});
