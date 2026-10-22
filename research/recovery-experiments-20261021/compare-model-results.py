"""Compare the two completed eight-round cohorts without model/API calls."""
from pathlib import Path
from decimal import Decimal
import json
ROOT=Path(__file__).resolve().parent

def read(folder,name):return json.loads((ROOT/folder/name).read_text())

def comparison():
 folders=['agent-budget-sensitivity-results','agent-claude-results']
 manifests=[read(f,'manifest-before.json') for f in folders]
 a,b=manifests
 for key in ['instructions','userTask','plan','maxRounds','contractSha256','helperSha256']:
  assert a[key]==b[key],('Comparison condition mismatch',key)
 assert a['files']['agent-environment.ts']==b['files']['agent-environment.ts']
 assert b['tools']==[dict(name=t['name'],description=t['description'],strict=True,input_schema=t['parameters']) for t in a['tools']]
 rows=[];actions=[]
 for folder,m in zip(folders,manifests):
  assert (ROOT/folder/'complete.json').exists()
  episodes=read(folder,'episodes.json')
  assert len(episodes)==12
  for controller in ['history','task_record']:
   es=[e for e in episodes if e['controller']==controller];os=[e['outcome'] for e in es]
   assert len(es)==4
   rows.append(dict(model=m['model'],controller=controller,episodes=len(es),
    feasible=sum(o['initiallyFeasible'] for o in os),validComplete=sum(o['validComplete'] for o in os),
    infeasible=sum(not o['initiallyFeasible'] for o in os),correctInfeasible=sum(o['correctInfeasible'] for o in os),
    validResolutions=sum(o['validResolution'] for o in os),
    unsafeProposals=sum(o['unsafeProposals'] for o in os),guardBlocks=sum(o['guardBlocks'] for o in os),
    executedReserveViolations=sum(o['executedReserveViolations'] for o in os),
    falseCompletions=sum(o['falseCompletion'] for o in os),
    budgetExhausted=sum(e.get('termination')=='round_budget_exhausted' for e in es),
    modelCalls=sum(len(e['modelTrace']) for e in es)))
   for e in es:
    for i,t in enumerate(e['toolTrace']):
     if t['action']['tool']=='swap_cash':
      args=t['action']['args']
      actions.append(dict(model=m['model'],episode=e['id'],round=i,cash=args['cash'],
       minimum_dai=args['minimum_dai'],minimumBelowTaskGoal=Decimal(args['minimum_dai'])<50,
       status=t['result']['status'],finalGoalReached=e['outcome']['goalReached'],
       initiallyFeasible=e['outcome']['initiallyFeasible']))
 ledger=read('agent-claude-results','budget-ledger.json')
 return dict(scope='Two developmental eight-round cohorts, one repeat per condition/scenario; descriptive only',
  matchedTaskAndEnvironment=True,rows=rows,cashSwapActions=actions,
  claudeCalls=ledger['calls'],claudeEstimatedUSD=ledger['cumulativeEstimatedUSD']-ledger['priorEstimatedUSD'],
  cumulativeEstimatedUSD=ledger['cumulativeEstimatedUSD'])

if __name__=='__main__':print(json.dumps(comparison(),indent=2))
