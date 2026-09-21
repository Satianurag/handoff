export const coverageLabels={planned:'Unassigned plan',committed:'Committed',active:'Active now',ended:'Ended',cancelled:'Cancelled'};
export function coverageControls(block,{userId,isOwner,currentCoverageId},now=Date.now()){
 const closed=['ended','cancelled'].includes(block.state),unstarted=['planned','committed'].includes(block.state),expired=block.endsAt<=now,conflict=currentCoverageId&&currentCoverageId!==block._id;
 const mine=!block.plannedOwnerId||block.plannedOwnerId===userId;
 return {closed,volunteer:block.state==='planned',withdraw:block.state==='committed'&&block.plannedOwnerId===userId,start:unstarted&&mine&&!expired&&!conflict,end:block.state==='active'&&(block.activeOwnerId===userId||isOwner),cancel:unstarted,
 notice:closed?'':block.state==='active'&&expired?'The planned end has passed. Coverage remains active until someone explicitly ends it or accepts a handover.':unstarted&&expired?'The planned end has passed. Edit the end time before starting coverage.':unstarted&&conflict?'Another coverage block is active. End it or accept an explicit handover before starting this block.':unstarted&&!mine?'Another member committed to this coverage. They can offer it in a handover.':''};
}
