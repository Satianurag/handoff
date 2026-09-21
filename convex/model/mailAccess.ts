import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import { member, fail, type UserQueryCtx, type UserMutationCtx } from "./access";

// An inbox can contain medical information before any attachment is filed.
// Default the entire mail surface to the explicit care audience; do not infer
// sensitivity from keywords or let household membership expose raw messages.
export async function canReadMail(ctx:QueryCtx|MutationCtx,householdId:Id<"households">,userId:Id<"users">){
 const membership=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",householdId).eq("userId",userId)).unique();
 if(membership?.status!=="active"||membership.accessPreset==="limited_helper")return false;
 const profile=await ctx.db.query("careProfiles").withIndex("by_householdId",q=>q.eq("householdId",householdId)).unique();
 if(profile)return profile.createdBy===userId||profile.authorizedUserIds.includes(userId);
 const household=await ctx.db.get(householdId);return household?.status==="active"&&household.ownerId===userId;
}
export async function requireMailAccess(ctx:UserQueryCtx|UserMutationCtx,householdId:Id<"households">){
 const membership=await member(ctx,householdId);
 if(!await canReadMail(ctx,householdId,ctx.user._id))fail("CARE_ACCESS_REQUIRED","Email can contain medical information. Ask the care profile creator for access; before setup, only the household owner can open the inbox.");
 return membership;
}
export async function canReadSource(ctx:QueryCtx|MutationCtx,source:Doc<"sources">|null,userId:Id<"users">){
 return !!source&&!source.retiring&&(source.kind!=="email"||await canReadMail(ctx,source.householdId,userId));
}
export async function requireSourceAccess(ctx:UserQueryCtx|UserMutationCtx,source:Doc<"sources">){
 await member(ctx,source.householdId);if(source.kind==="email")await requireMailAccess(ctx,source.householdId);
}
export async function canReadEvent(ctx:QueryCtx|MutationCtx,event:Doc<"events">,userId:Id<"users">){
 if(await canReadMail(ctx,event.householdId,userId))return true;
 if(event.entity.kind==="thread"||/^(?:mail|thread|draft|send|contact)\./.test(event.type))return false;
 if(event.entity.kind==="source"){const source=await ctx.db.get(event.entity.id);if(!source||source.kind==="email")return false;}
 for(const ref of event.sourceRefs){const source=await ctx.db.get(ref.sourceId);if(!source||source.kind==="email")return false;}
 return true;
}

export async function redactSourceRefs(ctx:QueryCtx|MutationCtx,refs:Doc<"tasks">["sourceRefs"],userId:Id<"users">){
 const visible:Doc<"tasks">["sourceRefs"]=[];
 for(const ref of refs){const source=await ctx.db.get(ref.sourceId);if(await canReadSource(ctx,source,userId))visible.push(ref);}
 return visible;
}
