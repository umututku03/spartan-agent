"""Offline cost estimate for the Opus 5.5 / GPT-6.1 Sol API replication. No API calls.
Expected scenarios are assumptions anchored on the recorded Haiku/Luna token usage; the conservative
maximum is the hard bound the runner enforces through per-call reservations."""
from pathlib import Path
import json, statistics as st
ROOT=Path(__file__).resolve().parent
MAX_OUT=2048;OVERHEAD=512;ROUNDS=8;EPISODES=8
MODELS={'opus':dict(model='claude-opus-5-5',pin=4,pout=20,cap_bytes=16384,history='agent-claude-results',tok_factor=dict(low=1.0,central=1.2,high=1.35)),
 'sol':dict(model='gpt-6.1-sol',pin=2,pout=10,cap_bytes=12288,history='agent-budget-sensitivity-results',tok_factor=dict(low=1.0,central=1.0,high=1.1))}
OUT_PER_CALL=dict(low=150,central=400,high=1000)  # thinking/reasoning + tool call at low effort (assumption)
def history(folder):
 rows=[(t['round'],t['inputBytes'],t['response']['usage']['input_tokens']) for e in json.loads((ROOT/folder/'episodes.json').read_text()) for t in e.get('modelTrace') or []]
 return dict(calls=len(rows),meanInputTokens=st.mean(r[2] for r in rows),meanRound=st.mean(r[0] for r in rows),
  bytesByRound={k:st.mean(r[1] for r in rows if r[0]==k) for k in sorted({r[0] for r in rows})})
def dryrun(key):
 p=ROOT/'api-replication-dryrun'/key/'episodes.json'
 if not p.exists():return None
 rows=[(t['round'],t['visibleBytes']) for e in json.loads(p.read_text()) if e.get('mockPolicy')=='scripted' for t in e['modelTrace']]
 allrows=[t['visibleBytes'] for e in json.loads(p.read_text()) if e.get('modelTrace') for t in e['modelTrace']]
 return dict(maxVisibleBytes=max(allrows),bytesByRound={k:st.mean(r[1] for r in rows if r[0]==k) for k in sorted({r[0] for r in rows})})
def cost(tokens_in,tokens_out,c):return (tokens_in*c['pin']+tokens_out*c['pout'])/1e6
out={}
for key,c in MODELS.items():
 h=history(c['history']);d=dryrun(key)
 # Envelope growth: mean ratio of new visible bytes to the predecessor cohort's bytes at the same round index.
 env_factor=st.mean(d['bytesByRound'][k]/h['bytesByRound'][k] for k in d['bytesByRound'] if k in h['bytesByRound']) if d else 1.0
 scen={}
 for name in ('low','central','high'):
  calls=h['calls'] if name!='high' else ROUNDS*EPISODES
  o=OUT_PER_CALL[name]
  tin=h['meanInputTokens']*c['tok_factor'][name]*env_factor+o*h['meanRound']  # replayed earlier output billed as input
  scen[name]=dict(calls=calls,outputTokensPerCall=o,inputTokensPerCall=round(tin),USD=round(calls*cost(tin,o,c),4))
 hard=sum(cost(c['cap_bytes']+OVERHEAD+MAX_OUT*r,MAX_OUT,c) for r in range(ROUNDS))*EPISODES
 measured=sum(cost(d['maxVisibleBytes']+OVERHEAD+MAX_OUT*r,MAX_OUT,c) for r in range(ROUNDS))*EPISODES if d else None
 out[key]=dict(model=c['model'],pricesUSDPerMillion=dict(input=c['pin'],output=c['pout']),history=h|dict(bytesByRound=None),
  dryRun=d,envelopeByteFactor=round(env_factor,3),expected=scen,
  conservativeMaxUSD=round(hard,4),boundAtMeasuredMaxBytesUSD=round(measured,4) if measured else None)
prior=json.loads((ROOT/'agent-claude-results/budget-ledger.json').read_text())['cumulativeEstimatedUSD']
out['combined']=dict(priorCumulativeUSD=prior,
 expectedCentralUSD=round(out['opus']['expected']['central']['USD']+out['sol']['expected']['central']['USD'],4),
 expectedHighUSD=round(out['opus']['expected']['high']['USD']+out['sol']['expected']['high']['USD'],4),
 conservativeMaxUSD=round(out['opus']['conservativeMaxUSD']+out['sol']['conservativeMaxUSD'],4),
 conservativeMaxCumulativeUSD=round(prior+out['opus']['conservativeMaxUSD']+out['sol']['conservativeMaxUSD'],4))
(ROOT/'api-cost-estimate.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
