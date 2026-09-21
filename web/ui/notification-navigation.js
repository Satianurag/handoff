// A selection lives only in memory and is bound to its account, household and
// destination. Loading the bell/list never acknowledges notifications.
let pending = null;
const queries = {
 task: ['tasks:get','taskId'], visit: ['visits:get','visitId'],
 coverage: ['coverage:get','coverageId'], handover: ['handovers:get','handoverId'],
 thread: ['threads:get','threadId'], source: ['sources:get','sourceId'],
 household: ['today:get','householdId'],
};
export function selectNotification(ctx,notification,href){
 pending=notification.readAt===null?{client:ctx.auth.client,viewerId:ctx.viewer.id,householdId:ctx.id,notificationId:notification._id,target:notification.target,href}:null;
}
export function acknowledgeNotification(ctx,name,args,href,onFailure){
 const item=pending,query=item&&queries[item.target.kind];
 if(!item||!ctx.alive||item.client!==ctx.auth.client||item.viewerId!==ctx.viewer.id||item.householdId!==ctx.id||item.href!==href||!query||name!==query[0]||args[query[1]]!==item.target.id)return;
 pending=null;
 Promise.resolve().then(()=>ctx.mutate('notifications:read',{notificationId:item.notificationId})).catch(()=>{if(ctx.alive)onFailure();});
}
export function notificationWatch(ctx,watch,onFailure){
 return (name,args,receive,error)=>watch(name,args,value=>{
  receive(value);
  if(value!=null)acknowledgeNotification(ctx,name,args,location.pathname+location.search,onFailure);
 },error);
}
