"""Adversarial offline audit: alter temporary fixture copies; never alter originals or call APIs.
Exit 1 means at least one invalid artifact was accepted by the reviewed verifier.
"""
from pathlib import Path
import importlib.util, tempfile, shutil, json, sys
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('reviewed_audit',ROOT/'verify-api-replication-results.py')
verifier=importlib.util.module_from_spec(spec);spec.loader.exec_module(verifier)
SOURCE=ROOT/'api-replication-dryrun/opus'
def read(p):return json.loads(p.read_text())
def save(p,j):p.write_text(json.dumps(j,indent=2))
def observation(p):
 opening=read(p/'request-before-1.json');episode=opening['episodeId']
 opening=json.loads(opening['payload']['messages'][0]['content'][0]['text'])
 opening['initial_observation']['cash_balance']='999'
 for f in p.glob('request-before-*.json'):
  j=read(f)
  if j['episodeId']==episode:
   j['payload']['messages'][0]['content'][0]['text']=json.dumps(opening);save(f,j)
def condition(p):
 ids={e['id'] for e in read(p/'episodes.json') if e['controller']=='history'}
 for f in p.glob('request-before-*.json'):
  j=read(f)
  if j['episodeId'] not in ids:continue
  for msg in j['payload']['messages']:
   if msg['role']!='user':continue
   for block in msg['content']:
    if block['type']!='text':continue
    d=json.loads(block['text'])
    if 'rounds_remaining' in d:
     d['explicit_task_record']={'remaining_dai':'0','current_cash':'999'};block['text']=json.dumps(d)
  save(f,j)
def action(p):
 j=read(p/'episodes.json');e=next(e for e in j if e.get('modelTrace') and any(t['action']['tool']=='swap_cash' for t in e['toolTrace']))
 t=next(t for t in e['toolTrace'] if t['action']['tool']=='swap_cash')
 assert t['action']['args']['minimum_dai']=='50'
 t['action']['args']['minimum_dai']='49'
 ev=next(ev for ev in e['privateEvents'] if ev['type']=='cash_swap_receipt');ev['minimum']=str(49*10**18)
 save(p/'episodes.json',j)
def ledger(p):
 j=read(p/'budget-ledger.json')
 for e in j['entries']:
  if e['status']=='settled':e['estimatedUSD']=0
 j['cumulativeEstimatedUSD']=j['priorEstimatedUSD'];save(p/'budget-ledger.json',j)
def complete(p):
 j=read(p/'complete.json');j['episodes']=999
 j['filesUnchanged']={k:False for k in j['filesUnchanged']};save(p/'complete.json',j)
def orphan(p):
 (p/'complete.json').unlink()
 j=read(p/'budget-ledger.json');n=j['calls']+1;episode='unfinished-transport-attempt'
 j['calls']=n;j['entries'].append(dict(call=n,episodeId=episode,round=0,status='reserved',reservationUSD=.001))
 j['cumulativeEstimatedUSD']+=.001;save(p/'budget-ledger.json',j)
 req=read(p/'request-before-1.json');req['episodeId']=episode
 opening=json.loads(req['payload']['messages'][0]['content'][0]['text']);opening['scenario']='price_change_infeasible'
 req['payload']['messages'][0]['content'][0]['text']=json.dumps(opening)
 save(p/f'request-before-{n}.json',req)
 save(p/'run-error.json',dict(error='synthetic transport failure',calls=n))

base=Path(tempfile.mkdtemp(prefix='defi-verifier-review-',dir='/private/tmp'))
verifier.audit(str(SOURCE))
results=[]
for name,mutate in [('invented-observation',observation),('task-record-in-history-condition',condition),
 ('executed-action-differs-from-model-call',action),('settled-ledger-cost-zeroed',ledger),
 ('false-complete-marker',complete),('private-label-in-orphan-request',orphan)]:
 p=base/name;shutil.copytree(SOURCE,p);mutate(p)
 try:
  verifier.audit(str(p));accepted=True
 except Exception:
  accepted=False
 results.append(dict(test=name,tamperedCopyAccepted=accepted))
report=dict(scope='Offline mutations of temporary copies only; no API calls',temporaryDirectory=str(base),
 baselineAccepted=True,results=results)
print(json.dumps(report,indent=2))
sys.exit(1 if any(r['tamperedCopyAccepted'] for r in results) else 0)
