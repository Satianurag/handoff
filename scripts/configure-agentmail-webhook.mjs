// Reads secrets into memory, sends the signing secret to the CLI over stdin,
// and prints only the endpoint identity. Never prints provider objects.
import {AgentMailClient} from "agentmail";
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,chmodSync} from "node:fs";
const production=process.argv.includes("--prod");
const site=production?"https://admired-fish-176.convex.site":"https://befitting-cobra-234.convex.site";
const provider=new AgentMailClient({apiKey:process.env.AGENTMAIL_API_KEY,maxRetries:0});
const url=site+"/agentmail/webhook";
const eventTypes=["message.received","message.received.unauthenticated","message.sent","message.delivered","message.bounced","message.rejected","message.complained"];
try{
 let existing,pageToken;
 do{const page=await provider.webhooks.list({limit:100,pageToken});existing=page.webhooks.find(w=>w.url===url);pageToken=page.nextPageToken;}while(!existing&&pageToken);
 const webhook=existing?await provider.webhooks.update(existing.webhookId,{eventTypes}):await provider.webhooks.create({url,eventTypes,clientId:`handoff-${production?"prod":"dev"}-events-v1`});
 const id=existing?.webhookId??webhook.webhookId;
 const secret=(await provider.webhooks.get(id)).secret;
 if(!secret)throw new Error("Missing signing secret");
 execFileSync("npx",["convex","env","set",...(production?["--prod"]:[]),"AGENTMAIL_WEBHOOK_SECRET"],{input:secret,stdio:["pipe","pipe","pipe"]});
 if(!production){const path=new URL("../.env.local",import.meta.url);let env=readFileSync(path,"utf8");env=env.replace(/^AGENTMAIL_WEBHOOK_SECRET=.*\n?/gm,"");writeFileSync(path,env.trimEnd()+`\nAGENTMAIL_WEBHOOK_SECRET=${secret}\n`,{mode:0o600});chmodSync(path,0o600);}
 console.log(JSON.stringify({configured:true,deployment:production?"prod":"dev",url,allFutureInboxes:true,eventTypes}));
}catch(error){console.error(JSON.stringify({configured:false,statusCode:typeof error?.statusCode==="number"?error.statusCode:null}));process.exitCode=1;}
