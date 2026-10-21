from pathlib import Path
import json, hashlib
p=Path(__file__).parent
r=json.loads((p/'results/episodes.json').read_text())
m=json.loads((p/'results/manifest-before.json').read_text())
assert len(r)==171
for name,digest in m['files'].items():
 assert hashlib.sha256((p/name).read_bytes()).hexdigest()==digest,name
assert len({(x['experiment'],x['scenario'],x['policy']) for x in r})==171
for x in r:
 if x['experiment']=='E1' and x['policy']=='journal_reconcile':
  assert x['validCompletion'] and x['duplicateEffects']==0
 if x['experiment']=='E2' and x['policy']=='deterministic_resize':
  assert x['validCompletion']==x['feasible']
 if x['experiment']=='E3' and x['policy']=='execution_floor_and_resize':
  assert x['validCompletion']==x['feasible'] and not x['reserveViolation']
 if x['experiment']=='E3' and x['policy']=='execution_floor':
  assert not x['reserveViolation']
print('PASS: hashes, 171 unique episodes, and baseline outcomes.')
