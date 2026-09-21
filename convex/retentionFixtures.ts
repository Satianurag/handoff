import {v} from "convex/values";
import {internalMutation,env} from "./_generated/server";
import {fail} from "./model/access";
import {queueOperation} from "./model/operations";
// Operator-only age simulation for genuine provider cleanup verification.
// It cannot target real households or the production deployment.
export const age=internalMutation({args:{messageId:v.id("mailMessages")},returns:v.union(v.id("jobs"),v.null()),handler:async(ctx,args):Promise<import("./_generated/dataModel").Id<"jobs">|null>=>{
 if(env.CONVEX_SITE_URL!=="https://befitting-cobra-234.convex.site")return fail("DEVELOPMENT_ONLY","Synthetic age simulation is development-only.");
 const message=await ctx.db.get(args.messageId),h=message?await ctx.db.get(message.householdId):null;
 if(!message||h?.mode!=="demo"||h.status!=="active"||!h.expiresAt||h.expiresAt<=Date.now())return fail("DEMO_REQUIRED","Active synthetic household required.");
 await ctx.db.patch(message._id,{retentionUntil:Date.now()-1});
 if(message.sourceId){
  const source=await ctx.db.get(message.sourceId);if(!source||source.householdId!==h._id)return fail("NOT_FOUND","Source unavailable.");
  await ctx.db.patch(source._id,{retentionUntil:Date.now()-1});
  return queueOperation(ctx,{householdId:h._id,kind:"retireSource",key:`retire-fixture-source:${source._id}`,actorId:null,sourceId:source._id,automatic:true});
 }
 return queueOperation(ctx,{householdId:h._id,kind:"retireMail",key:`retire-fixture-mail:${message._id}`,actorId:null,messageId:message._id,automatic:true});
}});
