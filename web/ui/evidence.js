import {esc} from './core.js';
export function evidenceHtml(text,proposals){
 const spans=proposals.filter(p=>Number.isInteger(p.quoteStart)&&Number.isInteger(p.quoteEnd)&&p.quoteStart>=0&&p.quoteEnd>p.quoteStart&&p.quoteEnd<=text.length&&text.slice(p.quoteStart,p.quoteEnd)===p.quote).map(p=>[p.quoteStart,p.quoteEnd]).sort((a,b)=>a[0]-b[0]);
 const merged=[];for(const span of spans){const last=merged.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push([...span]);}
 let cursor=0,result='';for(const [start,end] of merged){result+=esc(text.slice(cursor,start))+'<mark>'+esc(text.slice(start,end))+'</mark>';cursor=end;}return result+esc(text.slice(cursor));
}
export function proposalCurrentValue(record,field){return record?.[{startsAt:'confirmedStartsAt',address:'confirmedAddress'}[field]||field]??null;}
export function proposalSupportsTarget(field,kind){return kind==='task'?['dueAt','note','title'].includes(field):kind==='visit'&&['startsAt','address','phone','note','title'].includes(field);}
