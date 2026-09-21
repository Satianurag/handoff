import { canReadRecordFor } from "./recordsAccess";
import { limits,numericSetting,modelDayConfig } from "./model/limits";
import { v } from "convex/values";
import { internalQuery,internalMutation } from "./_generated/server";
import schema from "./schema";
import { recordProposalKind } from "./recordsSchema";
export const extractionInput=internalQuery({args:{recordId:v.id("records"),versionId:v.id("recordVersions")},returns:v.union(v.object({record:schema.doc("records"),file:schema.doc("recordVersions")}),v.null()),handler:async(ctx,args)=>{
 const record=await ctx.db.get(args.recordId),file=await ctx.db.get(args.versionId);if(!record||!file||record.currentVersionId!==file._id||record.status!=="extracting")return null;const h=await ctx.db.get(record.householdId),m=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",record.householdId).eq("userId",record.createdBy)).unique();if(h?.status!=="active"||!h.aiProcessing||m?.status!=="active"||!await canReadRecordFor(ctx,record,record.createdBy))return null;return {record,file};
}});
export const saveExtraction=internalMutation({args:{recordId:v.id("records"),versionId:v.id("recordVersions"),proposals:v.array(v.object({kind:recordProposalKind,title:v.string(),text:v.string(),quote:v.string(),page:v.number()}))},returns:v.null(),handler:async(ctx,args)=>{
 const row=await ctx.db.get(args.recordId);if(!row||row.currentVersionId!==args.versionId||row.status!=="extracting")return null;const h=await ctx.db.get(row.householdId),m=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",row.householdId).eq("userId",row.createdBy)).unique();if(h?.status!=="active"||!h.aiProcessing||m?.status!=="active"||!await canReadRecordFor(ctx,row,row.createdBy))return null;
 for(const p of await ctx.db.query("recordProposals").withIndex("by_versionId",q=>q.eq("versionId",args.versionId)).take(40))await ctx.db.delete(p._id);
 for(const p of args.proposals.slice(0,40))await ctx.db.insert("recordProposals",{...p,householdId:row.householdId,recordId:row._id,versionId:args.versionId,status:"pending"});
 const extractedText=args.proposals.map(p=>`${p.title} ${p.text} ${p.quote}`).join("\n").slice(0,200000);
 await ctx.db.patch(row._id,{extractedText,searchText:`${row.title} ${row.provider??""} ${row.notes} ${row.category} ${extractedText}`,status:args.proposals.length?"review":"filed",safeError:undefined,updatedAt:Date.now()});return null;
}});

export const settleBudget=internalMutation({args:{recordId:v.id("records"),versionId:v.id("recordVersions"),inputTokens:v.number(),outputTokens:v.number()},returns:v.null(),handler:async(ctx,args)=>{
 const row=await ctx.db.get(args.recordId),budget=row?.extractionBudget;if(!row||row.currentVersionId!==args.versionId||!budget||budget.settled)return null;
 if(![args.inputTokens,args.outputTokens].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=2000000))throw new Error("Invalid model usage.");
 for(const [name,actual,reserved,setting,fallback] of [["modelInput",args.inputTokens,budget.input,"dailyModelInputTokens",1000000],["modelOutput",args.outputTokens,budget.output,"dailyModelOutputTokens",100000]] as const)await limits.limit(ctx,name,{key:budget.day,count:actual-reserved,reserve:actual>reserved,config:await modelDayConfig(ctx,name,budget.day,budget.day,await numericSetting(ctx,setting,fallback,1000000000))});
 await ctx.db.patch(row._id,{extractionBudget:{...budget,settled:true}});return null;
}});
