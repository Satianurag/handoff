// Reads used to prepare a save must fail immediately while disconnected. A
// queued date lookup must not turn an offline click into a later write.
export function workspaceRequests(ctx,client){
 const current=()=>{if(!ctx.alive)throw {data:{message:'This view is no longer active. Open the item again before continuing.'}};};
 const connected=()=>{current();if(!ctx.connected)throw {data:{message:'Reconnect before continuing. Your entries are still here.'}};};
 return {
  async query(name,args){current();if(ctx.household)connected();return client.query(name,args);},
  async mutate(name,args){connected();return client.mutation(name,args);},
  async action(name,args){connected();return client.action(name,args);},
 };
}
