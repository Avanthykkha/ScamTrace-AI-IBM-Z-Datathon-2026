import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BellRing, Bot,
  CheckCircle2, ChevronRight, CircleHelp, Clock3, Database, ExternalLink,
  FileText, GitBranch, Info, Network, Pause, Play, Radio, RotateCcw,
  Search, Server, ShieldAlert, ShieldCheck, TriangleAlert, Workflow, Zap,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './case-investigation.css';
import './ui-overrides.css';

const api = async (path: string, opts?: RequestInit) => {
  const response = await fetch('/api' + path, {
    ...opts,
    cache: opts?.method && opts.method !== 'GET' ? opts.cache : 'no-store',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
  });
  if (!response.ok) {
    let detail = 'Request failed';
    try { detail = (await response.json()).detail || detail; } catch { /* retain friendly fallback */ }
    throw new Error(detail);
  }
  return response.json();
};

type Page = 'Overview' | 'Tracked accounts' | 'Investigations' | 'Fund flow' | 'Response center' | 'Data sharing' | 'Evaluation';
type CaseRecord = { id: string; created_at: string; severity: string; status: string; title: string; summary: string; reasons: string[]; tx_ids: string[]; accounts: string[]; rules: string[]; late: number };
type Service = { state?: string; connected?: boolean; configured?: boolean; alerts?: number; records?: number; model?: string; model_ready?: boolean };

const pageInfo: Record<Page, string> = {
  Overview: 'Recent transfers, review cases, and public research data.',
  'Tracked accounts': 'Accounts linked to a detection case or stream alert.',
  Investigations: 'Cases created by the detection rules, with evidence.',
  'Fund flow': 'Trace the recorded transfers connected to a case.',
  'Response center': 'Track simulated response requests and their outcomes.',
  'Data sharing': 'Review policy-controlled signals and institution evidence requests.',
  'Evaluation': 'Review the current synthetic cases and their evidence.',
};

const ruleNames: Record<string, string> = {
  RAPID_FORWARDING: 'Money moved onward quickly',
  ONE_TO_MANY_SPLIT: 'One account sent money to several recipients',
  MANY_TO_ONE_CONVERGENCE: 'Several senders paid one account',
  MULTI_HOP_CHAIN: 'Transfers crossed multiple accounts',
  RAPID_ACCOUNT_BURST: 'Several transfers happened in a short burst',
  REPEATED_CONNECTED_TRANSFERS: 'The same account pair transferred repeatedly',
};

const stateMeaning: Record<string, string> = {
  SUBMITTED: 'A fictional request was submitted to this local demo queue.',
  REVIEW_REQUESTED: 'A fictional institution was asked to review this flow.',
  ACKNOWLEDGED: 'The fictional institution simulator recorded that it received the request.',
  SIMULATED_HOLD: 'The demo marked later fixture events as prevented. No real payment was stopped.',
  PENDING: 'No final outcome is recorded yet; the demo recommends tracing and follow-up.',
  STILL_NOT_APPROVED: 'The fictional request remains unapproved in the demo queue.',
  NEEDS_INFORMATION: 'The fictional reviewer requested more information in the demo.',
  REJECTED: 'The fictional institution simulator declined the request.',
  EXPIRED: 'No response arrived before the demo workflow timeout.',
};

const scenarios = [
  { id: 'RAPID_MULTI_HOP', title: 'Fast onward transfers', text: 'Shows one incoming payment split across accounts.' },
  { id: 'RAPID_FAN_OUT', title: 'Rapid multi-recipient fan-out', text: 'Shows a recently funded account rapidly paying four recipients.' },
  { id: 'REPEATED_CONNECTED', title: 'Repeated connected transfers', text: 'Shows repeated transfers between connected account labels.' },
  { id: 'COLLECTION_ACCOUNT', title: 'Several payers, one collector', text: 'Shows funds from separate accounts converging on one account before moving onward.' },
  { id: 'CROSS_BANK_CHAIN', title: 'Cross-bank transaction chain', text: 'Shows a time-ordered multi-hop path through four fictional institutions.' },
  { id: 'BENIGN_HIGH_ACTIVITY', title: 'Busy but ordinary account', text: 'Checks that many routine payments alone do not automatically create a case.' },
  { id: 'LATE_DETECTION', title: 'Detection after settlement', text: 'Shows what the dashboard records when the example transfers have already settled.' },
];

const money = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const stamp = (value?: string) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const shortTime = (value?: string) => value ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const initialCaseId = new URLSearchParams(window.location.search).get('case') || '';
// Local display aliases only: the backend stores synthetic account tokens, not real holder identities.
const holderFirstNames = ['Aarav','Aanya','Aditya','Anaya','Arjun','Diya','Ira','Ishan','Kabir','Kiara','Mira','Neel','Nisha','Rohan','Sana','Tara','Vivaan','Zoya','Ishaan','Meera','Reyansh','Saanvi','Dev','Myra','Kian','Avni','Aarohi','Veer','Riya','Samir','Leela','Nikhil'];
const holderLastNames = ['Mehta','Rao','Nair','Kapoor','Shah','Iyer','Menon','Bose','Khanna','Sethi','Malhotra','Desai','Kulkarni','Sen','Patel','Mukherjee','Joshi','Bhat','Chopra','Pillai','Reddy','Banerjee','Saxena','Ghosh','Khan','Das','Anand','Varma','Chatterjee','Naidu','Suri','Rana'];
function accountHolderName(accountId?: string) {
  const key = String(accountId || 'unknown');
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const second = Math.imul(hash ^ 0x9e3779b9, 2246822519) >>> 0;
  return `${holderFirstNames[hash % holderFirstNames.length]} ${holderLastNames[second % holderLastNames.length]}`;
}
function caseHolderName(item: any) {
  const focal = String(item?.title || '').match(/ACCT-[A-Z0-9-]+/i)?.[0] || item?.accounts?.[0] || item?.account_id || item?.id;
  return accountHolderName(focal);
}
const normalizeCaseSearch = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const matchesCaseSearch = (item: CaseRecord, value: string) => {
  const query = normalizeCaseSearch(value);
  return !query || [item.id, item.title, ...(item.accounts || [])].some(field => normalizeCaseSearch(String(field)).includes(query));
};
function deriveAccountProfile(accountId: string, cases: any[], alerts: any[], transactions: any[]) {
  const related = cases.filter(item => (item.accounts || []).includes(accountId));
  const rows = transactions.filter(item => item.sender === accountId || item.receiver === accountId).sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const incoming = rows.filter(item => item.receiver === accountId && item.status !== 'SIMULATED_PREVENTED');
  const outgoing = rows.filter(item => item.sender === accountId && item.status !== 'SIMULATED_PREVENTED');
  return { account_id: accountId, cases: related.map(item => ({ id: item.id, status: item.status, severity: item.severity, title: item.title, created_at: item.created_at })), case_count: related.length, open_case_count: related.filter(item => item.status === 'OPEN').length, incoming_count: incoming.length, outgoing_count: outgoing.length, received_total: incoming.reduce((n, item) => n + Number(item.amount || 0), 0), sent_total: outgoing.reduce((n, item) => n + Number(item.amount || 0), 0), first_seen: rows.length ? rows[rows.length - 1].ts : null, last_seen: rows[0]?.ts || null, transaction_count: rows.length, transactions: rows.slice(0, 50), has_more_history: rows.length >= 50, history_complete: false };
}
function deriveTrackedAccounts(cases: any[], alerts: any[], transactions: any[]) {
  const ids = new Set<string>(cases.flatMap(item => item.accounts || []));
  alerts.forEach(item => { if (item.sender) ids.add(item.sender); });
  return [...ids].map(id => deriveAccountProfile(id, cases, alerts, transactions)).sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
}

export default function App() {
  const [page, setPage] = useState<Page>(initialCaseId ? 'Investigations' : 'Overview');
  const [health, setHealth] = useState<any>({});
  const [transactions, setTransactions] = useState<any[]>([]);
  const [trackedAccounts, setTrackedAccounts] = useState<any[]>([]);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [graph, setGraph] = useState<any>({ nodes: [], edges: [] });
  const [interventions, setInterventions] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [federation, setFederation] = useState<any>({ institutions: [] });
  const [disclosures, setDisclosures] = useState<any>({ events: [], requests: [], policy: {} });
  const [evaluation, setEvaluation] = useState<any>({});
  const [ellipticSummary, setEllipticSummary] = useState<any>(null);
  const [selectedCase, setSelectedCase] = useState<string>(initialCaseId);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [caseDetail, setCaseDetail] = useState<any>(null);
  const [accountDetail, setAccountDetail] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [caseSearch, setCaseSearch] = useState('');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [caseLoading, setCaseLoading] = useState(false);
  const [caseError, setCaseError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const refreshSequence = useRef(0);

  const refresh = async () => {
    const sequence = ++refreshSequence.current;
    try {
      const [h, tx, cs, ints, log, fl, accounts, fed, disclosureLog, benchmark] = await Promise.all([
        api('/health'), api('/transactions'), api('/cases'),
        api('/interventions'), api('/audit'), api('/stream/alerts'),
        api('/accounts/tracked').catch(() => null),
        api('/federation'),
        api('/disclosures/history'),
        api('/evaluation'),
      ]);
      if (sequence !== refreshSequence.current) return;
      setHealth(h); setTransactions(tx); setCases(cs);
      setTrackedAccounts(accounts || deriveTrackedAccounts(cs, fl, tx));
      setInterventions(ints); setAudit(log); setAlerts(fl);
      setFederation(fed);
      setDisclosures(disclosureLog);
      setEvaluation(benchmark);
      setRunning(Boolean(h.stream));
      setRefreshError('');
    } catch (error: any) {
      if (sequence === refreshSequence.current) setRefreshError(error.message || 'The latest data could not be loaded.');
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { api('/evaluation/elliptic/summary').then(setEllipticSummary).catch(() => setEllipticSummary(null)); }, []);

  useEffect(() => {
    const handler = () => { void refresh(); if (selectedCase) void openCase(selectedCase); };
    window.addEventListener('scamtrace-refresh', handler);
    return () => window.removeEventListener('scamtrace-refresh', handler);
  }, [selectedCase]);

  const openCase = async (id: string) => {
    setSelectedCase(id); setSelectedAccount(''); setAccountDetail(null); setPage('Investigations'); setCaseDetail(null); setCaseError(''); setCaseLoading(true);
    const url = new URL(window.location.href); url.searchParams.set('case', id); window.history.replaceState({}, '', url);
    try {
      const [detail, flow] = await Promise.all([api(`/cases/${encodeURIComponent(id)}`), api(`/graph?case_id=${encodeURIComponent(id)}`)]);
      if (!detail.account_profiles) detail.account_profiles = (detail.case.accounts || []).map((account: string) => deriveAccountProfile(account, [detail.case, ...cases.filter(item => item.id !== detail.case.id)], alerts, [...detail.transactions, ...transactions]));
      setCaseDetail(detail); setGraph(flow);
    }
    catch (error: any) { setCaseError(error.message || 'Could not load the case records.'); }
    finally { setCaseLoading(false); }
  };

  useEffect(() => { if (initialCaseId) void openCase(initialCaseId); }, []);

  const openAccount = async (id: string) => {
    setPage('Investigations'); setSelectedAccount(id); setCaseDetail(null); setAccountDetail(null);
    const url = new URL(window.location.href); url.searchParams.delete('case'); window.history.replaceState({}, '', url);
    try {
      let profile;
      try { profile = await api(`/accounts/${encodeURIComponent(id)}`); }
      catch { profile = trackedAccounts.find(item => item.account_id === id) || deriveAccountProfile(id, cases, alerts, transactions); }
      if (!profile.transactions.length && !profile.cases.length) throw new Error('No recorded activity is available for this account label yet.');
      setAccountDetail(profile); setSelectedCase(profile.cases[0]?.id || '');
    } catch (error: any) { setNotice(`Could not open tracked account: ${error.message}`); }
  };

  const loadCaseFlow = async (id: string) => {
    setSelectedCase(id);
    if (!id) { setGraph({ nodes: [], edges: [], paths: [] }); return; }
    try { setGraph(await api(`/graph?case_id=${encodeURIComponent(id)}`)); }
    catch (error: any) { setNotice(`Could not load this case's transfer path: ${error.message}`); }
  };

  const action = async (path: string, body?: unknown) => {
    setLoading(true);
    try {
      const result = await api(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
      await refresh();
      if (result.scenario) {
        const count = result.transactions_created || 0;
        const prevented = result.simulated_prevented || 0;
        setNotice(`${scenarioTitle(result.scenario)} finished: ${count} example events, ${result.case_ids?.length || 0} investigation(s), ${prevented} fixture event(s) marked prevented. ${result.intervention || ''}`);
        if (result.case_ids?.length) await openCase(result.case_ids[0]);
        else setPage('Overview');
      } else if (result.created_case_count !== undefined) {
        setNotice(`${result.created_case_count} new synthetic cases added for review and fund tracing.`);
        setPage('Investigations');
        if (result.case_ids?.length) await openCase(result.case_ids[0]);
      } else if (result.created !== undefined && result.case_id) {
        setNotice(result.created ? `Request submitted for case ${result.case_id}.` : `A request already exists for case ${result.case_id}.`);
      } else if (path === '/simulator/start') {
        setNotice('Synthetic demo stream started. New transfers will appear automatically.');
      } else if (path === '/simulator/stop') {
        setNotice('Synthetic demo stream paused. Existing records are unchanged.');
      } else {
        setNotice('Done. The dashboard has been refreshed with the latest status.');
      }
    } catch (error: any) {
      setNotice(`That action could not be completed. ${error.message}`);
    } finally { setLoading(false); }
  };

  const filteredCases = cases.filter(item => matchesCaseSearch(item, caseSearch));
  const nav: [Page, any, string][] = [
    ['Overview', Activity, 'Live status and latest activity'], ['Tracked accounts', Radio, 'Accounts linked to detected activity'],
    ['Investigations', ShieldAlert, 'Detection cases and Flink alerts'], ['Fund flow', GitBranch, 'Transfer paths'],
    ['Response center', ShieldCheck, 'Response tracking and audit history'],
    ['Data sharing', Database, 'Policy-controlled synthetic disclosures'],
    ['Evaluation', CheckCircle2, 'Measured synthetic detector results'],
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Network size={22}/></div><div><strong>ScamTrace <span>AI</span></strong><small>MONITORING</small></div></div>
      <div className="environment-label"><span className="environment-dot"/> SYNTHETIC NETWORK</div>
      <div className="nav-label">MONITOR</div>
      <nav>{nav.map(([name, Icon, helper]) => <button key={name} className={`nav-item ${page === name ? 'active' : ''}`} onClick={() => setPage(name)} title={helper}>
        <Icon size={18}/><span>{name}</span>{name === 'Investigations' && cases.length + alerts.length > 0 && <em>{cases.length + alerts.length}</em>}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="sidebar-health"><span className={`health-light ${health.status === 'healthy' ? 'on' : ''}`}/><div><b>{health.status === 'healthy' ? 'App connected' : 'Connecting to app'}</b><small>Local API · updates every 4 sec</small></div></div>
        <small className="version-label">SCAMTRACE AI · SYNTHETIC PROTOTYPE</small>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">SCAMTRACE <ChevronRight size={14}/><b>{page.toUpperCase()}</b></div><div className="topbar-right"><span className={`live-status ${health.status === 'healthy' && running ? 'on' : ''}`}><i/>{health.status === 'healthy' ? 'DEMO ONLINE' : 'API OFFLINE'}</span></div></header>
      <section className="page-content">
        <div className="page-heading compact-heading"><div><h1>{page}</h1><p>{pageInfo[page]}</p></div><div className="heading-actions"><span className={`refresh-label ${refreshError ? 'refresh-failed' : ''}`} title={refreshError || ''}><span className="refresh-light"/>{refreshError ? 'Reconnecting automatically' : health.observed_at ? `Updated ? ${stamp(health.observed_at)}` : 'Connecting to updates'}</span></div></div>
        {refreshError && <div className="notice refresh-notice" role="alert"><Info size={17}/><span>Could not refresh current data: {refreshError}</span></div>}
        {notice && <div className="notice" role="status"><Info size={17}/><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}

        {page === 'Overview' && <Overview health={health} transactions={transactions} cases={cases} trackedAccounts={trackedAccounts} ellipticSummary={ellipticSummary} onNavigate={setPage} onOpenCase={openCase} onOpenAccount={openAccount} onAction={action} loading={loading}/>}
        {page === 'Tracked accounts' && <TrackedAccounts accounts={trackedAccounts} onOpen={openAccount} running={running}/>}
        {page === 'Investigations' && <Investigations cases={filteredCases} allCases={cases} selectedId={selectedCase} detail={caseDetail} graph={graph} caseLoading={caseLoading} caseError={caseError} accountDetail={accountDetail} selectedAccount={selectedAccount} search={caseSearch} setSearch={setCaseSearch} onOpen={openCase} onOpenAccount={openAccount} health={health} interventions={interventions} alerts={alerts} flink={health.advanced?.flink || {}} onNavigate={setPage} onAction={action} loading={loading}/>}
        {page === 'Fund flow' && <FundFlow graph={graph} cases={cases} selectedCase={selectedCase} onSelectCase={loadCaseFlow}/>}
        {page === 'Response center' && <ResponseCenter cases={cases} interventions={interventions} audit={audit} temporal={health.advanced?.temporal || {}} onAction={action} loading={loading} onOpenCase={openCase}/>}
        {page === 'Data sharing' && <DataSharing disclosureLog={disclosures} federation={federation} cases={cases} transactions={transactions}/>}
         {page === 'Evaluation' && <EvaluationPage cases={cases} evaluation={evaluation}/>}
      </section>
    </main>
  </div>;
}

function scenarioTitle(id: string) { return scenarios.find(item => item.id === id)?.title || id.replaceAll('_', ' ').toLowerCase(); }

function Overview({ health, transactions, cases, trackedAccounts, ellipticSummary, onNavigate, onOpenCase, onOpenAccount, onAction, loading }: any) {
  const openCases = cases.filter((item: CaseRecord) => item.status === 'OPEN').length;
  const latest = transactions.slice(0, 4);
  const recentCases = cases.slice(0, 10);
  const activity = transferActivity(transactions);
  const activityMax = Math.max(1, ...activity.map(item => item.count));
  const activityTotal = activity.reduce((sum, item) => sum + item.count, 0);
  const [benchmarkLabel, setBenchmarkLabel] = useState('all');
  const [benchmarkStep, setBenchmarkStep] = useState<number | null>(null);
  const benchmarkSteps = ellipticSummary?.steps || [];
  const pickedBenchmarkStep = benchmarkSteps.find((item: any) => item.step === benchmarkStep) || benchmarkSteps[benchmarkSteps.length - 1];
  const benchmarkMax = Math.max(1, ...benchmarkSteps.map((item: any) => Number(item[benchmarkLabel] ?? (Number(item['1'] || 0) + Number(item['2'] || 0) + Number(item.unknown || 0)))));
  return <>
    <div className="overview-snapshot" aria-label="Current synthetic activity summary"><span><b>{health.transactions ?? transactions.length}</b><small>transfers recorded</small></span><i/><span><b>{openCases}</b><small>cases need review</small></span><i/><span><b>{trackedAccounts.length}</b><small>account labels tracked</small></span><button onClick={() => onNavigate('Investigations')}>Open case queue <ArrowRight size={14}/></button></div>
    <section className="panel activity-pulse" aria-label="Transfer activity over the last hour"><div className="pulse-heading"><span><b>Transfers in the last hour</b><small>Each bar is a five-minute period</small></span><strong>{activityTotal}</strong></div><div className="pulse-bars" role="img" aria-label={`${activityTotal} transfers in the last hour`}>{activity.map((bucket, index) => <span key={index} title={`${bucket.label}: ${bucket.count} transfers`}><i style={{ height: `${Math.max(5, bucket.count / activityMax * 100)}%` }}/></span>)}</div><div className="pulse-axis"><span>60 min ago</span><span>30 min</span><span>Now</span></div>{activityTotal === 0 && <small className="pulse-empty">No transfers recorded in the last hour.</small>}</section>
    {ellipticSummary && <section className="panel research-pulse"><div className="research-pulse-head"><span><small>PUBLIC RESEARCH DATA · BITCOIN</small><b>Elliptic transaction activity</b><i>{Number(ellipticSummary.nodes).toLocaleString()} transactions · {Number(ellipticSummary.edges).toLocaleString()} recorded flow edges</i></span><button onClick={() => onNavigate('Evaluation')}>Explore transactions <ArrowRight size={14}/></button></div><div className="research-pulse-controls"><label>Show<select value={benchmarkLabel} onChange={event=>setBenchmarkLabel(event.target.value)}><option value="all">All labels</option><option value="1">Illicit label</option><option value="2">Licit label</option><option value="unknown">Unknown label</option></select></label><span>{pickedBenchmarkStep ? `Step ${pickedBenchmarkStep.step}: ${Number(pickedBenchmarkStep[benchmarkLabel] ?? Number(pickedBenchmarkStep['1']||0)+Number(pickedBenchmarkStep['2']||0)+Number(pickedBenchmarkStep.unknown||0)).toLocaleString()} transactions` : ''}</span></div><div className="research-pulse-bars" role="img" aria-label="Elliptic dataset transaction counts by time step">{benchmarkSteps.map((item:any)=><button key={item.step} className={pickedBenchmarkStep?.step===item.step?'active':''} title={`Step ${item.step}: ${Number(item[benchmarkLabel]??Number(item['1']||0)+Number(item['2']||0)+Number(item.unknown||0)).toLocaleString()} transactions`} onClick={()=>setBenchmarkStep(item.step)}><i style={{height:`${Math.max(5,Number(item[benchmarkLabel]??Number(item['1']||0)+Number(item['2']||0)+Number(item.unknown||0))/benchmarkMax*100)}%`}}/></button>)}</div><div className="research-pulse-axis"><span>Step 1</span><span>Time step</span><span>Step {benchmarkSteps[benchmarkSteps.length-1]?.step}</span></div></section>}
    <div className="overview-tools"><details className="demo-tools"><summary><RotateCcw size={14}/> Replay a scenario</summary><div>{scenarios.map(item => <button key={item.id} onClick={() => onAction('/scenarios/run', { scenario: item.id })} disabled={loading}>{item.title}</button>)}</div></details><span>Scenarios use synthetic data and add records to this demo.</span></div>
    <div className="ops-grid">
      <section className="panel ops-cases"><SectionTitle title="Cases to review" description="Select a case to see its evidence." action="All cases" onAction={() => onNavigate('Investigations')}/>{recentCases.length ? recentCases.map((item: CaseRecord) => <button className="ops-case" key={item.id} onClick={() => onOpenCase(item.id)}><Severity value={item.severity}/><span><b title="Simulated account holder name">{caseHolderName(item)}</b><small>{item.id} ? {item.tx_ids.length} transfers <span aria-hidden="true">·</span> {stamp(item.created_at)}</small></span><ChevronRight size={16}/></button>) : <Empty title="No cases yet" text="A case appears here when saved transfers match a detection rule."/>}</section>
      <section className="panel ops-transfers"><SectionTitle title="Recent movement" description="Latest saved routes across fictional institutions." action="All accounts" onAction={() => onNavigate('Tracked accounts')}/>{latest.length ? <div className="overview-transfer-list">{latest.map((item: any, index: number) => <article className="overview-transfer" key={item.id}><span className="transfer-mark">{index + 1}</span><div className="overview-transfer-route"><div><button onClick={() => onOpenAccount(item.sender)} title="Open sender account">{item.sender}</button><ArrowRight size={13}/><button onClick={() => onOpenAccount(item.receiver)} title="Open recipient account">{item.receiver}</button></div><small>{item.source_bank} <ArrowRight size={11}/> {item.dest_bank} · {shortTime(item.ts)}</small></div><span className="overview-transfer-meta"><b>{money(item.amount)}</b><small><button onClick={() => onOpenCase(cases.find((c: CaseRecord) => c.tx_ids.includes(item.id))?.id)} disabled={!cases.some((c: CaseRecord) => c.tx_ids.includes(item.id))}>View evidence</button></small></span></article>)}</div> : <Empty title="No transfers yet" text="Saved demo transfers will appear here."/>}</section>
    </div>
  </>;
}

function transferActivity(transactions: any[]) {
  const now = Date.now();
  const buckets = Array.from({ length: 12 }, (_, index) => ({ label: `${55 - index * 5}–${60 - index * 5} min ago`, count: 0 }));
  transactions.forEach(item => {
    const eventTime = new Date(item.ts).getTime();
    const age = now - eventTime;
    if (!Number.isFinite(eventTime) || age < 0 || age >= 60 * 60 * 1000) return;
    buckets[11 - Math.min(11, Math.floor(age / (5 * 60 * 1000)))].count += 1;
  });
  return buckets;
}

function EvaluationPage({ cases, evaluation }: any) {
  const [query, setQuery] = useState('');
  const [caseId, setCaseId] = useState('');
  const matchingCases = cases.filter((item: CaseRecord) => matchesCaseSearch(item, query));
  const selected = cases.find((item: CaseRecord) => item.id === caseId);
  const [benchmark, setBenchmark] = useState<any>(null);
  const [benchmarkError, setBenchmarkError] = useState('');
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [step, setStep] = useState('');
  const [label, setLabel] = useState('all');
  const [nodeQuery, setNodeQuery] = useState('');
  const [activeNode, setActiveNode] = useState('');
  const loadBenchmark = async () => {
    setBenchmarkLoading(true);
    setBenchmarkError('');
    try {
      const data = await api('/evaluation/elliptic');
      setBenchmark({nodes:data.nodes.map((row:any)=>({id:row[0],step:row[1],label:row[2]})),links:data.edges,source:data.dataset});
      setStep(''); setLabel('all'); setActiveNode('');
    } catch (error: any) { setBenchmarkError(error.message || 'The local public benchmark is not ready.'); }
    finally { setBenchmarkLoading(false); }
  };
  useEffect(()=>{void loadBenchmark();},[]);
  const nodes = benchmark?.nodes || [];
  const visibleNodes = nodes.filter((node: any) => (!step || String(node.step)===step) && (label==='all' || node.label===label) && node.id.toLowerCase().includes(nodeQuery.toLowerCase()));
  const shownNodes = visibleNodes.slice(0,100);
  const stepOptions = [...new Set<number>(nodes.map((node:any)=>node.step).filter(Number.isFinite))].sort((a,b)=>a-b);
  const labelCounts = ['1','2','unknown'].map(value => ({value,count:nodes.filter((node:any)=>node.label===value).length}));
  const neighbors = benchmark?.links.filter((edge:[string,string]) => edge[0]===activeNode || edge[1]===activeNode) || [];
  return <div className="evaluation-workspace">
    <section className="panel benchmark-panel"><div className="benchmark-heading"><div><span className="eyebrow">PUBLIC RESEARCH BENCHMARK</span><h2>Explore real transaction patterns</h2><p>Explore labeled transaction nodes and directed flow edges from the Elliptic Bitcoin dataset. This is on-chain cryptocurrency data, separate from ScamTrace’s synthetic bank scenarios.</p></div><div className="benchmark-source-actions"><a className="button subtle" href="https://www.kaggle.com/datasets/ellipticco/elliptic-data-set" target="_blank" rel="noreferrer">Dataset source <ExternalLink size={14}/></a><button className="button subtle" onClick={()=>void loadBenchmark()} disabled={benchmarkLoading}>{benchmarkLoading?'Loading…':'Reload local data'}</button></div></div>
      {benchmarkError && <p className="benchmark-error">{benchmarkError} To prepare the downloaded dataset, run <code>python scripts/prepare_elliptic_benchmark.py data/elliptic-data-set.zip</code>.</p>}
      {benchmark ? <><div className="benchmark-stats"><span><b>{nodes.length.toLocaleString()}</b><small>transactions</small></span><span><b>{benchmark.links.length.toLocaleString()}</b><small>directed flow edges</small></span>{labelCounts.map(item=><button key={item.value} className={label===item.value?'active':''} onClick={()=>setLabel(label===item.value?'all':item.value)}><b>{item.count.toLocaleString()}</b><small>{item.value==='1'?'labelled illicit':item.value==='2'?'labelled licit':'unknown class'}</small></button>)}</div><div className="benchmark-controls"><label>Time step<select value={step} onChange={e=>setStep(e.target.value)}><option value="">All time steps</option>{stepOptions.map(value=><option key={value} value={String(value)}>Step {value}</option>)}</select></label><label className="search-field"><Search size={15}/><input value={nodeQuery} onChange={e=>setNodeQuery(e.target.value)} placeholder="e.g. 230425980"/></label><span>{visibleNodes.length.toLocaleString()} match · showing up to 100</span><button className="example-link" onClick={()=>setNodeQuery('230425980')}>Try 230425980</button></div><div className="benchmark-explorer"><div className="benchmark-node-list">{shownNodes.map((node:any)=><button key={node.id} className={activeNode===node.id?'active':''} onClick={()=>setActiveNode(node.id)}><code>{node.id}</code><span>Step {node.step} · {node.label==='1'?'Illicit':node.label==='2'?'Licit':'Unlabelled'}</span></button>)}</div><aside className="benchmark-node-detail">{activeNode ? <><b>Transaction {activeNode}</b><small>{neighbors.length} connected flow edge(s)</small>{neighbors.slice(0,30).map((edge:[string,string])=><div key={`${edge[0]}-${edge[1]}`} className="benchmark-edge"><code>{edge[0]===activeNode?'out':'in'}</code><span>{edge[0]} → {edge[1]}</span></div>)}</> : <p>Select a transaction to inspect its recorded neighboring flows.</p>}</aside></div></> : !benchmarkError && <p className="muted-copy">Loading locally prepared transaction and flow records…</p>}
    </section>
    <aside className="panel evaluation-case-panel"><SectionTitle title="Recent cases" description={`${cases.length} synthetic cases`}/><label className="search-field case-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Type a case number" aria-label="Search cases under evaluation"/></label>{cases[0] && <button className="example-link" onClick={()=>setQuery(cases[0].id)}>Try {cases[0].id}</button>}<div className="evaluation-case-list">{matchingCases.slice(0,30).map((item: CaseRecord)=><button key={item.id} className={caseId===item.id?'active':''} onClick={()=>setCaseId(item.id)}><b title="Simulated account holder name">{caseHolderName(item)}</b><small>{item.id} ? {item.status} ? {item.tx_ids.length} transfers</small></button>)}</div>{matchingCases.length===0 && <p className="muted-copy">No case number matches that search.</p>}{selected ? <div className="selected-evaluation"><b title="Simulated account holder name">{caseHolderName(selected)}</b><span>{selected.severity} ? {selected.status} ? {selected.tx_ids.length} evidence transfers</span><small>Rules: {selected.rules.map(rule => ruleNames[rule] || rule.replaceAll('_',' ').toLowerCase()).join(', ') || 'not recorded'}</small><small>Evidence IDs: {selected.tx_ids.join(', ')}</small></div> : <p className="muted-copy">Choose a case to inspect its evidence.</p>}</aside>
    <p className="benchmark-note">The Elliptic benchmark concerns cryptocurrency transactions. It can demonstrate graph exploration, but it does not validate cross-bank detection or provide institution identities. {evaluation?.status || ''}</p>
  </div>;
}

function TrackedAccounts({ accounts, onOpen, running }: any) {
  const [search, setSearch] = useState('');
  const filtered = accounts.filter((account: any) => account.account_id.toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="account-tracker-status"><span className={`ops-dot ${running ? 'active' : ''}`}/><span><b>{accounts.length} tracked account labels</b><small>Only accounts linked to a detector case or streaming alert are listed. This is not an identity or guilt assessment.</small></span></div>
    <section className="panel table-panel"><SectionTitle title="Accounts under review" description="Select an account to see its case history and recorded transfers."/><label className="search-field case-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find an account label" aria-label="Search tracked accounts"/></label>{filtered.length ? <div className="tracked-account-list">{filtered.map((account: any) => <button key={account.account_id} className="tracked-account-row" onClick={() => onOpen(account.account_id)}><span className="account-avatar"><Network size={17}/></span><span className="tracked-id"><b>{account.account_id}</b><small>Last event {stamp(account.last_seen)} ? {account.case_count} linked case(s)</small></span><span><small>Received</small><b>{money(account.received_total)}</b></span><span><small>Sent</small><b>{money(account.sent_total)}</b></span><ChevronRight size={16}/></button>)}</div> : <Empty title={search ? 'No matching tracked account' : 'No accounts under review'} text={search ? 'Try another account label.' : 'Accounts appear here only after a detector case or stream alert links them to suspicious activity.'}/>}</section>
  </>;
}

function Investigations({ cases, allCases, selectedId, detail, graph, caseLoading, caseError, accountDetail, selectedAccount, search, setSearch, onOpen, onOpenAccount, health, interventions, alerts, flink, onNavigate, onAction, loading }: any) {
  return <>
    <section className="panel investigation-tools"><div><b>{allCases.length} cases available</b><small>Browse existing evidence or generate a fresh synthetic review bundle.</small></div><button className="button primary" onClick={() => onAction('/scenarios/seed-review-cases')} disabled={loading}>Add synthetic cases</button></section>
    <div className="investigation-layout"><section className="panel case-queue"><SectionTitle title="Case history" description={`${allCases.length} cases ? newest first`}/><label className="search-field case-search"><Search size={16}/><input aria-label="Search investigations by case number" placeholder="Type a case number or account" value={search} onChange={event => setSearch(event.target.value)}/></label>{cases.length ? cases.map((item: CaseRecord) => <button key={item.id} className={`queue-item ${selectedId === item.id && !selectedAccount ? 'selected' : ''}`} onClick={() => onOpen(item.id)}><Severity value={item.severity}/><b title="Simulated account holder name">{caseHolderName(item)}</b><small>{item.id} ? {stamp(item.created_at)}</small><span className="queue-meta">{item.status} ? {item.tx_ids.length} transfers ? {item.accounts.length} accounts</span></button>) : <Empty title="No cases recorded" text="Generated synthetic scenarios appear here when their transfer records match a rule."/>}</section><section className="panel case-reader">{caseLoading ? <div className="case-load-state" role="status">Loading persisted case records?</div> : caseError ? <div className="case-load-state error" role="alert"><b>Case records could not be loaded</b><p>{caseError}</p></div> : accountDetail ? <AccountReader profile={accountDetail} onOpenCase={onOpen} onOpenAccount={onOpenAccount}/> : detail ? <CaseReader key={detail.case.id} detail={detail} graph={graph} health={health} intervention={interventions.find((item: any) => item.case_id === detail.case.id)} onNavigate={onNavigate} onOpenAccount={onOpenAccount} onRefresh={onOpen}/> : <Empty title="Select a case or tracked account" text="Choose an item from the list to inspect its evidence."/>}</section></div>
    {alerts.length > 0 && <section className="panel compact-alerts"><SectionTitle title="Flink stream alerts" description="Additional time-window findings from the optional stream processor."/><div>{alerts.slice(0,5).map((item: any) => <article key={item.alert_key}><TriangleAlert size={16}/><span><b>{item.rule_id || 'Pattern alert'} ? {item.sender}</b><small>{item.transaction_count} transfers ? {item.distinct_recipients} recipients ? {stamp(item.received_at)}</small></span></article>)}</div></section>}
    {alerts.length === 0 && flink.connected && <div className="stream-status-note"><Zap size={15}/> Flink is connected ? no stream alerts to review</div>}
  </>;
}

function CaseReader({ detail, graph, health, intervention, onNavigate, onOpenAccount, onRefresh }: any) {
  const record = detail.case;
  const report = detail.report || {};
  const transactions = detail.transactions || [];
  const policy = detail.sharing_policy || {};
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [requestTx, setRequestTx] = useState(transactions[0]?.id || '');
  const [institution, setInstitution] = useState('');
  const [investigatorToken, setInvestigatorToken] = useState('');
  const [institutionToken, setInstitutionToken] = useState('');
  const [requestFields, setRequestFields] = useState<string[]>((policy.evidence_fields || []).filter((field: string) => ['local_account_id','institution_record_status'].includes(field)));
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [requestEvidence, setRequestEvidence] = useState<any>(null);
  const tx = transactions.find((item: any) => item.id === requestTx);
  const participants = tx ? [...new Set([tx.source_bank, tx.dest_bank])] : [];
  const chosenInstitution = participants.includes(institution) ? institution : (participants[0] || '');
  const submitEvidenceRequest = async () => {
    if (!investigatorToken || !requestTx || !chosenInstitution || requestFields.length === 0) { setRequestMessage('Choose a transaction, permitted fields, institution, and configured investigator token.'); return; }
    setRequestBusy(true); setRequestMessage('');
    try {
      const result = await api('/evidence-requests', { method: 'POST', headers: { Authorization: `Bearer ${investigatorToken}` }, body: JSON.stringify({ case_id: record.id, transaction_id: requestTx, institution: chosenInstitution, fields: requestFields, purpose: policy.evidence_purpose, justification: 'Review local synthetic evidence supporting this investigation.' }) });
      setRequestMessage(`Request ${result.id} recorded as ${result.status}; institution reviewer decision is still required.`);
      await onRefresh(record.id);
    } catch (error: any) { setRequestMessage(error.message); }
    finally { setRequestBusy(false); }
  };
  const loadEvidenceResponse = async (request: any) => {
    try {
      const result = await api(`/evidence-requests/${request.id}`, { headers: { Authorization: `Bearer ${investigatorToken}` } });
      setRequestEvidence({ id: request.id, status: result.status, institution: result.institution, transaction_id: result.transaction_id, fields: result.fields, evidence: result.evidence });
      setRequestMessage(result.evidence ? `Authorized evidence response loaded for ${request.id}.` : `Request record loaded: ${request.id} is ${result.status}.`);
      await onRefresh(record.id);
    } catch (error: any) { setRequestMessage(error.message); }
  };
  const decideEvidenceRequest = async (request: any, approve: boolean) => {
    try {
      const result = await api(`/evidence-requests/${request.id}/decision`, { method: 'POST', headers: { Authorization: `Bearer ${institutionToken}` }, body: JSON.stringify({ approve }) });
      setRequestMessage(`Participating institution recorded ${result.status} for ${request.id}.`);
      await onRefresh(record.id);
    } catch (error: any) { setRequestMessage(error.message); }
  };
  const selectTransaction = (id: string) => setSelectedTx(transactions.find((item: any) => item.id === id) || null);
  return <>
    <div className="case-reader-heading"><div><Severity value={record.severity}/><h2>{caseHolderName(record)}</h2><small><a className="record-link" href={`?case=${encodeURIComponent(record.id)}`}>{record.id}</a> · Detected {stamp(record.detection_ts || record.created_at)}</small></div><StatePill value={record.status}/></div>
    <div className="case-summary"><b>Incident summary</b><p>{report.summary}</p><small>This is a detection alert for review, not a confirmed fraud finding. All records are synthetic.</small></div>
    <div className="case-institutions"><b>Institutions in this evidence</b><span>{[...new Set(transactions.flatMap((item: any) => [item.source_bank, item.dest_bank]))].join(' → ') || 'No institution fields recorded'}</span><small>Institution links come from the recorded synthetic transaction route. Account tokens do not establish ownership.</small></div>
    <div className="explain-grid"><Definition label="Severity" value={severityText(record.severity)} help="How strongly the current demo policy prioritizes the pattern. It is not a probability of guilt."/><Definition label="Triggered rules" value={(record.rules || []).map((rule: string) => ruleNames[rule] || rule.replaceAll('_',' ').toLowerCase()).join(' · ') || 'No rule list recorded'} help="The pattern checks that contributed to this case."/><Definition label="Linked account labels" value={`${record.accounts.length}`} help="Account labels connected by observed transfers. Identity and control are unknown."/><Definition label="Supporting records" value={`${record.tx_ids.length} transactions`} help="Each identifier opens its stored synthetic transaction record below."/></div>
    <SectionTitle title="Transaction timeline" description="Chronological persisted events across the participating fictional institutions. Select a transaction ID for its record or an account label for its dossier."/><div className="event-timeline">{transactions.length ? transactions.slice().sort((a: any,b: any) => String(a.ts).localeCompare(String(b.ts))).map((item: any) => <div className="event-point" key={item.id}><i/><div><b><button className="inline-record-link" onClick={() => onOpenAccount(item.sender)}>{item.sender}</button> <ArrowRight size={13}/> <button className="inline-record-link" onClick={() => onOpenAccount(item.receiver)}>{item.receiver}</button> · {money(item.amount)} {item.currency}</b><small>{stamp(item.ts)} · {item.source_bank} → {item.dest_bank} · {item.rail} · {item.status} · <button className="inline-record-link" onClick={() => selectTransaction(item.id)}>{item.id}</button></small></div></div>) : <Empty title="No stored events linked" text="This case record currently has no matching persisted transactions."/>}</div>
    <SectionTitle title="Fund movement graph" description="Built from the persisted case transactions. Select an edge to inspect the transaction; select a node to open its account dossier."/><section className="panel case-graph"><FlowMap nodes={graph?.nodes || []} edges={graph?.edges || []} cases={[record]} onSelectEdge={(edge: any) => selectTransaction(edge.id)} onSelectNode={(id: string) => onOpenAccount(id)}/></section>
    {selectedTx && <TransactionDetails transaction={selectedTx} onClose={() => setSelectedTx(null)}/>}
    <SectionTitle title="Evidence and observed relationships" description="Recorded facts are separated from inferred conclusions."/><section className="case-evidence-list">{transactions.map((item: any) => <article key={item.id}><div><button className="inline-record-link" onClick={() => selectTransaction(item.id)}>{item.id}</button><span>{stamp(item.ts)}</span></div><p>{money(item.amount)} {item.currency} · {item.source_bank} → {item.dest_bank} · {item.rail} · {item.status}</p><small>Observed edge: <button className="inline-record-link" onClick={() => onOpenAccount(item.sender)}>{item.sender}</button> sent to <button className="inline-record-link" onClick={() => onOpenAccount(item.receiver)}>{item.receiver}</button>. Matching tokens reconstruct the synthetic route; this does not show who controls either account.</small></article>)}</section>
    <div className="audit-event-list">{(detail.disclosure_events || []).filter((event: any) => event.transaction_id).slice(0,12).map((event: any) => <article key={`signal-${event.id}`}><b>{event.event_type} · {event.institution}</b><p>{event.detail}</p><small>{event.transaction_id} · {stamp(event.ts)} · {event.actor_id} · fields: {(event.fields || []).join(', ')}</small></article>)}</div>
    <div className="case-request-box"><b>Request additional synthetic evidence</b><p>Requests are limited to the institution involved in the selected transaction and fields permitted by policy.</p><div className="disclosure-form"><label>Transaction<select value={requestTx} onChange={event => setRequestTx(event.target.value)}>{transactions.map((item: any) => <option value={item.id} key={item.id}>{item.id} · {item.source_bank} → {item.dest_bank}</option>)}</select></label><label>Participating institution<select value={chosenInstitution} onChange={event => setInstitution(event.target.value)}>{participants.map((name: string) => <option value={name} key={name}>{name}</option>)}</select></label><label>Investigator authorization token<input type="password" autoComplete="off" value={investigatorToken} onChange={event => setInvestigatorToken(event.target.value)} placeholder="Configured server token"/></label><fieldset><legend>Permitted evidence fields</legend>{(policy.evidence_fields || []).map((field: string) => <label className="check-field" key={field}><input type="checkbox" checked={requestFields.includes(field)} onChange={event => setRequestFields(old => event.target.checked ? [...old,field] : old.filter(item => item !== field))}/>{field}</label>)}</fieldset><button className="button primary" disabled={requestBusy || !transactions.length} onClick={() => void submitEvidenceRequest()}>{requestBusy ? 'Submitting…' : 'Submit evidence request'}</button>{requestMessage && <p role="status">{requestMessage}</p>}</div></div>
    {detail.evidence_requests?.length > 0 && <><SectionTitle title="Evidence request history" description="Each request requires an institution decision; evidence is only retrieved with investigator authorization."/>{detail.evidence_requests.map((request: any) => <article className="case-request-row" key={request.id}><div><button className="inline-record-link" onClick={() => void loadEvidenceResponse(request)}>{request.id}</button><StatePill value={request.status}/><p><button className="inline-record-link" onClick={() => selectTransaction(request.transaction_id)}>{request.transaction_id}</button> · {request.institution} · fields: {request.fields.join(', ')}</p><small>Requested by {request.requester} · purpose: {request.purpose}</small>{request.status === 'PENDING' && <details className="reviewer-decision"><summary>Participating institution review</summary><label>Institution reviewer token<input type="password" autoComplete="off" value={institutionToken} onChange={event => setInstitutionToken(event.target.value)} placeholder="Configured reviewer token"/></label><div><button className="button subtle" onClick={() => void decideEvidenceRequest(request,true)}>Approve permitted evidence</button><button className="button subtle" onClick={() => void decideEvidenceRequest(request,false)}>Deny request</button></div></details>}</div>{request.status === 'APPROVED' && <button className="button subtle" onClick={() => void loadEvidenceResponse(request)}>Load approved evidence</button>}</article>)}</>}
    <SectionTitle title="Intervention history" description="Simulated workflow records and the policy reason recorded at creation."/>{detail.interventions?.length ? detail.interventions.map((item: any) => <article className="case-request-row" key={item.id}><div><button className="inline-record-link" onClick={() => onNavigate('Response center')}>{item.id}</button><StatePill value={item.status}/><p>{stateMeaning[item.status] || 'A simulated response state is recorded.'}</p><small>Policy: {(detail.audit_history || []).find((event: any) => event.intervention_id === item.id)?.detail?.replace(/^Policy:\s*/,'') || 'No policy detail recorded'} · institution {item.institution} · created {stamp(item.created_at)} · updated {stamp(item.updated_at)}</small></div><button className="button subtle" onClick={() => onNavigate('Response center')}>Open response history</button></article>) : <Empty title="No intervention request" text="No policy-triggered simulated intervention exists for this case."/>}
    {(requestEvidence || requestMessage) && requestEvidence && <pre className="disclosure-evidence">{JSON.stringify(requestEvidence,null,2)}</pre>}
    <SectionTitle title="Relevant audit history" description="Signal disclosure, evidence-request access, and simulated intervention transitions for this case."/>{detail.audit_history?.length ? <div className="audit-event-list">{detail.audit_history.map((event: any, index: number) => <article key={`${event.event_type}-${event.id}-${index}`}><b>{event.event_type || event.to_state} · {event.institution || event.to_state}</b><p>{event.detail}</p><small>{stamp(event.ts)} · {event.actor_id || 'simulated service'} · {event.transaction_id || event.intervention_id || event.request_id || ''} · fields: {(event.fields || []).join(', ') || '—'}</small></article>)}</div> : <Empty title="No linked audit events" text="No disclosure, access, or intervention audit events are attached to this case yet."/>}
    <div className="case-footer-actions"><button className="button subtle" onClick={() => onRefresh(record.id)}><RotateCcw size={14}/> Refresh case records</button><button className="button subtle" onClick={() => onNavigate('Response center')}>Response center <ArrowRight size={14}/></button><button className="button subtle" onClick={() => onNavigate('Fund flow')}>Fund flow <GitBranch size={14}/></button></div>
  </>;
}

function AccountReader({ profile, onOpenCase }: any) {
  return <>
    <div className="account-dossier-head"><div><div className="eyebrow">SIMULATED ACCOUNT HOLDER</div><h2>{accountHolderName(profile.account_id)}</h2><small>{profile.account_id} ? Activity from {stamp(profile.first_seen)} to {stamp(profile.last_seen)}</small></div><StatePill value={profile.open_case_count ? `${profile.open_case_count} open case(s)` : `${profile.case_count} linked case(s)`}/></div>
    <div className="account-dossier-metrics"><Metric icon={ArrowDownLeft} label="Received" value={money(profile.received_total)} detail={`${profile.incoming_count} recorded incoming transfers`} tone="teal"/><Metric icon={ArrowUpRight} label="Sent" value={money(profile.sent_total)} detail={`${profile.outgoing_count} recorded outgoing transfers`} tone="blue"/><Metric icon={ShieldAlert} label="Linked cases" value={profile.case_count} detail="Cases whose recorded evidence includes this account label." tone="amber"/></div>
    <section className="dossier-section"><SectionTitle title="Case history" description="Open any related case to review why it was flagged."/>{profile.cases.length ? profile.cases.map((item: any) => <button key={item.id} className="ops-case" onClick={() => onOpenCase(item.id)}><Severity value={item.severity}/><span><b title="Simulated account holder name">{caseHolderName(item)}</b><small>{item.id} ? {item.status} ? {stamp(item.created_at)}</small></span><ChevronRight size={16}/></button>) : <div className="ops-empty">This account appears in a stream alert, but no investigation case is linked yet.</div>}</section>
    <section className="dossier-section"><SectionTitle title="Recorded transactions" description={profile.history_complete ? `${profile.transaction_count} total · showing the ${profile.transactions.length} most recent.` : `${profile.transactions.length} matching recent records loaded · totals may be partial until the API is updated.`}/>{profile.transactions.length ? <TransactionTable rows={profile.transactions} onSelect={() => {}} compact/> : <div className="ops-empty">No transaction records found.</div>}</section>
    <div className="evidence-note"><Info size={16}/><span>These are synthetic account labels. The totals summarize recorded transfers; they do not establish identity, ownership, or wrongdoing.</span></div>
  </>;
}

function FundFlow({ graph, cases, selectedCase, onSelectCase }: any) {
  const [caseSearch, setCaseSearch] = useState('');
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState('');
  const matchingCases = cases.filter((item: CaseRecord) => matchesCaseSearch(item, caseSearch));
  const current = cases.find((item: CaseRecord) => item.id === selectedCase);
  const edges = (graph.edges || []).slice().sort((a: any, b: any) => String(a.ts).localeCompare(String(b.ts)));
  const nodeTransfers = selectedNode ? edges.filter((edge: any) => edge.sender === selectedNode || edge.receiver === selectedNode) : [];
  return <>
    <section className="panel flow-case-picker"><label>Search cases<input value={caseSearch} onChange={event => setCaseSearch(event.target.value)} placeholder="Type a case number"/></label><label>Investigation<select value={selectedCase} onChange={event => { setSelectedNode(''); setSelectedTx(null); onSelectCase(event.target.value); }}><option value="">Choose a case to trace</option>{matchingCases.map((item: CaseRecord) => <option key={item.id} value={item.id}>{item.id} ? {caseHolderName(item)}</option>)}</select></label>{current && <span>{current.accounts.length} linked accounts ? {current.tx_ids.length} evidence transfers</span>}</section>
    {!selectedCase ? <Empty title="Choose an investigation" text="Select a case to see its recorded transfers and reconstructed route."/> : <>
      <section className="panel graph-intro"><div><div className="graph-icon"><GitBranch size={22}/></div><div><h2>{current ? caseHolderName(current) : 'Case transfer path'}</h2><p>Read the arrows from sender to receiver. Select an arrow for its record or a circle to see transfers around that account.</p></div></div><div className="graph-summary"><span><b>{graph.nodes?.length || 0}</b> accounts</span><span><b>{edges.length}</b> transfers</span></div></section>
      <section className="panel flow-map-panel"><FlowMap nodes={graph.nodes || []} edges={graph.edges || []} cases={current ? [current] : []} onSelectEdge={(edge: any) => setSelectedTx(edge)} onSelectNode={(id: string) => { setSelectedTx(null); setSelectedNode(id); }}/></section>
      {selectedTx && <TransactionDetails transaction={selectedTx} onClose={() => setSelectedTx(null)}/>}
      {selectedNode && <section className="panel selected-evaluation"><b>Account {selectedNode}</b><span>{nodeTransfers.length} connected transfer(s) in this case</span><small>{nodeTransfers.map((edge: any) => `${edge.id}: ${edge.sender} ? ${edge.receiver}`).join(' ? ')}</small><button className="button subtle" onClick={() => setSelectedNode('')}>Close account details</button></section>}
      <section className="panel flow-steps"><SectionTitle title="Transfer sequence" description="Steps are ordered by event time; each row names the sender, receiver, institution handoff, and amount."/>{edges.length ? edges.map((edge: any, index: number) => <button className="flow-step flow-step-button" key={edge.id} onClick={() => setSelectedTx(edge)}><span>{index + 1}</span><div><b>{edge.sender} <ArrowRight size={14}/> {edge.receiver}</b><small>{edge.source_bank} ? {edge.dest_bank} ? {stamp(edge.ts)} ? {edge.id} ? {edge.rail}</small></div><strong>{money(edge.amount)}</strong></button>) : <Empty title="No transfer evidence" text="The selected case has no linked transfer rows."/>}</section>
    </>}
  </>;
}

function FlinkAlerts({ alerts, service, onNavigate }: any) {
  return <>
    <div className="alert-criteria"><div className="criteria-icon"><Zap size={21}/></div><div><span className="eyebrow">STREAMING RULE IN THIS DEMO</span><h2>Fast fan-out in one minute</h2><p>Flink looks for an account with at least four transfers to three or more different recipients in a one-minute event-time window. This is a signal to review, not a conclusion that wrongdoing occurred.</p></div><StatePill value={service.state || 'Not configured'}/></div>
    <div className="metric-grid compact-metrics"><Metric icon={BellRing} label="Alerts received" value={alerts.length} detail="Alert messages saved by the app from the Flink output topic." tone="blue"/><Metric icon={Activity} label="Service status" value={service.state || 'Not configured'} detail="Checks whether the optional Flink dashboard is responding." tone={service.connected ? 'green' : 'amber'}/><Metric icon={Database} label="Matching events" value={alerts.reduce((sum: number, item: any) => sum + Number(item.transaction_count || 0), 0)} detail="Total event counts across the alert records currently stored." tone="teal"/><Metric icon={Network} label="Recipients" value={alerts.reduce((max: number, item: any) => Math.max(max, Number(item.distinct_recipients || 0)), 0)} detail="Largest recipient count among saved alert windows." tone="amber"/></div>
    <section className="panel table-panel"><SectionTitle title="Streaming alert inbox" description="Each alert names the sender, time window, number of transfers, and recipient count." action="View service status" onAction={() => onNavigate('System guide')}/>{alerts.length ? <div className="alert-list">{alerts.map((item: any) => <article className="alert-row" key={item.alert_key}><div className="alert-symbol"><TriangleAlert size={19}/></div><div className="alert-content"><div className="alert-title"><b>{item.rule_id || 'Streaming pattern'}</b><StatePill value="Needs review"/></div><p>{item.explanation || 'The event window matched the configured fast fan-out rule.'}</p><div className="alert-facts"><span>Sender <b>{item.sender}</b></span><span>Transfers <b>{item.transaction_count}</b></span><span>Different recipients <b>{item.distinct_recipients}</b></span><span>Total amount <b>{money(item.amount_total)}</b></span></div><small>Window {stamp(item.window_start)} – {stamp(item.window_end)} · received by app {stamp(item.received_at)}</small></div></article>)}</div> : <Empty title="No streaming alerts received" text={service.connected ? 'The service is connected. Run a guided example or wait for a stream window that matches the rule.' : 'Flink is optional and is not connected right now. Local detector cases still work. Start the advanced stack to enable this alert stream.'}/>}</section>
    <div className="evidence-note"><Info size={17}/><span><b>Why this may be useful:</b> event-time windows let the demo examine activity as it arrives, instead of waiting for a file upload. The alert inbox only receives findings when Redpanda and Flink are running and the app has been configured to connect.</span></div>
  </>;
}

function ResponseCenter({ cases, interventions, audit, onAction, loading, onOpenCase }: any) {
  const [requestCase, setRequestCase] = useState('');
  const existingCaseIds = new Set(interventions.map((item: any) => item.case_id));
  const requestableCases = cases.filter((item: CaseRecord) => !existingCaseIds.has(item.id));
  const outcomes = [['SUBMITTED', 'Mark submitted'], ['ACKNOWLEDGED', 'Record acknowledgement'], ['STILL_NOT_APPROVED', 'Still not approved'], ['NEEDS_INFORMATION', 'Request more information'], ['REJECTED', 'Record rejection'], ['PENDING', 'Keep pending'], ['SIMULATED_HOLD', 'Record simulated hold'], ['EXPIRED', 'Mark expired']];
  return <>
    <div className="response-purpose"><Workflow size={18}/><span><b>Simulated response tracking</b><small>These states are recorded in this local synthetic demo. They do not contact institutions or affect payments.</small></span></div>
    <section className="panel response-board"><SectionTitle title="Requests" description={`${interventions.length} requests ? newest first`}/><div className="new-request-row"><label>Case<select value={requestCase} onChange={event => setRequestCase(event.target.value)}><option value="">Choose a case for a new request</option>{requestableCases.map((item: CaseRecord) => <option key={item.id} value={item.id}>{item.id} ? {caseHolderName(item)}</option>)}</select></label><button className="button primary" onClick={() => requestCase && onAction('/interventions', { case_id: requestCase })} disabled={!requestCase || loading}>Submit request</button></div>{interventions.length ? interventions.map((item: any) => <article className="response-item" key={item.id}><div className="response-item-head"><StatePill value={item.status}/><b>{item.case_id}</b><button className="text-link" onClick={() => onOpenCase(item.case_id)}>Open case <ArrowUpRight size={14}/></button></div><div className="response-item-meta"><span>Institution <b>{item.institution}</b></span><span>Submitted <b>{stamp(item.created_at)}</b></span><span>Updated <b>{stamp(item.updated_at)}</b></span></div>{['SUBMITTED','REVIEW_REQUESTED','PENDING','STILL_NOT_APPROVED','NEEDS_INFORMATION'].includes(item.status) && <div className="response-actions">{outcomes.map(([outcome, label]) => <button key={outcome} className="button subtle" onClick={() => onAction(`/interventions/${item.id}/response`, { outcome })} disabled={loading}>{label}</button>)}</div>}{['REJECTED','EXPIRED','STILL_NOT_APPROVED'].includes(item.status) && <button className="button subtle response-retry" onClick={() => onAction(`/interventions/${item.id}/retry`)} disabled={loading}>Resubmit request</button>}</article>) : <Empty title="No response requests" text="Submit a request for one of the current cases to start recording simulated responses."/>}</section>
    <section className="panel audit-panel"><SectionTitle title="Request history" description="Recorded state changes for all requests."/>{audit.length ? audit.map((item: any) => <div className="audit-entry" key={item.id}><span className="audit-marker"/><div><b>{item.from_state || 'Created'} <ArrowRight size={14}/> {item.to_state}</b><p>{item.detail}</p><small>{item.intervention_id} ? {stamp(item.ts)}</small></div></div>) : <div className="ops-empty">State changes will appear here.</div>}</section>
  </>;
}

function DataSharing({ disclosureLog, federation, cases, transactions }: any) {
  const [investigatorToken, setInvestigatorToken] = useState('');
  const [institutionToken, setInstitutionToken] = useState('');
  const [caseId, setCaseId] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [institution, setInstitution] = useState('');
  const [instructions, setInstructions] = useState('Review the synthetic transfer evidence supporting this case.');
  const [requestId, setRequestId] = useState('');
  const [evidence, setEvidence] = useState<any>(null);
  const [message, setMessage] = useState('');
  const policy = disclosureLog.policy || {};
  const selectedCase = cases.find((item: any) => item.id === caseId) || cases[0];
  const transactionIds = selectedCase?.tx_ids || [];
  const selectedTransaction = transactions.find((item: any) => item.id === (transactionId || transactionIds[0]));
  const participants = selectedTransaction ? [...new Set([selectedTransaction.source_bank, selectedTransaction.dest_bank])] : (federation.institutions || []).map((item: any) => item.name);
  const create = async () => {
    const chosenCase = caseId || selectedCase?.id;
    try {
      const result = await fetch('/api/evidence-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${investigatorToken}` }, body: JSON.stringify({ case_id: chosenCase, transaction_id: transactionId || transactionIds[0], institution: institution || participants[0], fields: ['local_account_id', 'institution_record_status'], purpose: policy.evidence_purpose || 'authorized_case_review', justification: instructions }) });
      const body = await result.json(); if (!result.ok) throw new Error(body.detail || 'Request failed');
      setRequestId(body.id); setMessage(`Request ${body.id} is waiting for review.`); setEvidence(null);
    } catch (error: any) { setMessage(error.message); }
  };
  const decide = async (approve: boolean) => {
    try {
      const result = await fetch(`/api/evidence-requests/${requestId}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${institutionToken}` }, body: JSON.stringify({ approve }) });
      const body = await result.json(); if (!result.ok) throw new Error(body.detail || 'Review failed');
      setEvidence(body.evidence); setMessage(`Review decision: ${body.status}.`); window.dispatchEvent(new Event('scamtrace-refresh'));
    } catch (error: any) { setMessage(error.message); }
  };
  return <div className="ops-grid">
    <section className="panel"><SectionTitle title="Request additional evidence" description="Submit a synthetic evidence request and record its review decision."/><div className="disclosure-form">
      <label>Investigator authorization token<input type="password" autoComplete="off" value={investigatorToken} onChange={e => setInvestigatorToken(e.target.value)} placeholder="Configured server token"/></label>
      <label>Case<select value={caseId || selectedCase?.id || ''} onChange={e => { setCaseId(e.target.value); setTransactionId(''); }}><option value="">Choose a case</option>{cases.map((item: any) => <option key={item.id} value={item.id}>{item.id} ? {caseHolderName(item)}</option>)}</select></label>
      <label>Evidence transaction<select value={transactionId || transactionIds[0] || ''} onChange={e => setTransactionId(e.target.value)}>{transactionIds.map((id: string) => <option key={id} value={id}>{id}</option>)}</select></label>
      <label>Institution<select value={participants.includes(institution) ? institution : (participants[0] || '')} onChange={e => setInstitution(e.target.value)}>{participants.map((name: string) => <option key={name} value={name}>{name}</option>)}</select></label>
      <div className="example-input-note"><span>Example inputs: <code>{selectedCase?.id || "case ID"}</code> ? <code>{transactionIds[0] || "transaction ID"}</code> ? <code>{participants[0] || "institution"}</code></span><button type="button" onClick={() => { if (!cases[0]) return; setCaseId(cases[0].id); setTransactionId(cases[0].tx_ids[0] || ""); setInstitution(""); setInstructions("Review the synthetic transfer evidence supporting this case."); }}>Use example</button></div>
      <label>Instructions<textarea value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={500} rows={3} placeholder="Explain what evidence should be reviewed"/></label>
      <button className="button primary" onClick={() => void create()} disabled={!selectedCase || !transactionIds.length || !investigatorToken}>Submit evidence request</button>
      {requestId && <><label>Reviewer authorization token<input type="password" autoComplete="off" value={institutionToken} onChange={e => setInstitutionToken(e.target.value)} placeholder="Configured reviewer token"/></label><div className="response-actions"><button className="button subtle" onClick={() => void decide(true)} disabled={!institutionToken}>Approve request</button><button className="button subtle" onClick={() => void decide(false)} disabled={!institutionToken}>Deny request</button></div></>}
      {message && <p role="status">{message}</p>}{evidence && <pre className="disclosure-evidence">{JSON.stringify(evidence,null,2)}</pre>}
    </div></section>
    <section className="panel"><SectionTitle title="Disclosure history" description="Recorded requests, decisions, responses, and denials."/>{disclosureLog.events?.length ? disclosureLog.events.slice(0,80).map((item: any) => <div className="audit-entry" key={item.id}><span className="audit-marker"/><div><b>{item.event_type} ? {item.institution || 'authorization'}</b><p>{item.detail}</p><small>{item.purpose || 'authorization'} ? fields: {(item.fields || []).join(', ') || 'none'} ? {stamp(item.ts)} {item.actor_id ? `? ${item.actor_id}` : ''}</small></div></div>) : <div className="ops-empty">No disclosure events have been recorded.</div>}</section>
  </div>;
}


function SystemGuide({ health, evaluation, interventions }: any) {
  const advanced = health.advanced || {};
  const services = [
    { key: 'event_bus', icon: Radio, name: 'Redpanda event bus', purpose: 'Carries each new synthetic transaction to the streaming detector.', state: advanced.event_bus?.state || 'Not configured', detail: advanced.event_bus?.connected ? 'The app has successfully published to the event topic.' : (advanced.event_bus?.broker_connected ? 'The broker is ready; it will confirm publishing when the next event arrives.' : 'The local event broker is not responding yet.'), url: null },
    { key: 'flink', icon: Zap, name: 'Apache Flink detector', purpose: 'Checks sender activity for four transfers to at least three recipients in one minute.', state: advanced.flink?.state || 'Not configured', detail: `${health.flink_alerts || 0} returned finding(s) are currently in the alert inbox.`, url: 'http://localhost:8082' },
    { key: 'agent_sandbox', icon: Bot, name: 'Investigation specialist service', purpose: 'Summarizes pattern, network, evidence, and response questions in an isolated container.', state: advanced.agent_sandbox?.state || 'Not configured', detail: advanced.agent_sandbox?.model ? `Configured model: ${advanced.agent_sandbox.model}. Reports still preserve the deterministic event timeline.` : 'Without the optional service, cases use the local structured report.', url: 'http://localhost:8010/health' },
    { key: 'temporal', icon: Workflow, name: 'Temporal response workflow', purpose: 'Keeps a response request open, accepts a simulated outcome, and expires unanswered requests.', state: advanced.temporal?.state || 'Not configured', detail: `${interventions.filter((item: any) => ['REVIEW_REQUESTED','PENDING'].includes(item.status)).length} request(s) are currently awaiting a response.`, url: null },
    { key: 'temporal_graph', icon: GitBranch, name: 'PostgreSQL + Apache AGE', purpose: 'Stores transfer edges with event timestamps so flow history can be filtered over time.', state: advanced.temporal_graph?.state || 'Not configured', detail: `${advanced.temporal_graph?.records || 0} event edge(s) stored in the optional graph database.`, url: null },
    { key: 'otel', icon: Activity, name: 'OpenTelemetry Collector', purpose: 'Collects Redpanda service metrics and makes them available to Prometheus.', state: advanced.monitoring?.otel?.state || 'Not running', detail: 'If offline, the monitoring stack cannot collect broker metrics.', url: null },
    { key: 'prometheus', icon: Activity, name: 'Prometheus metrics', purpose: 'Stores and queries the metrics collected from the optional services.', state: advanced.monitoring?.prometheus?.state || 'Not running', detail: 'Use this local page to inspect raw metric queries.', url: 'http://localhost:9090' },
    { key: 'grafana', icon: Activity, name: 'Grafana dashboard', purpose: 'Opens the optional monitoring dashboard for infrastructure metrics.', state: advanced.monitoring?.grafana?.state || 'Not running', detail: 'Grafana is only for infrastructure monitoring; case evidence stays in this app.', url: 'http://localhost:3000' },
  ];
  return <>
    <HelpBox title="The default app works without the advanced stack" text="Local rules, SQLite storage, investigation reports, and simulated responses run in the base app. Redpanda, Flink, Temporal, AGE, the investigation model, and monitoring are optional services. This page checks their live status instead of assuming they started."/>
    <section className="panel service-board"><SectionTitle title="Live service status" description="Status refreshes with the dashboard. ‘Not configured’ is different from ‘configured but offline’."/><div className="service-grid">{services.map(({ key, ...item }) => <ServiceCard key={key} {...item} service={['otel','prometheus','grafana'].includes(key) ? advanced.monitoring?.[key] : advanced[key]}/>)}</div></section>
    <section className="panel metric-guide"><SectionTitle title="Demo evaluation numbers" description="Loaded from the last run of four small, hand-written scenarios. They are a wiring check, not a claim about real-world fraud detection."/><div className="metric-grid compact-metrics"><Metric icon={CheckCircle2} label="Examples caught" value={`${evaluation?.confusion_counts?.true_positives ?? '—'} / 3`} detail="Suspicious synthetic examples detected by the local detector." tone="teal"/><Metric icon={TriangleAlert} label="Benign examples flagged" value={evaluation?.confusion_counts?.false_positives ?? '—'} detail="The one ordinary high-activity example is a very small check." tone="amber"/><Metric icon={Activity} label="Precision · fixture only" value={percent(evaluation?.precision)} detail="Of flagged examples, the share labelled suspicious in this tiny scenario set." tone="blue"/><Metric icon={Zap} label="Recall · fixture only" value={percent(evaluation?.recall)} detail="Of suspicious examples, the share caught in this tiny scenario set." tone="green"/></div><div className="benchmark-list">{(evaluation?.scenarios || []).map((item: any) => <div key={item.scenario}><b>{scenarioTitle(item.scenario)}</b><StatePill value={item.detected ? 'Case created' : 'No case'}/><span>{item.ground_truth} example · {item.detection_latency_ms} ms local processing</span></div>)}</div></section>
    <section className="panel glossary-panel"><SectionTitle title="Words used in the dashboard" description="Plain-language definitions for the details shown in cases and service cards."/><div className="glossary-grid"><Definition label="Transaction" value="One recorded transfer from a sender label to a receiver label."/><Definition label="Investigation case" value="A group of transfers that matched one or more review rules."/><Definition label="Streaming alert" value="A finding emitted by the optional Flink window detector."/><Definition label="Evidence ID" value="The unique event record used to support a case timeline or explanation."/><Definition label="Intervention request" value="A simulated request state in the local demo; it does not contact a real institution."/><Definition label="Detection latency" value="Time the local code took to evaluate an event; it does not include bank or network response time."/><Definition label="Precision / recall" value="Small-sample ratios calculated only from the four included demo scenarios."/><Definition label="Temporal graph" value="A transfer graph that keeps the event time, so past and recent edges can be compared."/></div></section>
    <section className="panel next-steps"><SectionTitle title="Turn on the optional services" description="Docker Desktop is required. The project includes a launcher and local setup steps."/><ol><li>Open the project folder in PowerShell.</li><li>Run <code>.\scripts\start-advanced.ps1</code>.</li><li>Follow the Optional advanced stack section in the project README to connect the app.</li><li>Refresh this page. Each service card will show when that component responds.</li></ol><p>Model-based investigation needs an API key and can incur provider charges. The local rule engine and fallback reports need no model service.</p></section>
  </>;
}

function ServiceCard({ icon: Icon, name, purpose, state, detail, url, service }: any) {
  const tone = toneFor(state);
  return <article className="service-card"><div className="service-card-top"><span className="service-icon"><Icon size={19}/></span><StatePill value={state} tone={tone}/></div><h3>{name}</h3><p>{purpose}</p><small>{detail}</small>{service?.alerts !== undefined && <small>{service.alerts} alert(s) returned to the app.</small>}{service?.records !== undefined && <small>{service.records} stored edge(s).</small>}{url && <a href={url} target="_blank" rel="noreferrer">Open local service <ExternalLink size={13}/></a>}</article>;
}

function Stage({ icon: Icon, number, title, state, tone, explanation, note }: any) {
  return <article className={`stage-card ${tone}`}><div className="stage-top"><span className="stage-number">{number}</span><Icon size={19}/><StatePill value={state} tone={tone}/></div><h3>{title}</h3><p>{explanation}</p><small>{note}</small></article>;
}

function Metric({ icon: Icon, label, value, detail, tone }: any) {
  return <article className="metric-card" title={detail}><div className={`metric-icon ${tone}`}><Icon size={19}/></div><div className="metric-copy"><span>{label}<span className="metric-help" title={detail}><CircleHelp size={13}/></span></span><b>{value}</b><small>{detail}</small></div></article>;
}

function SectionTitle({ title, description, action, onAction }: any) {
  return <div className="section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <button className="text-link" onClick={onAction}>{action}<ArrowRight size={15}/></button>}</div>;
}

function HelpBox({ title, text }: { title: string; text: string }) {
  return <div className="help-box"><Info size={18}/><div><b>{title}</b><p>{text}</p></div></div>;
}

function StatePill({ value, tone }: { value: string; tone?: string }) {
  return <span className={`state-pill ${tone || toneFor(value)}`}><i/>{value}</span>;
}

function Severity({ value }: { value: string }) {
  const help = severityText(value);
  return <span className={`severity-pill ${String(value).toLowerCase()}`} title={help}>{value} <small>· {help}</small></span>;
}

function Definition({ label, value, help }: { label: string; value: string; help?: string }) {
  return <div className="definition"><span>{label}</span><b>{value}</b>{help && <small>{help}</small>}</div>;
}

function TransactionTable({ rows, onSelect, compact = false }: any) {
  return <div className="table-scroll"><table className={compact ? 'compact-table' : ''}><thead><tr><th>EVENT ID</th><th>SENDER → RECEIVER</th><th>AMOUNT</th><th>PAYMENT TYPE</th><th>STATUS</th><th>EVENT TIME</th></tr></thead><tbody>{rows.map((item: any) => <tr key={item.id || item.transaction_id} onClick={() => onSelect?.(item)}><td><code>{item.id || item.transaction_id}</code></td><td><span className="account-flow">{item.sender}<ArrowRight size={13}/>{item.receiver}</span></td><td>{money(item.amount)}</td><td>{item.rail || '—'}</td><td><StatusText value={item.status}/></td><td>{shortTime(item.ts || item.event_time)}</td></tr>)}</tbody></table>{rows.length === 0 && <Empty title="No transfers to show" text="New synthetic events will appear here as they are created."/>}</div>;
}

function FlowMap({ nodes, edges, cases, onSelectEdge, onSelectNode }: any) {
  const recent = edges.slice(-24);
  const connectedIds = new Set<string>(recent.flatMap((edge: any) => [edge.source, edge.target]));
  const visibleNodes = nodes.filter((node: any) => connectedIds.has(node.id)).slice(0, 20);
  const nodeIds = new Set<string>(visibleNodes.map((node: any) => node.id));
  const visibleEdges = recent.filter((edge: any) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  if (!visibleNodes.length) return <Empty title="No account links to draw" text="The graph is based on stored transactions linked to this case."/>;
  const remaining = new Map<string, number>(visibleNodes.map((node: any) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  visibleEdges.forEach((edge: any) => {
    remaining.set(edge.target, (remaining.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  });
  const levels = new Map<string, number>();
  const queue = visibleNodes.filter((node: any) => remaining.get(node.id) === 0).map((node: any) => node.id);
  queue.forEach(id => levels.set(id, 0));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    for (const target of outgoing.get(source) || []) {
      levels.set(target, Math.max(levels.get(target) || 0, (levels.get(source) || 0) + 1));
      remaining.set(target, (remaining.get(target) || 1) - 1);
      if (remaining.get(target) === 0) queue.push(target);
    }
  }
  visibleNodes.forEach((node: any, index: number) => { if (!levels.has(node.id)) levels.set(node.id, 0); });
  const groups = new Map<number, any[]>();
  visibleNodes.forEach((node: any) => { const level = levels.get(node.id) || 0; groups.set(level, [...(groups.get(level) || []), node]); });
  const maxLevel = Math.max(0, ...groups.keys());
  const maxGroup = Math.max(1, ...[...groups.values()].map(group => group.length));
  const width = 1030;
  const height = Math.max(230, 120 + maxGroup * 100);
  const positions = new Map<string, {x:number;y:number}>();
  for (const [level, group] of groups) {
    const x = maxLevel ? 90 + level / maxLevel * 850 : width / 2;
    group.forEach((node: any, index: number) => positions.set(node.id, {x, y:height / 2 + (index - (group.length - 1) / 2) * 100}));
  }
  return <div className="flow-map-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Directed flow of recorded synthetic transfers"><defs><marker id="flowArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#69caba"/></marker></defs>{visibleEdges.map((edge: any) => { const from = positions.get(edge.source)!; const to = positions.get(edge.target)!; const highlighted = cases.some((item: CaseRecord) => item.tx_ids.includes(edge.id)); const color = highlighted ? '#efb665' : '#4caaa0'; const label = `${edge.id}: ${edge.sender} sent ${money(edge.amount)} to ${edge.receiver} at ${stamp(edge.ts)}; ${edge.source_bank} to ${edge.dest_bank}. ${statusMeaning(edge.status)}`; return <g key={edge.id} className={`flow-edge ${onSelectEdge ? 'clickable' : ''}`} role={onSelectEdge ? 'button' : undefined} tabIndex={onSelectEdge ? 0 : undefined} aria-label={onSelectEdge ? label : undefined} onClick={() => onSelectEdge?.(edge)} onKeyDown={event => { if (onSelectEdge && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectEdge(edge); } }}><line x1={from.x + (from.x <= to.x ? 32 : -32)} y1={from.y} x2={to.x + (from.x <= to.x ? -38 : 38)} y2={to.y} stroke={color} strokeWidth={highlighted ? 3 : 2} strokeDasharray={edge.status === 'SIMULATED_PREVENTED' ? '7 6' : undefined} markerEnd="url(#flowArrow)"/><text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 10}>{money(edge.amount)}</text><title>{label}</title></g>; })}{visibleNodes.map((node: any) => { const point = positions.get(node.id)!; const name = accountHolderName(node.id); return <g className={`flow-node ${onSelectNode ? 'clickable' : ''}`} key={node.id} role={onSelectNode ? 'button' : undefined} tabIndex={onSelectNode ? 0 : undefined} aria-label={onSelectNode ? `Open synthetic account for ${name}` : undefined} onClick={() => onSelectNode?.(node.id)} onKeyDown={event => { if (onSelectNode && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectNode(node.id); } }}><circle cx={point.x} cy={point.y} r="30"/><text x={point.x} y={point.y + 48}>{name}</text><title>{`${name}: synthetic account ${node.id}, ${node.degree} observed connection(s)`}</title></g>; })}</svg><div className="flow-legend"><span><i className="legend-teal"/> Observed transfer</span><span><i className="legend-amber"/> Linked to this case</span><span><i className="legend-dashed"/> Prevented fixture event</span><small>{onSelectEdge ? 'Select a link for its transaction; select a name to open its account.' : 'Showing the latest 24 recorded transfers.'}</small></div></div>;
}

function TransactionDetails({ transaction, onClose }: any) {
  return <section className="panel transaction-card"><div className="section-header"><div><h2>One transaction, explained</h2><p>This is the stored event record used by the local detector and graph.</p></div><button className="button subtle" onClick={onClose}>Close</button></div><div className="glossary-grid"><Definition label="Event ID" value={transaction.id} help="Unique reference for this synthetic transfer."/><Definition label="Sender → receiver" value={`${transaction.sender} → ${transaction.receiver}`} help="Account labels only; ownership is not known."/><Definition label="Amount" value={`${money(transaction.amount)} ${transaction.currency}`} help="Synthetic amount in the event record."/><Definition label="Institutions" value={`${transaction.source_bank} → ${transaction.dest_bank}`} help="Fictional institutions assigned by the simulator."/><Definition label="Payment type" value={transaction.rail} help="Example payment channel, not connected to a real rail."/><Definition label="Record status" value={transaction.status} help={statusMeaning(transaction.status)}/><Definition label="Event time" value={stamp(transaction.ts)} help="Timestamp assigned to this synthetic transfer."/><Definition label="Local detection time" value={`${Number(transaction.detection_ms || 0).toFixed(2)} ms`} help="Time spent checking this event locally; excludes any external service."/></div></section>;
}

function StatusText({ value }: { value: string }) {
  return <span className="record-status" title={statusMeaning(value)}>{value?.replaceAll('_',' ').toLowerCase() || 'unknown'}</span>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><span><CircleHelp size={21}/></span><b>{title}</b><p>{text}</p></div>;
}

function toneFor(state?: string) {
  const value = String(state || '').toLowerCase();
  if (value.includes('offline') || value.includes('fallback') || value.includes('unsupported')) return 'amber';
  if (['active','running','connected','ready','local storage active','local rules active','simulator running'].some(term => value.includes(term))) return 'green';
  if (value.includes('not configured') || value.includes('not running') || value.includes('paused') || value.includes('ready')) return 'neutral';
  return 'neutral';
}

function severityText(value: string) {
  const severity = String(value).toUpperCase();
  if (severity === 'HIGH' || severity === 'CRITICAL') return 'priority review';
  if (severity === 'MEDIUM') return 'review';
  return 'lower priority';
}

function statusMeaning(value: string) {
  if (value === 'SETTLED') return 'Shown as a completed transfer inside this synthetic demo.';
  if (value === 'SIMULATED_PREVENTED') return 'A later fixture event was blocked inside the demo; no real funds were affected.';
  return 'Status recorded by the synthetic simulator.';
}

function chartData(transactions: any[]) {
  const now = Date.now();
  const bins = Array.from({ length: 12 }, (_, index) => ({ time: `${(11 - index) * 5}m ago`, events: 0 }));
  transactions.forEach(item => {
    const age = Math.max(0, now - new Date(item.ts).getTime());
    const index = Math.max(0, Math.min(11, 11 - Math.floor(age / 300000)));
    bins[index].events += 1;
  });
  return bins;
}

function averageLatency(transactions: any[]) {
  if (!transactions.length) return '—';
  return Math.round(transactions.reduce((sum, item) => sum + Number(item.detection_ms || 0), 0) / transactions.length);
}

function percent(value: any) {
  return value === null || value === undefined ? '—' : `${(Number(value) * 100).toFixed(0)}%`;
}

