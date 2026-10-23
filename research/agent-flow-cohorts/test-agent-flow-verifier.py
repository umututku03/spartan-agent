"""Tamper tests for verify-agent-flow-results.py. Copies a clean results folder to a temp dir, applies one
mutation per test, and requires the verifier to reject every mutated copy. No API or chain access.
Usage: python3 test-agent-flow-verifier.py <clean results dir>"""
from pathlib import Path
import importlib.util, json, shutil, sys, tempfile
ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('verify_flow', ROOT / 'verify-agent-flow-results.py')
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
SRC = Path(sys.argv[1]).resolve()
def rd(p): return json.loads(Path(p).read_text())
def wr(p, j): Path(p).write_text(json.dumps(j, indent=2))
def first_call(p, pred=lambda e: True):
    for line in (p / 'llm/ledger.jsonl').read_text().splitlines():
        e = json.loads(line)
        if e['status'] != 'refused_outside_turn' and pred(e): return e
def episode(p, pred):
    return next(f for f in sorted((p / 'episodes').glob('*.json')) if pred(f.name))

def label_in_request(p):
    e = first_call(p); f = p / f"llm/calls/{e['call']}-request.json"; j = rd(f)
    j['body'].setdefault('metadata', {})['note'] = 'scenario price_change_infeasible'; wr(f, j)
def episode_id_in_request(p):
    e = first_call(p); f = p / f"llm/calls/{e['call']}-request.json"; j = rd(f)
    j['body'].setdefault('metadata', {})['note'] = e['episodeId']; wr(f, j)
def missing_call_record(p):
    e = first_call(p); (p / f"llm/calls/{e['call']}-response.json").unlink()
def unknown_episode_call(p):
    lines = (p / 'llm/ledger.jsonl').read_text().splitlines(); j = json.loads(lines[0]); j['episodeId'] = 'luna-single_shot-stock-unplanned'
    lines[0] = json.dumps(j); (p / 'llm/ledger.jsonl').write_text('\n'.join(lines) + '\n')
def temperature_kept(p):
    e = first_call(p, lambda e: str(e.get('model', '')).startswith('gpt-6')); f = p / f"llm/calls/{e['call']}-request.json"; j = rd(f)
    j['body']['temperature'] = 0.7; wr(f, j)
def goal_flag_inconsistent(p):
    f = episode(p, lambda n: n.endswith('normal.json') and not n.startswith('control')); j = rd(f); j['outcome']['final']['dai'] = '1'; wr(f, j)
def declared_rewritten(p):
    f = episode(p, lambda n: n.endswith('price_change_infeasible.json') and not n.startswith('control')); j = rd(f)
    j['outcome']['declared'] = 'COMPLETED' if j['outcome']['declared'] != 'COMPLETED' else 'INFEASIBLE'; wr(f, j)
def market_move_dropped(p):
    f = episode(p, lambda n: n.endswith('price_change_feasible.json') and not n.startswith('control')); j = rd(f)
    j['forkJournal'] = [x for x in j['forkJournal'] if x.get('event') != 'scheduled_market_change']; wr(f, j)
def transaction_hidden(p):
    f = episode(p, lambda n: n.endswith('normal.json') and not n.startswith('control')); j = rd(f); j['outcome']['transactions'] = j['outcome']['transactions'][1:]; wr(f, j)
def completion_truncated(p):
    f = p / 'complete.json'; j = rd(f); j['episodes'] = j['episodes'][:-1]; wr(f, j)
def episodes_reordered(p):
    f = p / 'complete.json'; j = rd(f); j['episodes'][4], j['episodes'][5] = j['episodes'][5], j['episodes'][4]; wr(f, j)
def credential_planted(p):
    f = sorted((p / 'episodes').glob('*.child-stderr.log'))[0]; f.write_text(f.read_text() + '\nhttps://eth-mainnet.g.alchemy.com/v2/AbCdEfGhIjKlMnOp\n')
def extra_file(p): (p / 'episodes/notes.json').write_text('{}')
def followup_text_changed(p):
    f = episode(p, lambda n: '-single_shot-' in n and n.endswith('normal.json')); j = rd(f)
    if len(j['turns']) > 2: j['turns'][1]['text'] = 'Please lower the DAI goal and continue.'
    else: j['turns'][0]['text'] += ' Lower the DAI goal if needed.'
    wr(f, j)

def blinding_refusal_recorded(p):
    lines = (p / 'llm/ledger.jsonl').read_text().splitlines(); j = json.loads(lines[-1])
    j.update(call=len(lines) + 1, status='refused_blinding', leakedTerms=['receipt_hidden']); lines.append(json.dumps(j))
    (p / 'llm/ledger.jsonl').write_text('\n'.join(lines) + '\n')
    src = p / f"llm/calls/{json.loads(lines[-2])['call']}-request.json"; (p / f"llm/calls/{j['call']}-request.json").write_text(src.read_text())
def partial_sale_unreported(p):
    # an extra risk-clamped native sale (0.05 ETH) recorded in the journal and transactions, flags left unchanged
    f = episode(p, lambda n: n.endswith('normal.json') and not n.startswith('control')); j = rd(f)
    t = dict(j['outcome']['transactions'][0]); t.update(hash='0x' + 'ab' * 32, value=str(5 * 10 ** 16), sale=False)
    j['outcome']['transactions'].append(t)
    j['forkJournal'].append({'event': 'send', 'from': j['forkJournal'][0]['from'], 'to': t['to'], 'value': t['value'], 'hash': t['hash']}); wr(f, j)

MUTATIONS = [blinding_refusal_recorded, partial_sale_unreported, label_in_request, episode_id_in_request, missing_call_record, unknown_episode_call, temperature_kept,
             goal_flag_inconsistent, declared_rewritten, market_move_dropped, transaction_hidden, completion_truncated,
             episodes_reordered, credential_planted, extra_file, followup_text_changed]
base = Path(tempfile.mkdtemp(prefix='agent-flow-verifier-'))
report = []
v.audit(str(SRC)); report.append(('clean folder accepted', True))
for mut in MUTATIONS:
    p = base / mut.__name__; shutil.copytree(SRC, p); mut(p)
    try: v.audit(str(p)); report.append((mut.__name__, False))
    except Exception as e: report.append((mut.__name__, True, f'{type(e).__name__}: {str(e)[:120]}'))
shutil.rmtree(base)
for r in report: print('PASS' if r[1] else 'FAIL', r[0], *(r[2:] if len(r) > 2 else []))
sys.exit(0 if all(r[1] for r in report) else 1)
