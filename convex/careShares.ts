import {v} from "convex/values";
import schema from "./schema";
import {internal} from "./_generated/api";
import {internalMutation} from "./_generated/server";
import {userQuery,userMutation,member,fail,email,timestamp,type UserQueryCtx,type UserMutationCtx} from "./model/access";
import {canReadVisitPack} from "./careAccess";
import {priorRequest,saveRequest} from "./model/requests";
import type {Id} from "./_generated/dataModel";

async function creatorAccess(ctx:UserQueryCtx|UserMutationCtx,packId:Id<"visitPacks">,requireSources=true){
 const pack=await ctx.db.get(packId);if(!pack)fail("NOT_FOUND","Visit pack unavailable.");
 await member(ctx,pack.householdId);
 if(pack.createdBy!==ctx.user._id)fail("FORBIDDEN","Only the pack creator can manage private links.");
 if(requireSources&&!await canReadVisitPack(ctx,pack,ctx.user._id))fail("SOURCE_ACCESS_REQUIRED","Restore your care and source record access before sharing this pack.");
 return pack;
}
const shareView=schema.doc("careShares").pick("_id","recipientEmail","expiresAt","revokedAt","createdAt");
export const list=userQuery({args:{packId:v.id("visitPacks")},returns:v.array(shareView),handler:async(ctx,args)=>{
 await creatorAccess(ctx,args.packId,false);
 const shares=await ctx.db.query("careShares").withIndex("by_packId",q=>q.eq("packId",args.packId)).order("desc").take(100);
 return shares.map(({_id,recipientEmail,expiresAt,revokedAt,createdAt})=>({_id,recipientEmail,expiresAt,revokedAt,createdAt}));
}});
export const create=userMutation({args:{packId:v.id("visitPacks"),recipientEmail:v.string(),expiresAt:v.number(),requestId:v.string()},returns:v.id("careShares"),handler:async(ctx,args)=>{
 const pack=await creatorAccess(ctx,args.packId),recipientEmail=email(args.recipientEmail);
 const fingerprint=JSON.stringify({...args,recipientEmail}),prior=await priorRequest(ctx,"care.share",args.requestId,fingerprint);
 if(prior){const id=ctx.db.normalizeId("careShares",prior.resultId);if(id&&await ctx.db.get(id))return id;fail("NOT_FOUND","The previous share was removed. Create a new link.");}
 const now=Date.now();timestamp(args.expiresAt);if(args.expiresAt<=now||args.expiresAt>now+7*86400000)fail("INVALID_EXPIRY","Choose an expiry within the next seven days.");
 const shares=await ctx.db.query("careShares").withIndex("by_packId",q=>q.eq("packId",pack._id)).take(100);let active=0;
 for(const share of shares){if(share.revokedAt||share.expiresAt<=now)await ctx.db.delete(share._id);else active++;}
 if(active>=100)fail("LIMIT","Revoke an existing link before creating another.");
 const id=await ctx.db.insert("careShares",{householdId:pack.householdId,packId:pack._id,packVersion:pack.version,recipientEmail,createdBy:ctx.user._id,createdAt:now,expiresAt:args.expiresAt});
 await ctx.scheduler.runAt(args.expiresAt,internal.careShares.expire,{shareId:id});
 await saveRequest(ctx,"care.share",args.requestId,fingerprint,id);return id;
}});
export const revoke=userMutation({args:{shareId:v.id("careShares")},returns:v.null(),handler:async(ctx,args)=>{
 const share=await ctx.db.get(args.shareId);if(!share)fail("NOT_FOUND","Share unavailable.");await creatorAccess(ctx,share.packId,false);
 if(!share.revokedAt)await ctx.db.patch(share._id,{revokedAt:Date.now()});return null;
}});
// The link identifies one invitation. It is never a bearer capability: verified identity,
// current sender permissions and every original source grant are checked on each read.
export const shared=userQuery({args:{shareId:v.id("careShares")},returns:v.union(v.object({pack:schema.doc("visitPacks").pick("_id","snapshot","reviewedAt","reviewedBy","version"),expiresAt:v.number(),creatorDisplayName:v.string(),timezone:v.string()}),v.null()),handler:async(ctx,args)=>{
 const share=await ctx.db.get(args.shareId),now=Date.now();
 if(!share||share.revokedAt||share.expiresAt<=now||ctx.user.isAnonymous||!ctx.user.emailVerificationTime||ctx.user.email?.trim().toLowerCase()!==share.recipientEmail)return null;
 const household=await ctx.db.get(share.householdId),pack=await ctx.db.get(share.packId);
 if(household?.status!=="active"||!pack||pack.householdId!==share.householdId||pack.createdBy!==share.createdBy)return null;
 const creator=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",share.householdId).eq("userId",share.createdBy)).unique();
 const recipient=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",share.householdId).eq("userId",ctx.user._id)).unique();
 if(!creator||creator.status!=="active"||creator.accessPreset==="limited_helper"||(creator.privacyRevokedAt!==undefined&&share.createdAt<=creator.privacyRevokedAt))return null;
 if(recipient&&(recipient.status!=="active"||recipient.accessPreset==="limited_helper"||(recipient.privacyRevokedAt!==undefined&&share.createdAt<=recipient.privacyRevokedAt)))return null;
 if(!await canReadVisitPack(ctx,pack,share.createdBy))return null;
 const profile=await ctx.db.query("profiles").withIndex("by_userId",q=>q.eq("userId",share.createdBy)).unique();
 return {pack:{_id:pack._id,snapshot:pack.snapshot,reviewedAt:pack.reviewedAt,reviewedBy:pack.reviewedBy,version:share.packVersion},expiresAt:share.expiresAt,creatorDisplayName:profile?.displayName??"The pack creator",timezone:household.timezone};
}});

export const expire=internalMutation({args:{shareId:v.id("careShares")},returns:v.null(),handler:async(ctx,args)=>{const share=await ctx.db.get(args.shareId);if(share&&!share.revokedAt&&share.expiresAt<=Date.now())await ctx.db.patch(share._id,{revokedAt:Date.now()});return null;}});
