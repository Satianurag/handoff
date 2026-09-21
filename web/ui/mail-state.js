export function draftControls(draft,latestSend=null){
 const editable=!draft.correctionDraftId&&['editable','failed'].includes(draft.state);
 return {editable,ready:editable&&draft.state==='editable'&&!!draft.providerDraftId&&draft.providerSyncedVersion===draft.version&&!draft.syncToken,replace:editable&&(!latestSend||latestSend.state==='cancelled'),generate:editable&&draft.state==='editable'&&!draft.syncToken};
}
export function canCorrectSend(send){return !send.correctionDraftId&&['sent','failed'].includes(send.state)&&['bounced','rejected'].includes(send.delivery)&&!!send.body;}
export function mailboxSaveState(status){
 if(!status.editable)return {detail:'',retry:false,pending:false,tone:'neutral'};
 if(status.blocker)return {detail:{emailPaused:'Email processing is paused. Your draft is saved in Handoff. Open email settings before retrying.',mailboxUnavailable:'The household mailbox is unavailable. Your draft is saved in Handoff. Resolve mailbox setup before retrying.',senderNeedsReview:'This conversation needs sender review before its draft can be saved to the mailbox.'}[status.blocker],retry:false,pending:false,tone:'attention'};
 if(status.ready)return {detail:'This version is saved to the household mailbox.',retry:false,pending:false,tone:'success'};
 if(['queued','running'].includes(status.state))return {detail:'Saving this version to the household mailbox… Your draft remains saved in Handoff.',retry:false,pending:true,tone:'attention'};
 if(['failed','cancelled','needsReview'].includes(status.state)||status.lastError)return {detail:status.lastError||'Mailbox save did not finish. Your draft is saved in Handoff; retry its mailbox save.',retry:true,pending:false,tone:'error'};
 return {detail:'This version is saved in Handoff. Save it to the household mailbox before reviewing a send.',retry:true,pending:false,tone:'attention'};
}
export function draftSaveStatus(draft,ready){
 if(draft.correctionDraftId)return 'A corrected draft exists. This original message is retained with its send history.';
 if(draft.state==='sent')return 'Message sent. Delivery status appears in its receipt.';
 if(draft.state==='approved')return 'Approved for sending. Follow the send receipt for progress.';
 if(draft.state==='sending')return 'Sending or awaiting provider confirmation. Check the send receipt before taking another action.';
 if(draft.state==='generating')return 'Generating a draft. Your saved version remains available until generation finishes.';
 if(draft.lastError)return 'Mailbox save or send needs attention. Your draft is preserved.';
 return ready?'Saved to the household mailbox. Ready for your review.':'Saved in Handoff. Waiting for the household mailbox to save this version.';
}
