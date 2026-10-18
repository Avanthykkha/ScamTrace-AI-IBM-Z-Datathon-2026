import importlib
import os
import secrets
from fastapi.testclient import TestClient

def client_for(tmp_path, monkeypatch):
    monkeypatch.setenv('SCAMTRACE_DB', str(tmp_path/'test.db'))
    monkeypatch.setenv('SCAMTRACE_LINKAGE_SECRET', secrets.token_urlsafe(32))
    import backend.main as appmod
    appmod.DB=tmp_path/'test.db'; appmod.CORRELATION_DB=tmp_path/'correlation.db'; appmod.init()
    appmod.STREAM['running']=False
    return appmod, TestClient(appmod.app)

def test_health_and_auto_stream_controls(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    assert c.get('/api/health').json()['status']=='healthy'
    assert c.post('/api/simulator/start').json()['running'] is True
    assert c.post('/api/simulator/stop').json()['running'] is False
    assert c.post('/api/simulator/speed',json={'speed':2}).json()['speed']==2

def test_rapid_scenario_evidence_and_intervention(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    result=c.post('/api/scenarios/run',json={'scenario':'RAPID_MULTI_HOP'}).json()
    assert result['transactions_created']==6 and result['case_ids']
    case=c.get('/api/cases').json()[0]
    assert 'scenario' not in case  # ground truth remains in the evaluation result, outside live case presentation
    evidence=c.get('/api/cases/'+case['id']+'/evidence').json()
    assert len(evidence['report']['supporting_transaction_ids'])>=3
    assert evidence['report']['next_steps']
    assert c.get('/api/interventions').json()
    assert c.get('/api/audit').json()
    assert len(c.get('/api/graph',params={'case_id':case['id']}).json()['edges'])>=3
    assert result['simulated_prevented']>=1
    assert any(x['status']=='SIMULATED_PREVENTED' for x in c.get('/api/transactions').json())
    assert any(x['status']=='SIMULATED_HOLD' for x in c.get('/api/interventions').json())

def test_benign_scenario_no_case_and_scenario_is_not_detector_input(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    assert c.post('/api/scenarios/run',json={'scenario':'BENIGN_HIGH_ACTIVITY'}).json()['case_ids']==[]
    assert c.get('/api/cases').json()==[]

def test_collection_and_late_outcome(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    r=c.post('/api/scenarios/run',json={'scenario':'COLLECTION_ACCOUNT'}).json(); assert r['case_ids']
    c.post('/api/simulator/reset')
    r=c.post('/api/scenarios/run',json={'scenario':'LATE_DETECTION'}).json()
    assert r['late_detection'] and 'trace and escalate' in r['intervention']
    assert any(x['status']=='PENDING' for x in c.get('/api/interventions').json())

def test_seeded_cross_bank_chain_regression(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    first=c.post('/api/scenarios/run',json={'scenario':'CROSS_BANK_CHAIN','seed':2042}).json()
    assert 'ground_truth' not in first
    assert first['timings']['scenario_execution_ms']>0
    assert first['timings']['event_processing_ms']['count']==3
    details=[c.get('/api/cases/'+case_id).json() for case_id in first['case_ids']]
    assert any('MULTI_HOP_CHAIN' in item['case']['rules'] for item in details)
    assert len(details)==1  # overlapping prefixes/suffixes should form one case
    institutions={bank for item in details for tx in item['transactions'] for bank in (tx['source_bank'],tx['dest_bank'])}
    assert len(institutions)>=3
    refs=first['transaction_ids']
    c.post('/api/simulator/reset')
    second=c.post('/api/scenarios/run',json={'scenario':'CROSS_BANK_CHAIN','seed':2042}).json()
    assert second['transaction_ids']==refs
    with m.connect() as db:
        columns={row['name'] for row in db.execute('PRAGMA correlation_store.table_info(transactions)')}
        assert 'scenario' not in columns

def test_input_validation_and_idempotency(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    assert c.post('/api/simulator/speed',json={'speed':99}).status_code==400
    assert c.post('/api/transactions',json={'sender':'A','receiver':'B','amount':-2}).status_code==400
    c.post('/api/scenarios/run',json={'scenario':'RAPID_MULTI_HOP'}); n=len(c.get('/api/cases').json())
    # Replaying an event with its stable ID is idempotent at persistence.
    x=dict(m.tx('SENDER','RECEIVER',123)); m.ingest(x); m.ingest(x)
    assert len(c.get('/api/transactions').json())==19

def test_transaction_filters_details_and_persistence(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    x=c.get('/api/transactions').json()[0]
    assert c.get('/api/transactions/'+x['id']).json()['id']==x['id']
    assert c.get('/api/transactions/does-not-exist').status_code==404
    assert all(t['amount']>=1000 for t in c.get('/api/transactions',params={'min_amount':1000}).json())
    assert c.get('/api/transactions',params={'rail':x['rail']}).json()
    with m.connect() as db: assert db.execute('SELECT id FROM correlation_store.transactions WHERE id=?',(x['id'],)).fetchone()
    payload={'id':'TX-DEDUPE-001','sender':'IDEMPOTENT-A','receiver':'IDEMPOTENT-B','amount':321,'rail':'UPI'}
    assert c.post('/api/transactions',json=payload).json()['created'] is True
    assert c.post('/api/transactions',json=payload).json()['created'] is False

def test_case_metadata_report_schema_and_reject_retry_audit(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    result=c.post('/api/scenarios/run',json={'scenario':'RAPID_MULTI_HOP'}).json()
    detail=c.get('/api/cases/'+result['case_ids'][0]).json()
    assert detail['case']['rules'] and detail['case']['detection_ts']
    assert detail['report']['supporting_transaction_ids']==detail['case']['tx_ids']
    assert detail['report']['timeline']
    assert str(len(detail['transactions'])) in detail['report']['summary']
    assert all(txid in detail['report']['next_steps'][0] for txid in detail['case']['tx_ids'])
    with m.connect() as db: assert db.execute('SELECT report_json FROM investigation_reports WHERE case_id=?',(detail['case']['id'],)).fetchone()
    assert c.post('/api/interventions/not-found/response',json={'outcome':'REJECTED'}).status_code==404
    intervention=c.get('/api/interventions').json()[0]
    # Use a late scenario's PENDING request to exercise response and safe retry transitions.
    c.post('/api/simulator/reset'); c.post('/api/scenarios/run',json={'scenario':'LATE_DETECTION'})
    intervention=next(x for x in c.get('/api/interventions').json() if x['status']=='PENDING')
    assert c.post('/api/interventions/'+intervention['id']+'/response',json={'outcome':'REJECTED'}).json()['status']=='REJECTED'
    assert c.post('/api/interventions/'+intervention['id']+'/retry').json()['status']=='REVIEW_REQUESTED'
    assert c.post('/api/interventions/'+intervention['id']+'/retry').status_code==409
    assert len(c.get('/api/audit').json())>=4

def test_repeated_connected_transfers_rule(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    c.post('/api/transactions',json={'id':'UPSTREAM-1','sender':'OUTSIDE','receiver':'PAIR-A','amount':9000})
    for i in range(3): c.post('/api/transactions',json={'id':f'PAIR-{i}','sender':'PAIR-A','receiver':'PAIR-B','amount':1000+i})
    found=[x for x in c.get('/api/cases').json() if 'REPEATED_CONNECTED_TRANSFERS' in x['rules']]
    assert found and len(found[0]['tx_ids'])>=4

def test_deterministic_report_fallback_without_provider(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch); monkeypatch.setattr(m,'LLM_URL',''); monkeypatch.setattr(m,'LLM_MODEL','')
    result=c.post('/api/scenarios/run',json={'scenario':'RAPID_MULTI_HOP'}).json()
    detail=c.get('/api/cases/'+result['case_ids'][0]).json()
    assert detail['report']['summary'] and detail['report']['supporting_transaction_ids']
    assert detail['report']['confidence'] and detail['report']['evidence_gaps']
    # An insecure, non-loopback HTTP endpoint is rejected without a network call.
    monkeypatch.setattr(m,'LLM_URL','http://example.invalid/chat/completions'); monkeypatch.setattr(m,'LLM_MODEL','test-model')
    with m.connect() as db: raw=dict(db.execute('SELECT * FROM cases WHERE id=?',(detail['case']['id'],)).fetchone())
    fallback=m.report(raw,detail['transactions'])
    assert fallback['supporting_transaction_ids']==detail['report']['supporting_transaction_ids']

def test_allowlisted_cross_bank_signals_and_authorized_evidence_audit(tmp_path,monkeypatch):
    m,c=client_for(tmp_path,monkeypatch)
    investigator_token=secrets.token_urlsafe(32); reviewer_token=secrets.token_urlsafe(32)
    monkeypatch.setenv('SCAMTRACE_INVESTIGATOR_TOKEN',investigator_token)
    monkeypatch.setenv('SCAMTRACE_INSTITUTION_REVIEW_TOKEN',reviewer_token)
    replay=c.post('/api/scenarios/run',json={'scenario':'RAPID_MULTI_HOP','seed':731}).json()
    assert replay['case_ids']
    case=c.get('/api/cases/'+replay['case_ids'][0]).json()['case']
    graph=c.get('/api/graph',params={'case_id':case['id']}).json()
    assert len({edge['source_bank'] for edge in graph['edges']} | {edge['dest_bank'] for edge in graph['edges']}) >= 3
    txid=case['tx_ids'][0]
    signal=c.get('/api/transactions/'+txid).json()
    policy=c.get('/api/federation').json()['disclosure_policy']
    assert set(signal)==set(policy['signal_fields'])
    assert not ({'scenario','scenario_label','local_account_id','customer_name','raw_sender'} & set(signal))
    with m.connect() as db:
        columns={row['name'] for row in db.execute('PRAGMA correlation_store.table_info(transactions)')}
        assert columns==set(policy['signal_fields'])
        assert not db.execute("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name='transactions'").fetchone()
        shared=db.execute('SELECT sender,receiver FROM correlation_store.transactions WHERE id=?',(txid,)).fetchone()
        assert not any(value in ('ACCT-VICTIM','ACCT-MID','ACCT-SPLIT-A') for value in shared)
    reqdata={'case_id':case['id'],'transaction_id':txid,'institution':signal['source_bank'],'fields':['local_account_id','institution_record_status'],'purpose':policy['evidence_purpose'],'justification':'Verify the source institution local synthetic record.'}
    assert c.post('/api/evidence-requests',json=reqdata).status_code==401
    history=c.get('/api/disclosures/history').json()
    assert any(x['event_type']=='DENIED' and x['detail']=='Missing or invalid authorization credential' for x in history['events'])
    header={'Authorization':f'Bearer {investigator_token}'}
    violation={**reqdata,'fields':['scenario_label']}
    assert c.post('/api/evidence-requests',json=violation,headers=header).status_code==422
    assert any(x['event_type']=='DENIED' and 'prohibited' in x['detail'] for x in c.get('/api/disclosures/history').json()['events'])
    created=c.post('/api/evidence-requests',json=reqdata,headers=header)
    assert created.status_code==200,created.text
    request_id=created.json()['id']
    assert c.post(f'/api/evidence-requests/{request_id}/decision',json={'approve':True},headers={'Authorization':'Bearer wrong'}).status_code==401
    decision=c.post(f'/api/evidence-requests/{request_id}/decision',json={'approve':True},headers={'Authorization':f'Bearer {reviewer_token}'})
    assert decision.status_code==200,decision.text
    assert set(decision.json()['evidence'])==set(reqdata['fields'])
    assert c.get(f'/api/evidence-requests/{request_id}').status_code==401
    returned=c.get(f'/api/evidence-requests/{request_id}',headers=header).json()
    assert returned['status']=='APPROVED' and returned['evidence']['institution_record_status']
    case_detail=c.get('/api/cases/'+case['id']).json()
    assert {x['id'] for x in case_detail['transactions']} == set(case['tx_ids'])
    assert case_detail['sharing_policy']['signal_fields'] == policy['signal_fields']
    assert any(x['transaction_id']==txid and x['event_type']=='SHARED' for x in case_detail['disclosure_events'])
    assert any(x['transaction_id']==txid and x['event_type']=='DENIED' for x in case_detail['disclosure_events'])
    assert any(x['id']==request_id and x['status']=='APPROVED' for x in case_detail['evidence_requests'])
    assert any(x.get('event_type')=='EVIDENCE_ACCESSED' and x.get('request_id')==request_id for x in case_detail['audit_history'])
    assert any(x['intervention_id'] for x in case_detail['audit_history'] if 'to_state' in x)
    types=[x['event_type'] for x in c.get('/api/disclosures/history').json()['events'] if x['request_id']==request_id]
    assert {'REQUESTED','APPROVED','RESPONDED'}<=set(types)
    assert c.post(f'/api/evidence-requests/{request_id}/decision',json={'approve':True},headers={'Authorization':f'Bearer {reviewer_token}'}).status_code==409
