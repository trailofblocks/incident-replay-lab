import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, BarChart3, CircleAlert, FileText, GitBranch, Pause, Play, Radio, ScanSearch, SkipForward,
  Terminal, TriangleAlert,
} from "lucide-react";
import type { AnalysisMode, Diagnosis, Replay, Scenario, ScenarioId, SignalKind, Telemetry } from "../shared/contracts.js";
import { errorMessage, post, request } from "./api.js";
import "./style.css";

const kinds = [
  { id: "all", label: "All signals" },
  { id: "log", label: "Logs" },
  { id: "metric", label: "Metrics" },
  { id: "span", label: "Traces" },
] as const;
const signalIcon = { log: FileText, metric: BarChart3, span: GitBranch };
const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(2) + "s";
type Filter = "all" | SignalKind;

function Details({ event }: { event: Telemetry }) {
  const Icon = signalIcon[event.kind];
  return <section className="card event-details" aria-label="Selected signal">
    <div className="card-heading"><h2><Icon size={18} /> {event.id}</h2><span>{seconds(event.offset)}</span></div>
    <p>{event.message}</p>
    <dl>
      <div><dt>Service</dt><dd>{event.service}</dd></div>
      <div><dt>Signal type</dt><dd>{event.kind}</dd></div>
      {event.value !== undefined && <div><dt>Value</dt><dd>{event.value} {event.unit}</dd></div>}
      {event.traceId && <div><dt>Trace</dt><dd><code>{event.traceId}</code></dd></div>}
    </dl>
  </section>;
}

function App() {
  const [catalog, setCatalog] = useState<Scenario[]>([]);
  const [scenario, setScenario] = useState<ScenarioId>("queue");
  const [modelEnabled, setModelEnabled] = useState(false);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [play, setPlay] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Telemetry | null>(null);
  const [mode, setMode] = useState<AnalysisMode>("rules");
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [starting, setStarting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const analysis = useRef<AbortController | null>(null);
  const running = !!replay && play && cursor < replay.duration;
  const visible = replay?.events.filter((event) => event.offset <= cursor) ?? [];
  const alerts = visible.filter((event) => event.severity === "error").length;
  const services = new Set(visible.map((event) => event.service)).size;
  const filtered = visible.filter((event) => filter === "all" || event.kind === filter);
  const finished = !!replay && cursor >= replay.duration;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await request<{ scenarios: Scenario[]; modelEnabled: boolean }>("/api/scenarios", { signal: controller.signal });
        setCatalog(data.scenarios);
        setModelEnabled(data.modelEnabled);
        const id = new URLSearchParams(location.search).get("run");
        if (id) {
          const restored = await request<Replay>(`/api/runs/${encodeURIComponent(id)}`, { signal: controller.signal });
          setScenario(restored.scenario);
          setReplay(restored);
          setCursor(restored.duration);
        }
      } catch (caught) { if (!controller.signal.aborted) setError(errorMessage(caught)); }
    }
    void load();
    return () => { controller.abort(); analysis.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!running || !replay) return;
    const duration = replay.duration;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      const passed = Math.round(now - last);
      last = now;
      setCursor((position) => Math.min(duration, position + passed));
    }, 65);
    return () => clearInterval(ticker);
  }, [running, replay]);

  async function start() {
    setStarting(true);
    setError("");
    try {
      const run = await post<Replay>("/api/runs", { scenario });
      analysis.current?.abort();
      setAnalyzing(false);
      const url = new URL(location.href);
      url.searchParams.set("run", run.id);
      history.replaceState(null, "", url);
      setReplay(run);
      setDiagnosis(null);
      setSelected(null);
      setFilter("all");
      setCursor(0);
      setPlay(true);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setStarting(false); }
  }

  async function analyze() {
    if (!replay) return;
    analysis.current?.abort();
    const controller = new AbortController();
    analysis.current = controller;
    setError("");
    setAnalyzing(true);
    setDiagnosis(null);
    try {
      const result = await request<Diagnosis>(`/api/runs/${replay.id}/investigate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }), signal: controller.signal,
      });
      if (!controller.signal.aborted) setDiagnosis(result);
    } catch (caught) { if (!controller.signal.aborted) setError(errorMessage(caught)); }
    finally { if (!controller.signal.aborted) setAnalyzing(false); }
  }

  function selectEvidence(event: Telemetry) {
    setFilter("all");
    setSelected(event);
    setCursor((value) => Math.max(value, event.offset));
  }

  function togglePlayback() {
    if (finished) { setCursor(0); setSelected(null); setPlay(true); }
    else setPlay((active) => !active);
  }

  return <>
    <header className="masthead"><div className="masthead-inner"><Terminal size={22} /><strong>Incident Replay Lab</strong>
      <div className="sim-label"><Radio size={15} /> Simulated services</div></div></header>
    <main>
      <div className="headline"><h1>Incident workspace</h1><p>Replay a service failure, read the telemetry, and test a diagnosis.</p></div>
      <section className="card controls" aria-label="Scenario controls">
        <div className="scenario-choice"><label htmlFor="scenario">Scenario</label>
          <select id="scenario" value={scenario} disabled={!catalog.length || starting}
            onChange={(event) => setScenario(event.target.value as ScenarioId)}>
            {catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <p>{catalog.find((item) => item.id === scenario)?.description ?? "Loading scenario catalog…"}</p>
        <button className="action" disabled={starting || !catalog.length} onClick={() => void start()}><Play size={17} /> {starting ? "Starting…" : "Run scenario"}</button>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="metrics">
        <div className="card metric"><Activity size={18} /><div><span>Signals observed</span><strong>{visible.length}</strong></div></div>
        <div className="card metric"><TriangleAlert size={18} /><div><span>Error signals</span><strong>{alerts}</strong></div></div>
        <div className="card metric"><GitBranch size={18} /><div><span>Services observed</span><strong>{services}</strong></div></div>
      </div>

      <div className="workspace">
        <section className="card timeline" aria-label="Telemetry timeline">
          <div className="card-heading"><h2><Activity size={18} /> Telemetry timeline</h2>
            {replay && <span>{catalog.find((item) => item.id === replay.scenario)?.name}</span>}</div>
          {replay ? <>
            <div className="playback">
              <button className="icon-action" onClick={togglePlayback} aria-label={running ? "Pause" : finished ? "Replay" : "Play"}>
                {running ? <Pause size={16} /> : <Play size={16} />}</button>
              <button className="icon-action" aria-label="Skip to end" onClick={() => { setPlay(false); setCursor(replay.duration); }}><SkipForward size={16} /></button>
              <input type="range" aria-label="Replay position" min="0" max={replay.duration} value={cursor}
                onChange={(event) => { setPlay(false); setCursor(Number(event.target.value)); setSelected(null); }} />
              <span className="mono">{seconds(cursor)} / {seconds(replay.duration)}</span>
            </div>
            <div className="filters" aria-label="Signal filters">{kinds.map((item) =>
              <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
            <ol className="events">{filtered.map((event) => {
              const Icon = signalIcon[event.kind];
              return <li key={event.id}><button className={selected?.id === event.id ? "focused" : ""} onClick={() => setSelected(event)}>
                <span className="mono offset">+{seconds(event.offset)}</span><span className={`signal ${event.severity}`}><Icon size={17} /></span>
                <span><span className="event-name">{event.message}</span><span className="event-meta">{event.service} · {event.kind}{event.value !== undefined ? ` · ${event.value} ${event.unit ?? ""}` : ""}</span></span>
              </button></li>;
            })}</ol>
            {!filtered.length && <p className="empty-note">{visible.length ? "No signals match this filter." : "The replay is waiting for its first signal."}</p>}
          </> : <p className="empty-note">Run a scenario to view logs, metrics, and trace spans in time order.</p>}
        </section>

        <aside className="investigation">
          <section className="card investigator">
            <div className="card-heading"><h2><ScanSearch size={19} /> Investigation</h2></div>
            <p>Analyze the recorded signals and inspect the evidence behind the result.</p>
            {modelEnabled && <label className="mode">Analysis mode
              <select value={mode} disabled={analyzing} onChange={(event) => { setMode(event.target.value as AnalysisMode); setDiagnosis(null); }}>
                <option value="rules">Evidence rules</option><option value="ollama">Local model</option>
              </select></label>}
            <button className="action analyze" disabled={!finished || analyzing || starting} onClick={() => void analyze()}>
              <ScanSearch size={16} /> {analyzing ? "Analyzing…" : "Investigate incident"}</button>
            {replay && !finished && <p className="small">Finish the replay to investigate the full timeline.</p>}
            {diagnosis && <div className="diagnosis" aria-live="polite">
              <span className={`finding ${diagnosis.status}`}>{diagnosis.status === "suspected" ? "Likely cause" : "Insufficient evidence"}</span>
              <h3>{diagnosis.title}</h3><p>{diagnosis.summary}</p>
              {diagnosis.notice && <p className="notice"><CircleAlert size={16} /> {diagnosis.notice}</p>}
              {diagnosis.evidence.length > 0 && <ul aria-label="Cited evidence">
                {diagnosis.evidence.map((event) => <li key={event.id}><button onClick={() => selectEvidence(event)}>
                  <code>{event.id}</code><span>{event.service} · {event.kind}</span></button></li>)}
              </ul>}
            </div>}
          </section>
          {selected && <Details event={selected} />}
        </aside>
      </div>
    </main>
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);
