import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components, internal } from "./_generated/api";
import { auth } from "./auth";

import * as recordFiles from "./recordsHttp";
const http = httpRouter();
for(const method of ["GET","POST"] as const)http.route({path:"/records/file",method,handler:recordFiles.file});
http.route({path:"/records/file",method:"OPTIONS",handler:recordFiles.options});
auth.addHttpRoutes(http);
http.route({
  pathPrefix: "/demo-fixtures/", method: "GET",
  handler: httpAction(async (ctx, request) => {
    const key = new URL(request.url).pathname.slice("/demo-fixtures/".length);
    const fixture = await ctx.runQuery(internal.demoFixtures.read, { key, now: Date.now() });
    if (!fixture) return new Response("Synthetic fixture unavailable.", { status: 404 });
    return new Response(fixture, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }),
});
http.route({path:"/agentmail/webhook",method:"POST",handler:httpAction(async(ctx,request)=>{
 const raw=await request.text();if(new TextEncoder().encode(raw).length>1000000)return new Response("Payload too large",{status:413});
 const id=request.headers.get("svix-id"),timestamp=request.headers.get("svix-timestamp"),signature=request.headers.get("svix-signature");
 if(!id||!timestamp||!signature||id.length>300||timestamp.length>100||signature.length>2000)return new Response("Invalid signature",{status:400});
 const status=await ctx.runAction(internal.agentmailWebhook.receive,{raw,id,timestamp,signature});
 return new Response(null,{status});
})});
registerStaticRoutes(http, components.staticHosting, { spaFallback: true });
export default http;
