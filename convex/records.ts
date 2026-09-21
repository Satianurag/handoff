import {followUpAccess} from "./followUpMailAccess";
import { v } from "convex/values";
import {internalMutation} from "./_generated/server";
import { paginationOptsValidator,paginationResultValidator } from "convex/server";
import { api,internal } from "./_generated/api";
import schema from "./schema";
import { userQuery,userMutation,internalUserQuery,internalUserMutation,member,fail,text,checkVersion,activeAssignee,timestamp,email } from "./model/access";
import { requireMailAccess } from "./model/mailAccess";
import { canReadRecordFor,recordAccess } from "./recordsAccess";
import { recordCategory } from "./recordsSchema";
import { generationWorkflow } from "./model/workflows";
import { limits,numericSetting,modelDayConfig } from "./model/limits";
import { priorRequest, saveRequest } from "./model/requests";
import type { WorkflowId } from "@convex-dev/workflow";
export const list=userQuery({args:{householdId:v.id("households"),search:v.optional(v.string()),category:v.optional(recordCategory),provider:v.optional(v.string()),dateFrom:v.optional(v.string()),dateTo:v.optional(v.string()),visitId:v.optional(v.id("visits")),paginationOpts:paginationOptsValidator},returns:paginationResultValidator(schema.doc("records")),handler:async(ctx,args)=>{
 await member(ctx,args.householdId);const search=args.search?.trim(),provider=args.provider?text(args.provider,"Doctor or source",200).toLowerCase():"";
 for(const date of [args.dateFrom,args.dateTo])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))fail("INVALID_DATE","Use a valid YYYY-MM-DD date.");if(args.dateFrom&&args.dateTo&&args.dateFrom>args.dateTo)fail("INVALID_RANGE","End date must be on or after the start date.");
 if(args.visitId){const visit=await ctx.db.get(args.visitId);if(!visit||visit.householdId!==args.householdId)fail("NOT_FOUND","Visit unavailable.");}
 const base=search?ctx.db.query("records").withSearchIndex("search_text",q=>{const match=q.search("searchText",text(search,"Search",200)).eq("householdId",args.householdId);return args.category?match.eq("category",args.category):match;}):args.category?ctx.db.query("records").withIndex("by_householdId_and_category",q=>q.eq("householdId",args.householdId).eq("category",args.category!)).order("desc"):ctx.db.query("records").withIndex("by_householdId",q=>q.eq("householdId",args.householdId)).order("desc");
 const page=await base.paginate(args.paginationOpts),visible=[];for(const row of page.page){if(!await canReadRecordFor(ctx,row,ctx.user._id))continue;if(provider&&!(row.provider??"").toLowerCase().includes(provider))continue;if(args.dateFrom&&(!row.documentDate||row.documentDate<args.dateFrom))continue;if(args.dateTo&&(!row.documentDate||row.documentDate>args.dateTo))continue;if(args.visitId&&!await ctx.db.query("recordVisitLinks").withIndex("by_recordId_and_visitId",q=>q.eq("recordId",row._id).eq("visitId",args.visitId!)).unique())continue;visible.push(row);}return {...page,page:visible};
}});
export const detail=userQuery({args:{recordId:v.id("records")},returns:v.union(v.object({record:schema.doc("records"),versions:v.array(schema.doc("recordVersions").omit("storageId")),proposals:v.array(schema.doc("recordProposals")),visits:v.array(v.object({_id:v.id("visits"),title:v.string(),confirmedStartsAt:v.number(),timezone:v.string()}))}),v.null()),handler:async(ctx,args)=>{
 const found=await ctx.db.get(args.recordId);if(!found)return null;await member(ctx,found.householdId);if(!await canReadRecordFor(ctx,found,ctx.user._id))return null;
 const versions=await ctx.db.query("recordVersions").withIndex("by_recordId",q=>q.eq("recordId",found._id)).order("desc").take(50);
 const proposals=found.currentVersionId?await ctx.db.query("recordProposals").withIndex("by_versionId",q=>q.eq("versionId",found.currentVersionId!)).take(40):[];
 const links=await ctx.db.query("recordVisitLinks").withIndex("by_recordId",q=>q.eq("recordId",found._id)).take(100);const visits=[];for(const link of links){const visit=await ctx.db.get(link.visitId);if(visit)visits.push({_id:visit._id,title:visit.title,confirmedStartsAt:visit.confirmedStartsAt,timezone:visit.timezone});}
 return {record:found,versions:versions.map(({storageId,...row})=>row),proposals,visits};
}});
export const update=userMutation({args:{recordId:v.id("records"),expectedVersion:v.number(),title:v.string(),provider:v.optional(v.string()),category:recordCategory,documentDate:v.optional(v.string()),notes:v.string(),readerIds:v.array(v.id("users"))},returns:v.null(),handler:async(ctx,args)=>{
 const row=await recordAccess(ctx,args.recordId,true);checkVersion(row,args.expectedVersion);if(args.readerIds.length>30)fail("INVALID_INPUT","Choose at most 30 readers.");for(const id of args.readerIds){await activeAssignee(ctx,row.householdId,id);const reader=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",row.householdId).eq("userId",id)).unique();if(reader&&"accessPreset" in reader&&reader.accessPreset==="limited_helper")fail("INVALID_READER","Limited helpers cannot receive medical record access. Change their access preset before sharing records.");}
 if(args.documentDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(args.documentDate)||!Number.isFinite(Date.parse(args.documentDate))||new Date(args.documentDate).toISOString().slice(0,10)!==args.documentDate))fail("INVALID_DATE","Use YYYY-MM-DD.");
 const title=text(args.title,"Title",200),notes=text(args.notes,"Notes",5000,true),provider=text(args.provider??row.provider??"","Doctor or source",200,true);
 await ctx.db.patch(row._id,{title,provider,category:args.category,notes,documentDate:args.documentDate,readerIds:[...new Set(args.readerIds)],readerGrantedAt:Object.fromEntries([...new Set(args.readerIds)].map(id=>[id,Date.now()])),version:row.version+1,updatedAt:Date.now(),searchText:`${title} ${provider} ${notes} ${args.category} ${row.extractedText??""}`});return null;
}});
export const remove=userMutation({args:{recordId:v.id("records"),expectedVersion:v.number()},returns:v.null(),handler:async(ctx,args)=>{
 const row=await recordAccess(ctx,args.recordId,true);checkVersion(row,args.expectedVersion);if(row.workflowId)await generationWorkflow.cancel(ctx,row.workflowId as WorkflowId);
 for(const p of await ctx.db.query("recordProposals").withIndex("by_recordId",q=>q.eq("recordId",row._id)).take(2000))await ctx.db.delete(p._id);
 for(const file of await ctx.db.query("recordVersions").withIndex("by_recordId",q=>q.eq("recordId",row._id)).take(50)){await ctx.storage.delete(file.storageId);await ctx.db.delete(file._id);}for(const table of ["recordVisitLinks","recordShares","recordMailOrigins"] as const)for(const linked of await ctx.db.query(table).withIndex("by_recordId",q=>q.eq("recordId",row._id)).take(100))await ctx.db.delete(linked._id);await ctx.db.delete(row._id);return null;
}});
export const review=userMutation({args:{proposalId:v.id("recordProposals"),decision:v.union(v.literal("approve"),v.literal("dismiss")),editedText:v.optional(v.string())},returns:v.null(),handler:async(ctx,args)=>{
 const p=await ctx.db.get(args.proposalId);if(!p)fail("NOT_FOUND","Suggestion unavailable.");const row=await recordAccess(ctx,p.recordId,true);if(p.versionId!==row.currentVersionId)fail("STALE_SOURCE","Review the current document version.");if(p.taskId&&(args.decision==="dismiss"||(args.editedText!==undefined&&args.editedText!==p.text)))fail("LINKED_TASK","This suggestion has a task. Cancel the task separately if it is no longer needed.");
 await ctx.db.patch(p._id,{status:args.decision==="approve"?"approved":"dismissed",text:args.editedText===undefined?p.text:text(args.editedText,"Reviewed text",4000),reviewedBy:ctx.user._id,reviewedAt:Date.now()});
 const suggestions=await ctx.db.query("recordProposals").withIndex("by_versionId",q=>q.eq("versionId",p.versionId)).take(40);const extractedText=suggestions.map(item=>`${item.title} ${item.text} ${item.quote}`).join("\n").slice(0,200000);
 await ctx.db.patch(row._id,{status:suggestions.some(item=>item.status==="pending")?"review":"filed",version:row.version+1,updatedAt:Date.now(),extractedText,searchText:`${row.title} ${row.provider??""} ${row.notes} ${row.category} ${extractedText}`});return null;
}});
export const extract=userMutation({args:{recordId:v.id("records")},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
 const row=await recordAccess(ctx,args.recordId,true);const {household}=await member(ctx,row.householdId);if(!household.aiProcessing)fail("CONSENT_REQUIRED","Enable AI processing in privacy settings before extracting documents.");if(row.status==="extracting")return null;if(!row.currentVersionId)fail("NO_FILE","Upload a file first.");
 if(await ctx.db.query("recordProposals").withIndex("by_versionId",q=>q.eq("versionId",row.currentVersionId!)).first())return null;
 const pause=await ctx.db.query("operatorSettings").withIndex("by_key",q=>q.eq("key","pauseAutomaticOperations")).unique();if(pause?.enabled)fail("PAUSED","Automatic processing is paused. Your original is still available.");
 const file=await ctx.db.get(row.currentVersionId!);if(!file)fail("NO_FILE","Original unavailable.");
 const day=new Date().toISOString().slice(0,10),input=Math.min(500000,(file.pages??100)*4096+2048),output=Math.min(65536,16384+Math.max(0,(file.pages??100)-1)*2048);
 try{
 await limits.limit(ctx,"modelInput",{key:day,count:input,config:await modelDayConfig(ctx,"modelInput",day,day,await numericSetting(ctx,"dailyModelInputTokens",1000000,1000000000)),throws:true});
 await limits.limit(ctx,"modelOutput",{key:day,count:output,config:await modelDayConfig(ctx,"modelOutput",day,day,await numericSetting(ctx,"dailyModelOutputTokens",100000,1000000000)),throws:true});
 await limits.limit(ctx,"householdGenerations",{key:`${row.householdId}:${day}`,config:await modelDayConfig(ctx,"householdGenerations",`${row.householdId}:${day}`,day,await numericSetting(ctx,"dailyHouseholdGenerations",40)),throws:true});
 }catch{fail("MODEL_ALLOWANCE_UNAVAILABLE","Document processing has reached its current allowance. Your original is saved; review it manually or try again after the allowance resets.");}
 const workflowId=await generationWorkflow.start(ctx,internal.recordsWorkflow.extract,{recordId:row._id,versionId:row.currentVersionId},{startAsync:true,onComplete:internal.recordsWorkflow.completed,context:{recordId:row._id}});
 await ctx.db.patch(row._id,{status:"extracting",safeError:undefined,workflowId,extractionBudget:{day,input,output,settled:false},updatedAt:Date.now()});return null;
}});
export const authorizeUpload=internalUserQuery({args:{householdId:v.id("households"),recordId:v.optional(v.id("records"))},returns:v.null(),handler:async(ctx,args)=>{await member(ctx,args.householdId);if(args.recordId){const row=await recordAccess(ctx,args.recordId,true);if(row.householdId!==args.householdId)fail("NOT_FOUND","Record unavailable.");}return null;}});
async function retainMailOrigin(ctx:import("./model/access").UserMutationCtx,file:import("./_generated/dataModel").Doc<"recordVersions">,messageId?:import("./_generated/dataModel").Id<"mailMessages">,attachmentId?:string){
 if(!messageId||!attachmentId)return;
 const prior=await ctx.db.query("recordMailOrigins").withIndex("by_recordId_and_messageId_and_attachmentId",q=>q.eq("recordId",file.recordId).eq("messageId",messageId).eq("attachmentId",attachmentId)).unique();if(prior)return;
 if((await ctx.db.query("recordMailOrigins").withIndex("by_recordId",q=>q.eq("recordId",file.recordId)).take(100)).length>=100)fail("LIMIT","This record already retains one hundred email origins.");
 await ctx.db.insert("recordMailOrigins",{householdId:file.householdId,recordId:file.recordId,versionId:file._id,messageId,attachmentId,importedBy:ctx.user._id,importedAt:Date.now()});
}
export const saveUpload=internalUserMutation({args:{householdId:v.id("households"),recordId:v.optional(v.id("records")),storageId:v.id("_storage"),title:v.string(),category:recordCategory,filename:v.string(),mimeType:v.string(),bytes:v.number(),sha256:v.string(),pages:v.number(),sourceMessageId:v.optional(v.id("mailMessages")),sourceAttachmentId:v.optional(v.string())},returns:v.id("records"),handler:async(ctx,args)=>{
 await member(ctx,args.householdId);const title=text(args.title,"Title",200),filename=text(args.filename,"Filename",240);let recordId=args.recordId;
 if(!Number.isSafeInteger(args.bytes)||args.bytes<1||args.bytes>10*1024*1024||!Number.isSafeInteger(args.pages)||args.pages<1||args.pages>100||!/^([0-9a-f]{64})$/.test(args.sha256))fail("INVALID_FILE","File validation failed.");
 if(args.sourceMessageId){await requireMailAccess(ctx,args.householdId);const message=await ctx.db.get(args.sourceMessageId);const thread=message?await ctx.db.get(message.threadId):null;const {household}=await member(ctx,args.householdId);if(!message||message.householdId!==args.householdId||message.retiring||!thread||thread.deleting||thread.quarantined||!household.emailImport)fail("NOT_FOUND","Message unavailable for import.");}
 const prior=await ctx.db.query("recordVersions").withIndex("by_householdId_and_uploadedBy_and_sha256",q=>q.eq("householdId",args.householdId).eq("uploadedBy",ctx.user._id).eq("sha256",args.sha256)).first();
 if(prior){const priorRecord=await ctx.db.get(prior.recordId);if(priorRecord&&await canReadRecordFor(ctx,priorRecord,ctx.user._id)){if(recordId&&recordId!==priorRecord._id)fail("DUPLICATE_FILE","This exact file is already saved as another record.");await retainMailOrigin(ctx,prior,args.sourceMessageId,args.sourceAttachmentId);if(args.storageId!==prior.storageId)await ctx.storage.delete(args.storageId);return prior.recordId;}}
 if(recordId){const row=await recordAccess(ctx,recordId,true);if(row.householdId!==args.householdId)fail("NOT_FOUND","Record unavailable.");if(row.status==="extracting")fail("BUSY","Wait for extraction before adding a version.");const versions=await ctx.db.query("recordVersions").withIndex("by_recordId",q=>q.eq("recordId",recordId!)).take(50);if(versions.length>=50)fail("LIMIT","This record already has 50 versions.");
 }else recordId=await ctx.db.insert("records",{householdId:args.householdId,title,category:args.category,notes:"",readerIds:[],createdBy:ctx.user._id,status:"filed",version:1,updatedAt:Date.now(),searchText:`${title} ${args.category}`});
 const versionId=await ctx.db.insert("recordVersions",{householdId:args.householdId,recordId,storageId:args.storageId,filename,mimeType:args.mimeType,bytes:args.bytes,uploadedBy:ctx.user._id,uploadedAt:Date.now(),sha256:args.sha256,pages:args.pages,sourceMessageId:args.sourceMessageId,sourceAttachmentId:args.sourceAttachmentId});await retainMailOrigin(ctx,(await ctx.db.get(versionId))!,args.sourceMessageId,args.sourceAttachmentId);const row=await ctx.db.get(recordId);await ctx.db.patch(recordId,{currentVersionId:versionId,status:"filed",safeError:undefined,extractedText:undefined,searchText:`${row!.title} ${row!.provider??""} ${row!.notes} ${row!.category}`,version:row!.version+1,updatedAt:Date.now()});return recordId;
}});
export const authorizeFile=internalUserQuery({args:{versionId:v.id("recordVersions")},returns:schema.doc("recordVersions"),handler:async(ctx,args)=>{const file=await ctx.db.get(args.versionId);if(!file)fail("NOT_FOUND","File unavailable.");await recordAccess(ctx,file.recordId);return file;}});


export const versionProposals=userQuery({args:{versionId:v.id("recordVersions")},returns:v.array(schema.doc("recordProposals")),handler:async(ctx,args)=>{
 const version=await ctx.db.get(args.versionId);if(!version)fail("NOT_FOUND","Version unavailable.");await recordAccess(ctx,version.recordId);return ctx.db.query("recordProposals").withIndex("by_versionId",q=>q.eq("versionId",version._id)).take(40);
}});
export const createTask=userMutation({args:{proposalId:v.id("recordProposals"),title:v.optional(v.string()),description:v.optional(v.string()),dueAt:v.optional(v.number()),assigneeId:v.optional(v.id("users")),acknowledgeHouseholdSharing:v.boolean()},returns:v.id("tasks"),handler:async(ctx,args):Promise<import("./_generated/dataModel").Id<"tasks">>=>{
 const proposal=await ctx.db.get(args.proposalId);if(!proposal)fail("NOT_FOUND","Suggestion unavailable.");const row=await recordAccess(ctx,proposal.recordId,true);
 if(proposal.taskId){const task=await ctx.db.get(proposal.taskId);if(task)return task._id;fail("TASK_REMOVED","The linked task was removed. Create a new task from Tasks if still needed.");}
 if(proposal.versionId!==row.currentVersionId||proposal.status!=="approved")fail("REVIEW_REQUIRED","Approve this suggestion against the current original first.");
 if(proposal.kind!=="followUp"&&proposal.kind!=="question")fail("INVALID_KIND","Only next steps and questions can become tasks. Medicines stay reviewed references.");
 if(!args.acknowledgeHouseholdSharing)fail("SHARING_CONFIRMATION","Confirm that the task text may be seen by everyone in this household. The original file remains private.");
 const title=text(args.title??proposal.title,"Task title",160),note=text(args.description??proposal.text,"Task note",4000,true);if(args.dueAt!==undefined)timestamp(args.dueAt);
 const taskId=await ctx.runMutation(api.tasks.create,{householdId:row.householdId,title,note,category:"logistics",dueAt:args.dueAt??null,requestedOwnerId:args.assigneeId??null,requestId:`record-proposal:${proposal._id}`});
 await ctx.db.patch(proposal._id,{taskId});return taskId;
}});
export const linkedVisit=userMutation({args:{recordId:v.id("records"),visitId:v.id("visits"),linked:v.boolean()},returns:v.null(),handler:async(ctx,args)=>{
 const row=await recordAccess(ctx,args.recordId,true),visit=await ctx.db.get(args.visitId);if(!visit||visit.householdId!==row.householdId)fail("NOT_FOUND","Visit unavailable.");
 const prior=await ctx.db.query("recordVisitLinks").withIndex("by_recordId_and_visitId",q=>q.eq("recordId",row._id).eq("visitId",visit._id)).unique();
 if(args.linked&&!prior){if((await ctx.db.query("recordVisitLinks").withIndex("by_recordId",q=>q.eq("recordId",row._id)).take(100)).length>=100)fail("LIMIT","A record can link to at most 100 visits.");await ctx.db.insert("recordVisitLinks",{householdId:row.householdId,recordId:row._id,visitId:visit._id,createdBy:ctx.user._id,createdAt:Date.now()});}
 if(!args.linked&&prior)await ctx.db.delete(prior._id);return null;
}});
export const forVisit=userQuery({args:{visitId:v.id("visits")},returns:v.array(schema.doc("records")),handler:async(ctx,args)=>{
 const visit=await ctx.db.get(args.visitId);if(!visit)fail("NOT_FOUND","Visit unavailable.");await member(ctx,visit.householdId);const links=await ctx.db.query("recordVisitLinks").withIndex("by_visitId",q=>q.eq("visitId",visit._id)).take(100);const rows=[];for(const link of links){const row=await ctx.db.get(link.recordId);if(row&&await canReadRecordFor(ctx,row,ctx.user._id))rows.push(row);}return rows;
}});
export const attachmentMessages=userQuery({args:{householdId:v.id("households"),threadId:v.optional(v.id("mailThreads")),paginationOpts:paginationOptsValidator},returns:paginationResultValidator(v.object({_id:v.id("mailMessages"),subject:v.string(),from:v.string(),occurredAt:v.number()})),handler:async(ctx,args)=>{
 await requireMailAccess(ctx,args.householdId);if(args.threadId){const thread=await ctx.db.get(args.threadId);if(!thread||thread.householdId!==args.householdId||thread.deleting||thread.quarantined)fail("NOT_FOUND","Conversation unavailable.");}const page=await (args.threadId?ctx.db.query("mailMessages").withIndex("by_threadId_and_occurredAt",q=>q.eq("threadId",args.threadId!)):ctx.db.query("mailMessages").withIndex("by_householdId",q=>q.eq("householdId",args.householdId))).order("desc").paginate(args.paginationOpts);const rows=[];for(const message of page.page){const thread=await ctx.db.get(message.threadId);if(thread&&!thread.deleting&&!thread.quarantined&&!message.retiring&&message.direction==="inbound")rows.push({_id:message._id,subject:message.subject,from:message.from,occurredAt:message.occurredAt});}return {...page,page:rows};
}});
export const authorizeMessage=internalUserQuery({args:{messageId:v.id("mailMessages"),followUpId:v.optional(v.id("followUps")),recordId:v.optional(v.id("records"))},returns:schema.doc("mailMessages"),handler:async(ctx,args)=>{
 const message=await ctx.db.get(args.messageId);if(!message)fail("NOT_FOUND","Message unavailable.");await requireMailAccess(ctx,message.householdId);const {household}=await member(ctx,message.householdId),thread=await ctx.db.get(message.threadId);if(!household.emailImport||message.retiring||message.direction!=="inbound"||!thread||thread.deleting||thread.quarantined)fail("NOT_FOUND","Message unavailable for import.");
 if(args.followUpId){const waiting=await followUpAccess(ctx,args.followUpId);if(waiting.householdId!==message.householdId||thread.followUpId!==waiting._id)fail("NOT_FOUND","Message no longer linked to this waiting item.");}
 if(args.recordId){const record=await recordAccess(ctx,args.recordId,true);if(record.householdId!==message.householdId)fail("NOT_FOUND","Record unavailable.");}return message;
}});

export const createShare=userMutation({args:{recordId:v.id("records"),versionId:v.id("recordVersions"),recipientEmail:v.string(),expiresAt:v.number(),requestId:v.string()},returns:v.id("recordShares"),handler:async(ctx,args)=>{
 const row=await recordAccess(ctx,args.recordId,true),version=await ctx.db.get(args.versionId);if(!version||version.recordId!==row._id)fail("NOT_FOUND","Version unavailable.");
 const recipientEmail=email(args.recipientEmail);timestamp(args.expiresAt);if(args.expiresAt<=Date.now()||args.expiresAt>Date.now()+7*86400000)fail("INVALID_EXPIRY","Choose an expiry within the next seven days.");
 const fingerprint=JSON.stringify({...args,recipientEmail}),prior=await priorRequest(ctx,"records.share",args.requestId,fingerprint);if(prior){const id=ctx.db.normalizeId("recordShares",prior.resultId);if(id)return id;}
 const shares=await ctx.db.query("recordShares").withIndex("by_recordId",q=>q.eq("recordId",row._id)).take(100);for(const old of shares)if(old.revokedAt||old.expiresAt<=Date.now())await ctx.db.delete(old._id);
 if(shares.filter(old=>!old.revokedAt&&old.expiresAt>Date.now()).length>=100)fail("LIMIT","This record has reached 100 active shares. Revoke unused shares before creating more.");
 const id=await ctx.db.insert("recordShares",{householdId:row.householdId,recordId:row._id,versionId:version._id,recipientEmail,createdBy:ctx.user._id,createdAt:Date.now(),expiresAt:args.expiresAt});await ctx.scheduler.runAt(args.expiresAt,internal.records.expireShare,{shareId:id});await saveRequest(ctx,"records.share",args.requestId,fingerprint,id);return id;
}});
const shareView=schema.doc("recordShares").pick("_id","recipientEmail","expiresAt","revokedAt","versionId","createdAt");
export const listShares=userQuery({args:{recordId:v.id("records")},returns:v.array(shareView),handler:async(ctx,args)=>{
 await recordAccess(ctx,args.recordId,true);const rows=await ctx.db.query("recordShares").withIndex("by_recordId",q=>q.eq("recordId",args.recordId)).order("desc").take(100);return rows.map(({_id,recipientEmail,expiresAt,revokedAt,versionId,createdAt})=>({_id,recipientEmail,expiresAt,revokedAt,versionId,createdAt}));
}});
export const revokeShare=userMutation({args:{shareId:v.id("recordShares")},returns:v.null(),handler:async(ctx,args)=>{
 const share=await ctx.db.get(args.shareId);if(!share)fail("NOT_FOUND","Share unavailable.");await recordAccess(ctx,share.recordId,true);if(!share.revokedAt)await ctx.db.patch(share._id,{revokedAt:Date.now()});return null;
}});
export async function sharedFile(ctx:import("./model/access").UserQueryCtx,shareId:import("./_generated/dataModel").Id<"recordShares">){
 const share=await ctx.db.get(shareId);if(!share||share.revokedAt||share.expiresAt<=Date.now()||ctx.user.isAnonymous||!ctx.user.emailVerificationTime||ctx.user.email?.trim().toLowerCase()!==share.recipientEmail)return null;
 const record=await ctx.db.get(share.recordId),file=await ctx.db.get(share.versionId),household=await ctx.db.get(share.householdId),creator=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",share.householdId).eq("userId",share.createdBy)).unique();
 const recipientMembership=await ctx.db.query("memberships").withIndex("by_householdId_and_userId",q=>q.eq("householdId",share.householdId).eq("userId",ctx.user._id)).unique();
 if(recipientMembership&&(recipientMembership.status!=="active"||("accessPreset" in recipientMembership&&recipientMembership.accessPreset==="limited_helper")||("privacyRevokedAt" in recipientMembership&&typeof recipientMembership.privacyRevokedAt==="number"&&share.createdAt<=recipientMembership.privacyRevokedAt)))return null;
 if(creator&&"privacyRevokedAt" in creator&&typeof creator.privacyRevokedAt==="number"&&share.createdAt<=creator.privacyRevokedAt)return null;
 if(!record||!file||file.recordId!==record._id||record.createdBy!==share.createdBy||household?.status!=="active"||creator?.status!=="active"||("accessPreset" in creator&&creator.accessPreset==="limited_helper"))return null;return {share,record,file};
}
export const shared=userQuery({args:{shareId:v.id("recordShares")},returns:v.union(v.object({title:v.string(),filename:v.string(),mimeType:v.string(),expiresAt:v.number(),versionId:v.id("recordVersions")}),v.null()),handler:async(ctx,args)=>{
 const data=await sharedFile(ctx,args.shareId);return data?{title:data.record.title,filename:data.file.filename,mimeType:data.file.mimeType,expiresAt:data.share.expiresAt,versionId:data.file._id}:null;
}});
export const authorizeSharedFile=internalUserQuery({args:{shareId:v.id("recordShares")},returns:schema.doc("recordVersions"),handler:async(ctx,args)=>{const data=await sharedFile(ctx,args.shareId);if(!data)fail("NOT_FOUND","Shared file unavailable, expired, or intended for another verified email account.");return data.file;}});

export const expireShare=internalMutation({args:{shareId:v.id("recordShares")},returns:v.null(),handler:async(ctx,args)=>{const share=await ctx.db.get(args.shareId);if(share&&!share.revokedAt&&share.expiresAt<=Date.now())await ctx.db.patch(share._id,{revokedAt:Date.now()});return null;}});
