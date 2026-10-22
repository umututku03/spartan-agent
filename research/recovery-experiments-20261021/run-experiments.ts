import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import solc from 'solc';
import {createPublicClient,createWalletClient,http,custom,parseEther,parseUnits,formatUnits,maxUint256,type Address,type Hex} from 'viem';
import {foundry} from 'viem/chains';

const dir=import.meta.dir;
const sourcePath=resolve(process.argv[2]??'/Users/utkueumut/Desktop/utku/apps-projects/defi/spartan-agent/src/plugins/multiwallet/utils/ethereum.ts');
const out=join(dir,'results');mkdirSync(out,{recursive:true});
const json=(v:any)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2)+'\n';
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
const source=readFileSync(sourcePath,'utf8');
const begin=source.indexOf('export async function swapEthereumExactIn(');
const end=source.indexOf('\nexport async function transferEthereumAsset(',begin);
assert(begin>=0&&end>begin,'Helper source boundaries changed');
const body=source.slice(begin,end);
const js=new Bun.Transpiler({loader:'ts',target:'bun'}).transformSync(body.replace(/^export /,''));
const factory=new Function('getRpcUrl','getPublicClient','getWalletClient','resolveEthereumToken','parseEther','parseUnits','buildPath','UNISWAP_V2_ROUTER','UNISWAP_V2_ROUTER_ABI','mainnet','ensureAllowance','formatUnits',js+'\nreturn swapEthereumExactIn;');
const before={createdAt:new Date().toISOString(),classification:'exploratory synthetic local-EVM engineering study; no model calls',sourcePath,sourceSha256:sha(source),helperSha256:sha(body),bun:Bun.version,platform:process.platform,arch:process.arch,files:Object.fromEntries(['protocol.md','TestMarket.sol','run-experiments.ts','package-lock.json'].map(n=>[n,sha(readFileSync(join(dir,n),'utf8'))]))};
writeFileSync(join(out,'manifest-before.json'),json(before));
const compilerInput={language:'Solidity',sources:{'TestMarket.sol':{content:readFileSync(join(dir,'TestMarket.sol'),'utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const compiled=JSON.parse(solc.compile(JSON.stringify(compilerInput)));
const errors=(compiled.errors??[]).filter((e:any)=>e.severity==='error');assert.equal(errors.length,0,json(errors));
const artifacts=compiled.contracts['TestMarket.sol'];
writeFileSync(join(out,'compile.json'),json({compiler:solc.version(),settings:compilerInput.settings,warnings:(compiled.errors??[]).filter((e:any)=>e.severity!=='error'),contracts:Object.fromEntries(Object.entries(artifacts).map(([n,a]:any)=>[n,{abi:a.abi,bytecodeSha256:sha(a.evm.bytecode.object)}]))}));
const binary=join(dir,'node_modules','@foundry-rs',`anvil-${process.platform==='darwin'?'darwin':'linux'}-${process.arch==='arm64'?'arm64':'amd64'}`,'bin','anvil');
const port=18547;
const rpcURL=`http://127.0.0.1:${port}`;
const node=Bun.spawn([binary,'--silent','--host','127.0.0.1','--port',String(port),'--accounts','2','--balance','10','--chain-id','31337','--hardfork','cancun'],{stdout:Bun.file(join(out,'anvil.log')),stderr:Bun.file(join(out,'anvil-errors.log'))});
const rows:any[]=[];const traces:any[]=[];
let rpcId=0;
async function rpc(method:string,params:any[]=[]):Promise<any>{
 const r=await fetch(rpcURL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}),signal:AbortSignal.timeout(5000)});
 const j:any=await r.json();if(j.error)throw new Error(json(j.error));return j.result;
}
const client=createPublicClient({chain:foundry,transport:http(rpcURL,{retryCount:0}),pollingInterval:10});
let account:Address,spender:Address,wallet:any,other:any,cash:Address,dai:Address,market:Address;
const allTransactions:any[]=[];
const tokenABI=artifacts.TestToken.abi,marketABI=artifacts.TestMarket.abi;
async function tx(w:any,address:Address,abi:any,functionName:string,args:any[]=[]){
 const hash:Hex=await w.writeContract({address,abi,functionName,args,gas:600000n});
 const receipt=await client.waitForTransactionReceipt({hash,pollingInterval:10,timeout:5000});
 allTransactions.push({address,functionName,args,receipt});
 return receipt;
}
async function mustTx(w:any,address:Address,abi:any,fn:string,args:any[]=[]){
 const r=await tx(w,address,abi,fn,args);assert.equal(r.status,'success',fn);return r;
}
async function deploy(name:string,args:any[]=[]){
 const hash=await wallet.deployContract({abi:artifacts[name].abi,bytecode:('0x'+artifacts[name].evm.bytecode.object) as Hex,args,gas:6000000n});
 const r=await client.waitForTransactionReceipt({hash,pollingInterval:10,timeout:5000});assert.equal(r.status,'success');assert(r.contractAddress);return r.contractAddress;
}
async function balance(token:Address){return await client.readContract({address:token,abi:tokenABI,functionName:'balanceOf',args:[account]}) as bigint;}
async function balances(){return {cash:await balance(cash),dai:await balance(dai)};}
const U=1000000n,D=10n**18n,target=50n*D;
const q=(n:bigint,rc:bigint,rd:bigint)=>n*997n*rd/(rc*1000n+n*997n);
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
// Controller formula and evaluator enumeration are intentionally independent.
function inverseCent(rc:bigint,rd:bigint,t:bigint){return rd<=t?null:ceil(ceil(rc*t*1000n,997n*(rd-t)),10000n)*10000n;}
function oracle(rc:bigint,rd:bigint,budget:bigint){for(let cents=0n;cents*10000n<=budget;cents++)if(q(cents*10000n,rc,rd)>=target)return cents*10000n;return null;}
async function pool(rate:number){await mustTx(wallet,market,marketABI,'setPool',[10000n*U,10000n*D*BigInt(rate)/10000n]);}
async function swapCash(amount:bigint,floor:bigint,guarded=false){
 return guarded?tx(wallet,market,marketABI,'swapWithFloor',[amount,target,floor]):tx(wallet,market,marketABI,'swapExactTokensForTokens',[amount,target,[cash,dai],account,BigInt(Math.floor(Date.now()/1000)+1200)]);
}
function errorRecord(e:any){return {name:e?.name,message:e?.message,hash:e?.hash??null,ownKeys:Object.keys(e??{})};}
let snapshot:string;
async function save(){snapshot=await rpc('evm_snapshot');}
async function reset(){assert.equal(await rpc('evm_revert',[snapshot]),true);await save();}
function record(r:any,t:any[]){rows.push(r);traces.push({episode:r.episode,scenario:r.scenario,policy:r.policy,events:t,final:r});writeFileSync(join(out,'episodes.json'),json(rows));writeFileSync(join(out,'traces.json'),json(traces));}
function helper(waitClient:any,wrappedWallet:any){return factory(
 ()=>rpcURL,()=>waitClient,()=>wrappedWallet,
 async (s:string)=>s==='ETH'?{symbol:'ETH',decimals:18,isNative:true}:{symbol:'USDC',decimals:6,isNative:false,address:cash},
 parseEther,parseUnits,()=>['0x0000000000000000000000000000000000000001',cash],market,marketABI,foundry,
 ()=>{throw new Error('Allowance branch not used by E1');},formatUnits);
}
const request={privateKey:'LOCAL_UNLOCKED_ACCOUNT_NO_PRIVATE_KEY',inputToken:'ETH',outputToken:'USDC',amount:'0.1'};
async function experiment1(){
 console.log('E1: actual helper, mined transactions and receipt-visibility faults');
 await save();
 for(const mode of ['normal','pre_submission_rejection','pending_timeout','settled_timeout','confirmed_revert'])for(const policy of ['fresh_retry','stop_on_error','journal_reconcile']){
  await reset();await rpc('evm_setAutomine',[true]);
  if(mode==='confirmed_revert')await mustTx(wallet,market,marketABI,'setRejectNative',[true]);
  if(mode==='pending_timeout')await rpc('evm_setAutomine',[false]);
  let hidden=mode.endsWith('timeout'),first=true,attempts=0;const hashes:Hex[]=[];const events:any[]=[];
  const reader=createPublicClient({chain:foundry,pollingInterval:10,transport:custom({request:async({method,params}:any)=>hidden&&method==='eth_getTransactionReceipt'?null:rpc(method,params??[])},{retryCount:0})});
  const wrappedPublic={readContract:client.readContract,waitForTransactionReceipt:async({hash}:any)=>reader.waitForTransactionReceipt({hash,timeout:150,pollingInterval:10,retryCount:0})};
  const wrappedWallet={account:wallet.account,writeContract:async(args:any)=>{
   attempts++;
   if(first&&mode==='pre_submission_rejection'){first=false;throw new Error('Injected rejection before submission');}
   first=false;const hash=await wallet.writeContract({...args,gas:300000n});hashes.push(hash);events.push({kind:'submitted',hash});return hash;
  }};
  const swap=helper(wrappedPublic,wrappedWallet);
  let response:any,err:any=null,claimedSuccess=false;
  try{response=await swap(request);claimedSuccess=true;events.push({kind:'helper_success',hash:response.hash});}catch(e){err=errorRecord(e);events.push({kind:'helper_error',error:err});}
  // The transient revert condition clears after the first attempt for every policy.
  if(mode==='confirmed_revert')await mustTx(wallet,market,marketABI,'setRejectNative',[false]);
  if(!claimedSuccess&&policy==='fresh_retry'){
   try{response=await swap(request);claimedSuccess=true;}catch(e){events.push({kind:'retry_error',error:errorRecord(e)});}
  }
  // Shared scheduled fault resolution: pending transactions now mine; receipt visibility recovers.
  if(mode==='pending_timeout')await rpc('evm_mine');
  await rpc('evm_setAutomine',[true]);hidden=false;
  if(!claimedSuccess&&policy==='journal_reconcile'){
   let last:any=null;
   if(hashes.length){last=await client.getTransactionReceipt({hash:hashes[hashes.length-1]});events.push({kind:'reconciled_receipt',hash:last.transactionHash,status:last.status});}
   if(last?.status==='success')claimedSuccess=true;
   else if(!last||last.status==='reverted'){
    response=await swap(request);claimedSuccess=true;events.push({kind:'replacement_after_known_failure',hash:response.hash});
   }
  }
  const receipts=await Promise.all(hashes.map(hash=>client.getTransactionReceipt({hash})));
  const state=await balances();const successfulEffects=receipts.filter(r=>r.status==='success').length;
  record({experiment:'E1',episode:rows.length+1,scenario:mode,policy,feasible:true,taskCompleted:state.cash===200n*U,validCompletion:state.cash===200n*U&&claimedSuccess,claimedSuccess,attempts,submitted:hashes.length,successfulEffects,duplicateEffects:Math.max(0,successfulEffects-1),cash:state.cash,gas:receipts.reduce((s,r)=>s+r.gasUsed,0n),firstError:err},events.concat(receipts.map(r=>({kind:'receipt',receipt:r}))));
 }
 await reset();await rpc('evm_setAutomine',[true]);
}
async function setupPartial(){
 const swap=helper({readContract:client.readContract,waitForTransactionReceipt:client.waitForTransactionReceipt},wallet);
 const result=await swap(request);assert(result.hash);
 await mustTx(wallet,cash,tokenABI,'approve',[market,maxUint256]);
 await mustTx(wallet,cash,tokenABI,'approve',[spender,maxUint256]);
 assert.equal(await balance(cash),200n*U);await save();
}
async function experiment2(){
 console.log('E2: fixed continuation versus quote refresh and conventional resizing');
 await setupPartial();
 for(const rate of [5500,6000,6500,7000,7500,8000,9000,10000,11000])for(const reserve of [110,120,130,140])for(const policy of ['fixed_suffix','refresh_same_size','deterministic_resize']){
  await reset();await pool(rate);
  const floor=BigInt(reserve)*U,rc=10000n*U,rd=10000n*D*BigInt(rate)/10000n;
  const oracleAmount=oracle(rc,rd,200n*U-floor);const events:any[]=[];let amount=60n*U;let receipt:any=null;let safeStop=false;
  const observedRc=await client.readContract({address:market,abi:marketABI,functionName:'reserveCash'}) as bigint;
  const observedRd=await client.readContract({address:market,abi:marketABI,functionName:'reserveDai'}) as bigint;
  assert.equal(observedRc,rc);assert.equal(observedRd,rd);
  events.push({kind:'public_pool_observation',reserveCash:observedRc,reserveDai:observedRd});
  if(policy==='refresh_same_size'){
   const quoted=await client.readContract({address:market,abi:marketABI,functionName:'quote',args:[amount]}) as bigint;
   events.push({kind:'public_quote',amount,out:quoted});if(quoted<target)safeStop=true;
  }
  if(policy==='deterministic_resize'){
   const a=inverseCent(observedRc,observedRd,target);if(a===null||a>200n*U-floor)safeStop=true;else amount=a;
  }
  // Same reserve rule for all three policies at their proposal point.
  if(amount>200n*U-floor)safeStop=true;
  if(!safeStop){receipt=await swapCash(amount,floor);events.push({kind:'receipt',hash:receipt.transactionHash,status:receipt.status,gasUsed:receipt.gasUsed});}
  const b=await balances();const completed=b.dai>=target&&b.cash>=floor;
  assert(!completed||oracleAmount!==null,'Oracle mismatch: feasible success not found by independent enumeration');
  record({experiment:'E2',episode:rows.length+1,scenario:`rate-${rate}-reserve-${reserve}`,policy,rate,reserve,feasible:oracleAmount!==null,oracleCentAmount:oracleAmount,amount,safeStop,reverted:receipt?.status==='reverted',taskCompleted:completed,validCompletion:completed,reserveViolation:b.cash<floor,cash:b.cash,dai:b.dai,gas:receipt?.gasUsed??0n},events);
 }
 await reset();
}
async function experiment3(){
 console.log('E3: state changes after checks; execution predicate and ordinary recovery');
 // E2 reset leaves the common partial-task snapshot active.
 for(const rate of [7500,10000,12500])for(const drain of [0,10,20,40])for(const policy of ['planning_check','fresh_pre_submit_check','execution_floor','execution_floor_and_resize']){
  await reset();await pool(rate);const floor=120n*U;const events:any[]=[];let gas=0n;
  const pre=await balance(cash);assert(pre-80n*U>=floor);
  // Explicitly schedule a separately authorized spender after the final off-chain check.
  if(policy==='fresh_pre_submit_check')assert((await balance(cash))-80n*U>=floor);
  if(drain){const r=await mustTx(other,cash,tokenABI,'transferFrom',[account,spender,BigInt(drain)*U]);events.push({kind:'external_spend',hash:r.transactionHash,amount:BigInt(drain)*U});}
  const afterExternal=await balance(cash);assert(afterExternal>=floor,'External intervention must not itself breach the reserve');
  const rc=10000n*U,rd=10000n*D*BigInt(rate)/10000n,oracleAmount=oracle(rc,rd,afterExternal-floor);
  const guarded=policy.startsWith('execution_floor');
  let r=await swapCash(80n*U,floor,guarded);gas+=r.gasUsed;events.push({kind:'attempt_receipt',hash:r.transactionHash,status:r.status,gasUsed:r.gasUsed});const rejected=r.status==='reverted';
  let safeStop=false;
  if(rejected&&policy==='execution_floor_and_resize'){
   const observedRc=await client.readContract({address:market,abi:marketABI,functionName:'reserveCash'}) as bigint;
   const observedRd=await client.readContract({address:market,abi:marketABI,functionName:'reserveDai'}) as bigint;
   const observedCash=await balance(cash);
   events.push({kind:'public_recovery_observation',reserveCash:observedRc,reserveDai:observedRd,cash:observedCash});
   const a=inverseCent(observedRc,observedRd,target);
   if(a===null||a>observedCash-floor)safeStop=true;
   else{r=await swapCash(a,floor,true);gas+=r.gasUsed;events.push({kind:'recovery_receipt',hash:r.transactionHash,status:r.status,amount:a,gasUsed:r.gasUsed});}
  }
  const b=await balances();const completed=b.dai>=target&&b.cash>=floor;
  record({experiment:'E3',episode:rows.length+1,scenario:`rate-${rate}-drain-${drain}`,policy,rate,drain,feasible:oracleAmount!==null,oracleCentAmount:oracleAmount,initialGuardRejected:rejected,safeStop,taskCompleted:completed,validCompletion:completed,reserveViolation:b.cash<floor,externalCausedViolation:false,cash:b.cash,dai:b.dai,gas},events);
 }
 await reset();
}
try{
 let ready=false;for(let i=0;i<100;i++){try{if(await rpc('eth_chainId')==='0x7a69'){ready=true;break;}}catch{}await Bun.sleep(50);}assert(ready,'Local Anvil failed to start; check anvil-errors.log');
 [account,spender]=await rpc('eth_accounts');
 wallet=createWalletClient({account,chain:foundry,transport:http(rpcURL,{retryCount:0})});other=createWalletClient({account:spender,chain:foundry,transport:http(rpcURL,{retryCount:0})});
 cash=await deploy('TestToken',['CASH',6]);dai=await deploy('TestToken',['DAI',18]);market=await deploy('TestMarket',[cash,dai]);await pool(10000);
 writeFileSync(join(out,'deployment.json'),json({chainId:31337,rpcURL,account,spender,cash,dai,market,anvilVersion:await new Response(Bun.spawn([binary,'--version'],{stdout:'pipe'}).stdout).text()}));
 await experiment1();await experiment2();await experiment3();
 writeFileSync(join(out,'transactions.json'),json(allTransactions));
 const groups:any[]=[];
 for(const experiment of ['E1','E2','E3'])for(const policy of [...new Set(rows.filter(r=>r.experiment===experiment).map(r=>r.policy))]){
  const rs=rows.filter(r=>r.experiment===experiment&&r.policy===policy),fs=rs.filter(r=>r.feasible);
  groups.push({experiment,policy,episodes:rs.length,feasible:fs.length,validCompletion:rs.filter(r=>r.validCompletion).length,feasibleCompletion:fs.filter(r=>r.validCompletion).length,infeasibleCompletion:rs.filter(r=>!r.feasible&&r.validCompletion).length,reserveViolations:rs.filter(r=>r.reserveViolation).length,duplicateEffects:rs.reduce((s,r)=>s+(r.duplicateEffects??0),0),safeStops:rs.filter(r=>r.safeStop).length,totalGas:rs.reduce((s,r)=>s+BigInt(r.gas),0n).toString()});
 }
 const summary={createdAt:new Date().toISOString(),episodes:rows.length,groups,scope:before.classification};
 writeFileSync(join(out,'summary.json'),json(summary));
 const columns=Object.keys(groups[0]);writeFileSync(join(out,'summary.csv'),columns.join(',')+'\n'+groups.map(g=>columns.map(k=>g[k]).join(',')).join('\n')+'\n');
 writeFileSync(join(out,'complete.json'),json({completedAt:new Date().toISOString(),sourceUnchanged:sha(readFileSync(sourcePath,'utf8'))===before.sourceSha256,protocolUnchanged:sha(readFileSync(join(dir,'protocol.md'),'utf8'))===before.files['protocol.md'],compiler:solc.version(),instrumentedRpcCalls:rpcId,episodes:rows.length}));
 console.log(json(summary));
}catch(e){writeFileSync(join(out,'run-error.json'),json({at:new Date().toISOString(),error:errorRecord(e),completedEpisodes:rows.length}));throw e;}
finally{node.kill();await node.exited;}
