"""Offline tests for verify-api-replication-results.py (revision 2). No API calls; mutates temporary copies only.
Requires the dry runs: bun run-api-replication.ts --model=opus|sol [--fault=refusal@6|http@7|transport@7|overbound@7]."""
from pathlib import Path
import importlib.util, tempfile, shutil, json, subprocess, sys
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('audit_r2',ROOT/'verify-api-replication-results.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
DRY=ROOT/'api-replication-dryrun'
def read(p):return json.loads(p.read_text())
def save(p,j):p.write_text(json.dumps(j,indent=2))
failures=[];report=[]
def check(name,ok,detail=''):
 report.append(dict(test=name,passed=bool(ok),detail=detail))
 if not ok:failures.append(name)

# 1. Positive cases: clean dry runs and correctly recorded fault paths are accepted and classified.
for model in ('opus','sol'):
 r=v.audit(str(DRY/model))
 check(f'{model}: clean dry run accepted as complete',r['status']=='complete' and r['episodes']==r['plannedEpisodes']==20 and r['invalidModelResponses']==0)
 r=v.audit(str(DRY/f'{model}-fault-refusal'))
 check(f'{model}: refusal is recorded, never executed, and the study continues',
  r['status']=='complete' and r['invalidModelResponses']==1 and r['episodes']==20)
 for kind in ('http','transport','overbound'):
  p=DRY/f'{model}-fault-{kind}';r=v.audit(str(p));eps=read(p/'episodes.json');last=eps[-1];l=read(p/'budget-ledger.json')
  ok=(r['status']=='partial_run_error' and r['interruptedEpisode']==last['id'] and last['termination']=='fatal_error'
   and len(last['toolTrace'])>=1 and len(last['modelTrace'])>=1 and last['outcome'] is not None)
  check(f'{model}: {kind} failure persists the interrupted episode with its partial trace and outcome',ok,
   dict(interrupted=r['interruptedEpisode'],steps=len(last['toolTrace'])))
  e=l['entries'][-1]
  if kind=='overbound':
   resp=read(p/f"response-{e['call']}.json")['response']['usage'];s=v.SETTINGS[read(p/'manifest-dryrun.json')['provider']]
   cost=(resp['input_tokens']*s['pin']+resp['output_tokens']*s['pout'])/1e6
   check(f'{model}: usage above the bound is settled at its known cost before stopping',
    e['status']=='settled' and e['assumptionExceeded'] and abs(e['estimatedUSD']-cost)<1e-12 and resp['input_tokens']>e['inputTokenBound'])
  elif kind=='http':check(f'{model}: HTTP failure keeps its reservation with the saved error response',e['status']=='http_error_reservation_kept' and (p/f"response-{e['call']}.json").exists())
  else:check(f'{model}: transport failure keeps its reservation without a response file',e['status']=='unknown_transport_outcome_reservation_kept' and not (p/f"response-{e['call']}.json").exists())

# 2. The review's six mutations must now all be rejected.
rv=subprocess.run([sys.executable,'review-api-verifier.py'],cwd=ROOT,capture_output=True,text=True)
out=json.loads(rv.stdout) if rv.stdout.strip().startswith('{') else {'results':[]}
check('review-api-verifier.py: all six tampered copies rejected',rv.returncode==0 and len(out['results'])==6 and not any(x['tamperedCopyAccepted'] for x in out['results']),
 [x['test'] for x in out['results'] if x['tamperedCopyAccepted']] or rv.stderr[-300:])

# 3. Additional mutations: each must be rejected.
def first_model_call(p,episode_filter=lambda e:True):
 return next(e for e in read(p/'budget-ledger.json')['entries'] if episode_filter(e))
def m_reservation(p):
 j=read(p/'budget-ledger.json');j['entries'][3]['reservationUSD']*=0.5;save(p/'budget-ledger.json',j)
def m_usage(p):
 f=p/'response-2.json';j=read(f);j['response']['usage']['output_tokens']+=1;save(f,j)
 e=read(p/'episodes.json')
 for ep in e:
  for t in ep.get('modelTrace') or []:
   if t['call']==2:t['response']=j['response']
 save(p/'episodes.json',e)
def m_duplicate_entry(p):
 j=read(p/'budget-ledger.json');j['entries'].insert(1,dict(j['entries'][1]));j['calls']+=1;save(p/'budget-ledger.json',j)
def m_extra_file(p):save(p/'api-error-1.json',{'httpStatus':500})
def m_both_markers(p):save(p/'run-error.json',{'error':'x','interruptedEpisode':None,'calls':0,'cumulativeEstimatedUSD':0})
def m_complete_flag(p):
 j=read(p/'complete.json');k=next(iter(j['filesUnchanged']));j['filesUnchanged'][k]=False;save(p/'complete.json',j)
def m_reorder(p):
 e=read(p/'episodes.json');e[4],e[5]=e[5],e[4];save(p/'episodes.json',e)
def m_assistant_replay(p):
 for f in sorted(p.glob('request-before-*.json'),key=lambda f:int(f.stem.split('-')[-1])):
  j=read(f);msgs=j['payload'].get('messages',[])
  if len(msgs)>=3:
   for b in msgs[1]['content']:
    if b['type']=='tool_use':b['input']={'eth':'0.2'}
   save(f,j);return
def m_rounds_remaining(p):
 f=p/'request-before-2.json';j=read(f);item=j['payload']['input'][-1]
 d=json.loads(item['content']);d['rounds_remaining']=8;item['content']=json.dumps(d);save(f,j)
def m_drop_interrupted(p):
 e=read(p/'episodes.json');save(p/'episodes.json',e[:-1])
def m_breach_flag(p):
 j=read(p/'budget-ledger.json');j['entries'][-1]['assumptionExceeded']=False;save(p/'budget-ledger.json',j)
def m_keep_reservation(p):
 j=read(p/'budget-ledger.json');e=j['entries'][-1];j['cumulativeEstimatedUSD']+=e['reservationUSD']-e['estimatedUSD']
 e['status']='unknown_transport_outcome_reservation_kept';e.pop('estimatedUSD');save(p/'budget-ledger.json',j)
def m_invalid_as_finish(p):
 e=read(p/'episodes.json');ep=next(x for x in e if x.get('termination')=='invalid_model_response');ep['termination']='declared_finish';save(p/'episodes.json',e)
def m_quote_result(p):
 e=read(p/'episodes.json')
 for ep in e:
  for t in ep['toolTrace']:
   if t['action']['tool']=='quote':t['result']['dai']='50.5';save(p/'episodes.json',e);return
def m_prior_link(p):
 j=read(p/'budget-ledger.json');j['priorEstimatedUSD']=0;save(p/'budget-ledger.json',j)
def m_unflagged_cap(p):
 m=read(p/'manifest-dryrun.json');m['approvedCohortUSD']=0.0001;save(p/'manifest-dryrun.json',m)
# Byte-preserving variants show that provenance reconstruction, not only the byte recount, rejects altered content.
def m_same_bytes_rounds(p):
 f=p/'request-before-2.json';j=read(f);b=j['payload']['messages'][0]['content'][1]
 d=json.loads(b['text']);d['rounds_remaining']=7;b['text']=json.dumps(d,separators=(',',':'));save(f,j)
def m_same_bytes_observation(p):
 f=p/'request-before-1.json';j=read(f);b=j['payload']['messages'][0]['content'][0]
 b['text']=b['text'].replace('"cash_balance":"0"','"cash_balance":"9"');save(f,j)
def m_orphan_request(p):
 # A failed attempt for an episode that is not in episodes.json, with a private label, in an otherwise consistent partial run.
 (p/'complete.json').unlink();(p/'summary.json').unlink()
 j=read(p/'budget-ledger.json');n=j['calls']+1;req=read(p/'request-before-1.json');req.update(call=n,episodeId='unfinished-transport-attempt')
 opening=json.loads(req['payload']['messages'][0]['content'][0]['text']);opening['scenario']='price_change_infeasible'
 req['payload']['messages'][0]['content'][0]['text']=json.dumps(opening);save(p/f'request-before-{n}.json',req)
 j['entries'].append(dict(call=n,episodeId='unfinished-transport-attempt',round=0,visibleBytes=req['visibleBytes'],priorOutputTokens=0,
  inputTokenBound=req['inputTokenBound'],reservationUSD=.001,status='unknown_transport_outcome_reservation_kept'))
 j['calls']=n;j['cumulativeEstimatedUSD']+=.001;save(p/'budget-ledger.json',j)
 save(p/'run-error.json',dict(error='synthetic transport failure',interruptedEpisode=None,calls=n,cumulativeEstimatedUSD=j['cumulativeEstimatedUSD']))
MUTATIONS=[('opus','same-byte rounds_remaining edit',m_same_bytes_rounds),('opus','same-byte initial observation edit',m_same_bytes_observation),
 ('opus','orphan failed request with private label',m_orphan_request),
 ('opus','ledger reservation altered',m_reservation),('opus','returned usage altered',m_usage),
 ('opus','duplicate ledger entry',m_duplicate_entry),('opus','unexplained extra file',m_extra_file),
 ('opus','complete.json and run-error.json both present',m_both_markers),('opus','completion flag false',m_complete_flag),
 ('opus','episode order differs from plan',m_reorder),('opus','assistant replay edited in a later request',m_assistant_replay),
 ('sol','rounds_remaining altered',m_rounds_remaining),('sol','quote result altered',m_quote_result),
 ('opus','prior-ledger amount altered',m_prior_link),('opus','manifest caps altered',m_unflagged_cap),
 ('opus-fault-http','interrupted episode dropped',m_drop_interrupted),('opus-fault-overbound','breach flag cleared',m_breach_flag),
 ('opus-fault-overbound','known usage replaced by kept reservation',m_keep_reservation),
 ('sol-fault-refusal','invalid response relabelled as finish',m_invalid_as_finish)]
base=Path(tempfile.mkdtemp(prefix='api-verifier-r2-'))
for folder,name,mutate in MUTATIONS:
 p=base/(folder+'-'+name.replace(' ','_'));shutil.copytree(DRY/folder,p);mutate(p)
 try:v.audit(str(p));rejected=False;why=''
 except Exception as error:rejected=True;why=f'{type(error).__name__}: {error}'[:160]
 check(f'mutation rejected: {folder}: {name}',rejected,why)
shutil.rmtree(base)
print(json.dumps(dict(scope='offline verifier tests; temporary copies only; no API calls',passed=len(report)-len(failures),failed=failures,tests=report),indent=2))
sys.exit(1 if failures else 0)
