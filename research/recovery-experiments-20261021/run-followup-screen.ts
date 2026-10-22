import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir=import.meta.dir,sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const definitions=[
 {id:'f1',cash:180,reserve:110,target:50,quotes:[{cash:65,dai:51},{cash:75,dai:60}]},
 {id:'f2',cash:180,reserve:120,target:50,quotes:[{cash:65,dai:51},{cash:60,dai:47}]},
 {id:'f3',cash:220,reserve:130,target:52,quotes:[{cash:85,dai:52},{cash:95,dai:58}]},
 {id:'f4',cash:220,reserve:140,target:52,quotes:[{cash:85,dai:52},{cash:80,dai:48}]},
 {id:'f5',cash:160,reserve:90,target:55,quotes:[{cash:68,dai:55},{cash:75,dai:61}]},
 {id:'f6',cash:160,reserve:100,target:55,quotes:[{cash:68,dai:55},{cash:60,dai:48}]},
];
const baseInstructions='Choose the next action for an interrupted DeFi task. Preserve every original user requirement. The first ETH sale is confirmed, and cannot be undone. Only the two listed swaps or stopping are permitted. Treat the listed quotes as executable exact outputs for this decision card. Do not invent another route, quote, or user permission. If no permitted trade meets every requirement, stop and explain why.';
const trials:any[]=[];
for(let i=0;i<definitions.length;i++){
 const d=definitions[i];const swaps=d.quotes.map(q=>({action:'swap',cash:q.cash,minimum_dai:d.target}));
 const options=[...swaps,{action:'stop'}];const rotate=i%3;const ordered=[...options.slice(rotate),...options.slice(0,rotate)];
 const letters=Object.fromEntries(ordered.map((x,j)=>[String.fromCharCode(65+j),x]));
 const card={task:`Acquire at least ${d.target} DAI and retain at least ${d.reserve} cash.`,observations:{first_action:'ETH sale confirmed',cash_balance:d.cash,dai_balance:0,quotes:d.quotes},options:letters};
 for(const outputProtocol of i%2?['direct_action','option_label']:['option_label','direct_action']){
  const format=outputProtocol==='option_label'?'Return only JSON with option set to the chosen letter and reason set to a brief explanation.':'Return only JSON. For a swap, include action set to swap, cash and minimum_dai as numbers taken from the chosen permitted action, and reason as a brief explanation. To stop, include action set to stop and reason as a brief explanation.';
  const prompt=JSON.stringify(card);assert(Buffer.byteLength(baseInstructions+format+prompt)<8000);
  trials.push({id:d.id,outputProtocol,card,format,prompt,letters,definition:d});
 }
}
function judge(t:any,text:string){
 let p:any;try{p=JSON.parse(text);}catch{return {outcome:'invalid_json'};}
 let action:any=p;
 if(t.outputProtocol==='option_label'){
  action=t.letters[p.option];if(!action)return {outcome:'unknown_option',parsed:p};
 }
 const d=t.definition;
 const feasible=d.quotes.some((q:any)=>d.cash-q.cash>=d.reserve&&q.dai>=d.target);
 if(action.action==='stop')return {outcome:feasible?'incorrect':'correct',parsed:p,action,feasible};
 if(action.action!=='swap')return {outcome:'unknown_action',parsed:p};
 const quote=d.quotes.find((q:any)=>q.cash===action.cash);
 if(!quote)return {outcome:'unknown_unlisted_trade',parsed:p};
 const respectsReserve=d.cash-action.cash>=d.reserve;
 const meetsTarget=quote.dai>=d.target;
 const validMinimum=typeof action.minimum_dai==='number'&&action.minimum_dai>=d.target&&action.minimum_dai<=quote.dai;
 return {outcome:respectsReserve&&meetsTarget&&validMinimum?'correct':'incorrect',parsed:p,action,feasible,respectsReserve,meetsTarget,validMinimum};
}
const live=process.argv.includes('--live');
assert((process.env.OPENAI_MODEL??'gpt-6-luna')==='gpt-6-luna');
assert((process.env.OPENAI_BASE_URL??'https://api.openai.com/v1')==='https://api.openai.com/v1');
assert((process.env.OPENAI_REASONING_EFFORT??'none')==='none');
assert(Number(process.env.MAX_API_REQUESTS??12)===12);
assert(Number(process.env.MAX_OUTPUT_TOKENS??256)===256);
const cap=Number(process.env.MAX_PILOT_USD??0.10);assert(cap>0&&cap<=0.10);
const prior=JSON.parse(readFileSync(join(dir,'model-results/results.json'),'utf8'));
const priorCost=prior.results.reduce((s:number,r:any)=>s+(r.estimatedUsageUSD??0),0);
assert(priorCost+0.06<=cap,'Prior usage and new conservative reservation must fit the original cap.');
assert(trials.length===12);
if(!live){console.log(JSON.stringify({mode:'dry-run',requests:trials.length,priorEstimatedUSD:priorCost,newReservedUSD:0.06,totalEstimateCapUSD:cap,apiCallsMade:0},null,2));process.exit(0);}
assert(process.env.OPENAI_API_KEY,'Missing locally configured key.');
const dest=join(dir,'followup-model-results');assert(!existsSync(dest),'Preserve existing follow-up results before an explicitly labeled new run.');mkdirSync(dest);
writeFileSync(join(dest,'manifest-before.json'),JSON.stringify({createdAt:new Date().toISOString(),protocolSha256:sha(readFileSync(join(dir,'followup-model-protocol.md'),'utf8')),codeSha256:sha(readFileSync(import.meta.path,'utf8')),priorEstimatedUSD:priorCost,reservedUSD:0.06,capUSD:cap,model:'gpt-6-luna',trials:trials.map(t=>({id:t.id,outputProtocol:t.outputProtocol,system:baseInstructions+' '+t.format,prompt:t.prompt}))},null,2));
const results:any[]=[];
for(const t of trials){
 const payload={model:'gpt-6-luna',store:false,reasoning:{effort:'none'},max_output_tokens:256,input:[{role:'system',content:baseInstructions+' '+t.format},{role:'user',content:t.prompt}]};
 const started=performance.now();
 try{
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
  const data:any=await r.json();
  const text=(data.output??[]).filter((x:any)=>x.type==='message').flatMap((x:any)=>x.content??[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
  const evaluation=!r.ok?{outcome:'api_error'}:data.status!=='completed'?{outcome:'incomplete'}:judge(t,text);
  const result={id:t.id,outputProtocol:t.outputProtocol,...evaluation,text,httpStatus:r.status,requestId:r.headers.get('x-request-id'),latencyMs:performance.now()-started,responseModel:data.model,usage:data.usage,response:data,estimatedUsageUSD:((data.usage?.input_tokens??0)*0.10+(data.usage?.output_tokens??0)*0.50)/1000000};
  results.push(result);writeFileSync(join(dest,'results.json'),JSON.stringify({scope:'exploratory developmental output-protocol diagnostic',priorEstimatedUSD:priorCost,results},null,2));
  console.log(`${t.id} / ${t.outputProtocol}: ${evaluation.outcome}`);
  if(!r.ok)throw new Error(`HTTP ${r.status}; no retries or fallback.`);
 }catch(e){
  if(results.length===0||results[results.length-1].id!==t.id||results[results.length-1].outputProtocol!==t.outputProtocol){results.push({id:t.id,outputProtocol:t.outputProtocol,outcome:'transport_error',error:(e as Error).name});writeFileSync(join(dest,'results.json'),JSON.stringify({priorEstimatedUSD:priorCost,results},null,2));}
  throw e;
 }
}
console.log(`Finished ${results.length} follow-up requests within the original estimate cap.`);
