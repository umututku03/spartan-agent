"""Offline per-episode accounting for the staged real-agent cohorts. No API calls."""
from pathlib import Path
from decimal import Decimal
import json,sys
ROOT=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent
FORWARDED={'settled','http_error_reservation_kept','transport_error_reservation_kept','unsettled_usage_reservation_kept'}
def read(p):return json.loads(p.read_text())
def summarize(folder):
 p=ROOT/folder;manifest=read(p/'manifest.json')
 marker=read(p/('run-error.json' if (p/'run-error.json').exists() else 'complete.json'))
 path=p/'llm/ledger.jsonl';ledger=[json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
 rows=[]
 for eid in marker['episodes']:
  ep=read(p/'episodes'/f'{eid}.json');o=ep['outcome']
  entries=[e for e in ledger if str(e.get('episodeId') or '').split('#')[0]==eid]
  forwarded=[e for e in entries if e['status'] in FORWARDED]
  inp=out=0;reason=0;reason_reported=0;cache_reads=cache_writes=0;record_delivered=0
  for e in forwarded:
   req=p/'llm/calls'/f"{e['call']}-request.json"
   if req.exists() and '# Task record (deterministic, from wallet balances)' in json.dumps(read(req).get('body',{})):record_delivered+=1
   f=p/'llm/calls'/f"{e['call']}-response.json"
   if not f.exists():continue
   u=read(f).get('body',{}).get('usage') or {}
   if not u:continue
   inp+=u.get('input_tokens',0)+u.get('cache_creation_input_tokens',0)+u.get('cache_read_input_tokens',0)
   out+=u.get('output_tokens',0)
   detail=u.get('output_tokens_details') or {}
   rt=detail.get('reasoning_tokens',detail.get('thinking_tokens'))
   if rt is not None:reason+=rt;reason_reported+=1
   cache_reads+=(u.get('input_tokens_details') or {}).get('cached_tokens',u.get('cache_read_input_tokens',0))
   cache_writes+=(u.get('input_tokens_details') or {}).get('cache_write_tokens',u.get('cache_creation_input_tokens',0))
  cost=sum((Decimal(str(e['estimatedUSD'])) if e['status']=='settled' else Decimal(str(e.get('reservationUSD',0))) for e in forwarded),Decimal(0))
  reverts=[{'hash':t['hash'],'trace':t.get('revert')} for t in o['transactions'] if t['status']!='success']
  native=[t for t in o['transactions'] if t['status']=='success' and int(t['value'])>0]
  native_value=sum(int(t['value']) for t in native)
  rows.append(dict(id=eid,model=ep.get('model','control'),driver=ep.get('driver'),condition=ep.get('condition'),scenario=ep.get('scenario'),
   successfulSales=o['successfulSales'],successfulNativeValueWrites=len(native),successfulNativeValueETH=str(Decimal(native_value)/Decimal(10**18)),aggregateNativeValueEqualsRequestedSale=native_value==10**17,goalReached=o['goalReached'],reserveKept=o['reserveKept'],declared=o['declared'],
   validComplete=o['validComplete'],correctInfeasible=o['correctInfeasible'],falseCompletion=o['falseCompletion'],
   duplicateSales=o['duplicateSale'],prematureStop=o['prematureStop'],tradeEndedBelowGoal=o['tradeEndedBelowGoal'],
   final=o['final'],reverts=reverts,wallMs=ep.get('wallMs'),closingTransactions=(ep.get('turns') or [{}])[-1].get('newTransactions',0),hiddenReceiptQueries=sum(j.get('event')=='receipt_hidden' for j in ep['forkJournal']),marketMoves=sum(j.get('event')=='scheduled_market_change' for j in ep['forkJournal']),turns=len(ep.get('turns',[])),termination=ep.get('termination'),childExitCode=ep.get('childExitCode'),
   providerRequests=len(forwarded),loggedAttempts=len(entries),requestsContainingTaskRecord=record_delivered,inputTokens=inp,outputTokens=out,
   reportedReasoningOrThinkingTokens=reason if reason_reported else None,reasoningUsageReportedCalls=reason_reported,
   cacheReadTokens=cache_reads,cacheWriteTokens=cache_writes,conservativeEstimatedUSD=float(cost)))
 return dict(folder=folder,mode=manifest['mode'],status='partial' if (p/'run-error.json').exists() else 'complete',
  ledger=marker.get('ledger'),rows=rows,providerRequests=sum(r['providerRequests'] for r in rows),
  inputTokens=sum(r['inputTokens'] for r in rows),outputTokens=sum(r['outputTokens'] for r in rows),
  conservativeEstimatedUSD=sum(r['conservativeEstimatedUSD'] for r in rows),
  accountingNote='Proxy settles input at an upper-bound price; unknown-charge reservations are separate from provider invoices. Reasoning is null when not reported, not assumed zero.')
if __name__=='__main__':
 folders=[f for f in ['agent-flow-results-luna','agent-flow-results-haiku'] if (ROOT/f/'complete.json').exists() or (ROOT/f/'run-error.json').exists()]
 print(json.dumps({'studies':[summarize(f) for f in folders]},indent=2))
