// Controlled share authorization check. HANDOFF_VERIFY_RECIPIENT_EMAIL must name an existing
// verified test account on HANDOFF_VERIFY_DEPLOYMENT (default dev). CLI identity does not prove email delivery.
import {ConvexHttpClient} from 'convex/browser';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {api} from '../convex/_generated/api.js';
const deployment=process.env.HANDOFF_VERIFY_DEPLOYMENT??"dev";
const recipientEmail=process.env.HANDOFF_VERIFY_RECIPIENT_EMAIL?.trim().toLowerCase();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail??""))throw new Error("Set HANDOFF_VERIFY_RECIPIENT_EMAIL to an existing controlled verified test account.");
if(!process.env.CONVEX_URL)throw new Error("Set CONVEX_URL to the same deployment as HANDOFF_VERIFY_DEPLOYMENT.");
const exec=promisify(execFile),owner=new ConvexHttpClient(process.env.CONVEX_URL),reader=new ConvexHttpClient(process.env.CONVEX_URL),outcomes=[];
const assert=(v,m)=>{if(!v)throw new Error(m);},passed=name=>{outcomes.push(name);console.log(JSON.stringify({passed:name}));},rid=()=>crypto.randomUUID();
async function cli(args){const {stdout}=await exec('npx',['convex','run','--deployment',deployment,...args],{maxBuffer:2000000});return stdout.trim()?JSON.parse(stdout):null;}
let householdId,phase='controlled identity lookup',cleanupId;
try{
 const recipient=await cli(['--inline-query',`const user=await ctx.db.query("users").withIndex("email",q=>q.eq("email",${JSON.stringify(recipientEmail)})).unique(); return user?.emailVerificationTime&&!user.isAnonymous?{id:user._id,email:user.email}:null;`]);assert(recipient,'No existing verified controlled recipient on the selected deployment');
 const asRecipient=(name,args)=>cli([name,JSON.stringify(args),'--identity',JSON.stringify({subject:recipient.id})]);
 const a=await owner.action(api.auth.signIn,{provider:'anonymous'});owner.setAuth(a.tokens.token);householdId=await owner.action(api.demoTokens.create,{});const token=await owner.action(api.demoTokens.secondRoleLink,{householdId}),b=await reader.action(api.auth.signIn,{provider:'demo-role',params:{token}});reader.setAuth(b.tokens.token);const ownerId=(await owner.query(api.households.me,{})).id;
 phase='synthetic source and pack';await owner.mutation(api.care.saveProfile,{householdId,preferredName:'Synthetic pack recipient',dateOfBirth:'',allergiesState:'unknown',allergies:'',conditions:'',preferences:'',communication:'',emergencyInstructions:'',authorityStatement:'Synthetic live verification; no real patient.',authorizedUserIds:[],expectedVersion:0});
 const url=new URL('/records/file',process.env.CONVEX_URL.replace('.convex.cloud','.convex.site'));url.searchParams.set('householdId',householdId);url.searchParams.set('title','Synthetic share source');const upload=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${b.tokens.token}`,'Content-Type':'application/pdf','X-Filename':'synthetic-care-follow-up.pdf'},body:await readFile(new URL('../docs/synthetic-care-follow-up.pdf',import.meta.url))});assert(upload.ok,'Source upload failed');const {recordId}=await upload.json();
 async function grant(readerIds){const {record}=await reader.query(api.records.detail,{recordId});await reader.mutation(api.records.update,{recordId,expectedVersion:record.version,title:record.title,category:record.category,notes:record.notes,readerIds});}
 await grant([ownerId]);const visitId=await owner.mutation(api.visits.create,{householdId,title:'Synthetic shared visit',confirmedStartsAt:Date.now()+86400000,timezone:'UTC',confirmedAddress:'Synthetic clinic',phone:'',note:'',checklist:[],requestId:rid()});
 const packId=await owner.mutation(api.care.createVisitPack,{householdId,visitId,summary:'Synthetic immutable reviewed pack',documentIds:[recordId],questionIds:[],noteIds:[],includeMedicines:false,includeProfile:true,readerIds:[],requestId:rid()});const pack=await owner.query(api.care.getVisitPack,{packId});
 const make=expiresAt=>owner.mutation(api.careShares.create,{packId,recipientEmail:recipient.email,expiresAt,requestId:rid()});
 phase='positive verified recipient';const shareId=await make(Date.now()+3600000);assert(await owner.query(api.careShares.shared,{shareId})===null,'Wrong account received shared pack');const shared=await asRecipient('careShares:shared',{shareId});assert(shared?.pack.snapshot===pack.snapshot&&shared.pack._id===packId&&shared.creatorDisplayName,'Matching existing verified identity did not receive exact selected pack');assert(!('readerIds' in shared.pack)&&!('householdId' in shared.pack),'Receiver returned excess metadata');passed('verifiedRecipientExactSnapshotAndWrongAccountDenial');
 phase='revocation';await owner.mutation(api.careShares.revoke,{shareId});assert(await asRecipient('careShares:shared',{shareId})===null,'Revoked share returned snapshot');passed('explicitRevocation');
 phase='expiry and cache invalidation';const expiring=await make(Date.now()+7000);assert(await asRecipient('careShares:shared',{shareId:expiring}),'Expiring link unavailable before deadline');await new Promise(r=>setTimeout(r,8000));const shares=await owner.query(api.careShares.list,{packId});assert(shares.find(s=>s._id===expiring)?.revokedAt,'Scheduled expiry did not mutate share');assert(await asRecipient('careShares:shared',{shareId:expiring})===null,'Expired cached share remained readable');passed('scheduledExpiryInvalidatesSharedPayload');
 phase='source access revocation';const dependent=await make(Date.now()+3600000);assert(await asRecipient('careShares:shared',{shareId:dependent}),'Dependent share unavailable');await grant([]);assert(await asRecipient('careShares:shared',{shareId:dependent})===null,'Pack exposed after creator lost source record access');passed('SourceGrantRevocationInvalidatesPack');

}catch(error){console.error(JSON.stringify({failed:true,phase,message:String(error?.message??error).replace(/[^\s]{65,}/g,'[redacted]').slice(0,500)}));process.exitCode=1;}
finally{
 if(householdId)try{cleanupId=await owner.mutation(api.privacyJobs.request,{householdId,kind:'delete',confirmed:true,requestId:rid()});console.log(JSON.stringify({cleanupId,householdId}));}catch{console.error('Synthetic cleanup request failed');process.exitCode=1;}
 await Promise.allSettled([owner.action(api.auth.signOut,{}),reader.action(api.auth.signOut,{})]);console.log(JSON.stringify({outcomes,verificationMode:'Explicitly configured controlled verified user via official CLI admin identity; no email delivery exercised'}));
}
