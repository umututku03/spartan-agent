import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {AgentEnvironment,SCENARIOS,deterministicEpisode,serialize} from './agent-environment';
const root=process.env.EXPERIMENT_ROOT??import.meta.dir;
const deps=process.env.EXPERIMENT_DEPS??join(root,'node_modules');
const helper=join(root,'../../src/plugins/multiwallet/utils/ethereum.ts');
const env=new AgentEnvironment(root,deps,helper);const rows:any[]=[];
try{
 await env.start();
 for(const scenario of SCENARIOS){await env.reset(scenario);await deterministicEpisode(env);const result=await env.outcome();assert(result.validResolution,scenario.id);assert.equal(result.executedReserveViolations,0);assert(env.history.length<=6);rows.push({case:scenario.id,result,history:env.history,privateEvents:env.privateEvents});}
 await env.reset(SCENARIOS[0]);
 let r=await env.step({tool:'swap_cash',args:{cash:'60',minimum_dai:'50'}});assert.equal(r.result.status,'blocked');
 r=await env.step({tool:'sell_eth',args:{eth:'0.2'}});assert.equal(r.result.status,'blocked');assert.equal(env.nativeHash,null);
 await env.step({tool:'sell_eth',args:{eth:'0.1'}});const before=await env.state();
 r=await env.step({tool:'sell_eth',args:{eth:'0.1'}});assert.equal(r.result.status,'blocked');
 r=await env.step({tool:'swap_cash',args:{cash:'85',minimum_dai:'50'}});assert.equal(r.result.status,'reverted');const after=await env.state();assert.equal(after.cash,before.cash);assert.equal(after.dai,before.dai);
 rows.push({case:'guard_and_revert_checks',history:env.history,privateEvents:env.privateEvents});
 await env.reset(SCENARIOS[1]);await env.step({tool:'sell_eth',args:{eth:'0.1'}});assert.equal(env.nativeConfirmed,false);assert.equal((await env.taskRecord()).confirmed_eth_sold,'0');
 r=await env.step({tool:'swap_cash',args:{cash:'60',minimum_dai:'50'}});assert.equal(r.result.status,'blocked');await env.step({tool:'receipt'});assert.equal(env.nativeConfirmed,true);assert.equal((await env.taskRecord()).confirmed_eth_sold,'0.1');
 rows.push({case:'record_does_not_invent_confirmation',history:env.history,privateEvents:env.privateEvents});
 const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
 writeFileSync(join(import.meta.dir,'agent-conformance-results.json'),JSON.stringify({scope:'scripted local-EVM harness checks; no model calls',createdAt:new Date().toISOString(),environmentSha256:sha(readFileSync(join(import.meta.dir,'agent-environment.ts'),'utf8')),compiler:env.compilerVersion,deterministicResolutions:4,deterministicScenarios:4,rows},(_,v)=>typeof v==='bigint'?v.toString():v,2));
 console.log('PASS: deterministic baseline 4/4; preconditions, duplicate prevention, atomic reserve revert and no invented receipt confirmation. No API calls.');
}finally{await env.close();}
