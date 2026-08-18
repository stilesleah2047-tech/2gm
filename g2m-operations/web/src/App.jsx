import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* =============================================================================
   G2M — Field Operations
   Everything the system needs is created here by the operations manager and
   stored in MongoDB. There is no external service to populate first.

   Point the browser at the Node service (server/) which serves both the API
   and this bundle. Override the base only if you run them on separate hosts:
     <script>window.__G2M_CONFIG__ = { apiBase: "https://ops.g2m.co.ke/api" }</script>
   ============================================================================= */

const injected = (typeof window !== "undefined" && window.__G2M_CONFIG__) || {};
const CONFIG = {
  apiBase: "/api",
  timezone: "Africa/Nairobi",
  currency: "KES",
  pollMs: 45000,
  photo: { maxEdge: 1600, quality: 0.72 },
  ...injected,
};

/* ============================================================
   Time, money
   ============================================================ */

const toMin = (t) => {
  if (typeof t !== "string") return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
function nairobi(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: CONFIG.timezone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const shiftDate = (iso, days) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const prettyDate = (iso) => iso
  ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      .format(new Date(iso + "T12:00:00Z"))
  : "";
const relativeDay = (iso, today) =>
  iso === today ? "Today" : iso === shiftDate(today, 1) ? "Tomorrow"
  : iso === shiftDate(today, -1) ? "Yesterday" : prettyDate(iso);
const money = (n) => n == null ? "—"
  : CONFIG.currency + " " + Number(n).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const compact = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return CONFIG.currency + " " + (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return CONFIG.currency + " " + Math.round(n / 1e3) + "K";
  return CONFIG.currency + " " + n;
};
const pctText = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v * 100) + "%");
const uid = () => Math.random().toString(36).slice(2, 10);

/* ============================================================
   API
   ============================================================ */

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
function apiUrl(path, params) {
  const qs = params
    ? "?" + Object.entries(params).filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&")
    : "";
  return String(CONFIG.apiBase).replace(/\/$/, "") + path + qs;
}
async function handle(res) {
  if (!res.ok) {
    let msg = `the service returned ${res.status}`;
    try { const b = await res.json(); if (b?.message) msg = b.message; } catch {}
    throw new ApiError(msg, res.status);
  }
  try { return await res.json(); } catch { return {}; }
}
const apiGet = (path, params, signal) =>
  fetch(apiUrl(path, params), { signal, headers: { Accept: "application/json" } }).then(handle);
const apiSend = (path, body, method = "POST") =>
  fetch(apiUrl(path), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(handle);
const apiDelete = (path) => fetch(apiUrl(path), { method: "DELETE" }).then(handle);
const apiUpload = (path, formData) => fetch(apiUrl(path), { method: "POST", body: formData }).then(handle);

function useResource(path, params) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const key = JSON.stringify(params || {});
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, status: s.data ? "refreshing" : "loading" }));
    try { setState({ status: "ready", data: await apiGet(path, params), error: null }); }
    catch (err) {
      setState((s) => ({ status: s.data ? "stale" : "error", data: s.data,
        error: err.message || "Could not reach the operations service" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (d) => setState((s) => ({ ...s, data: d })) };
}

function useFieldDay(team, date) {
  const [state, setState] = useState({ status: "loading", data: null, error: null, at: null });
  const abort = useRef(null);
  const isToday = date === nairobi().date;

  const load = useCallback(async (quiet) => {
    abort.current?.abort();
    const ctl = new AbortController(); abort.current = ctl;
    const timer = setTimeout(() => ctl.abort(), 15000);
    if (!quiet) setState((s) => ({ ...s, status: s.data ? "refreshing" : "loading" }));
    try {
      const data = await apiGet("/field/day", { date, team }, ctl.signal);
      setState({ status: "ready", data, error: null, at: new Date() });
    } catch (err) {
      if (err.name === "AbortError") return;
      setState((s) => ({ status: s.data ? "stale" : "error", data: s.data,
        error: err.message || "Could not reach the operations service", at: s.at }));
    } finally { clearTimeout(timer); }
  }, [team, date]);

  useEffect(() => { load(); return () => abort.current?.abort(); }, [load]);
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => { if (!document.hidden) load(true); }, CONFIG.pollMs);
    const onVis = () => { if (!document.hidden) load(true); };
    window.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { clearInterval(id);
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis); };
  }, [isToday, load]);

  return { ...state, isToday, reload: () => load(false) };
}

/* ============================================================
   Analysis
   ============================================================ */

/* Thresholds and currency are set by the manager in Setup and saved to the
   database. They are held here so every screen reads the same values, and are
   replaced by useSettings() as soon as the service answers. The defaults below
   are only what the first paint uses. */
const T = {
  minStrikeRate: 0.6, maxIdleMin: 75, maxGapMin: 75, maxGpsDeltaKm: 0.4,
  minCallMin: 15, minShareOfShelf: 0.3, minCoverage: 0.8, minMarginPct: 25, poorAccuracyM: 120,
};

/** Pulls the saved settings in once and pushes them into T and CONFIG.currency. */
function useSettings() {
  const [, bump] = useState(0);
  useEffect(() => {
    let dead = false;
    apiGet("/settings")
      .then((s) => {
        if (dead || !s) return;
        if (s.thresholds) Object.assign(T, s.thresholds);
        if (s.currency) CONFIG.currency = s.currency;
        bump((n) => n + 1);
      })
      .catch(() => { /* the screens still work on the defaults above */ });
    return () => { dead = true; };
  }, []);
}

function shiftWindow(data) {
  const s = toMin(data?.shift?.start) ?? 420;
  const e = toMin(data?.shift?.end) ?? 1080;
  return { start: s, end: Math.max(e, s + 60) };
}

function analyse(person, team, nowMin, win) {
  const planned = (person?.plannedCalls || [])
    .map((p) => ({ min: toMin(p.time), time: p.time, store: p.store }))
    .filter((p) => p.min != null).sort((a, b) => a.min - b.min);

  const visits = (person?.visits || []).map((v) => {
    const min = toMin(v.time);
    if (min == null) return null;
    const open = v.durationMin == null;
    const dwell = open ? Math.max(nowMin - min, 1) : Number(v.durationMin) || 0;
    return { ...v, min, open, dwell, endMin: min + dwell,
      gps: v.gpsDeltaKm == null ? null : Number(v.gpsDeltaKm),
      ours: Number(v.ourFacings) || 0, comp: Number(v.competitorFacings) || 0,
      oos: (v.outOfStockSkus || []).length,
      value: v.valueKes == null ? 0 : Number(v.valueKes),
      photos: v.photos || [] };
  }).filter(Boolean).sort((a, b) => a.min - b.min);

  const missed = planned.filter(
    (p) => p.min < nowMin - 45 && !visits.some((v) => Math.abs(v.min - p.min) <= 45));

  const gaps = [];
  for (let i = 1; i < visits.length; i++) {
    const from = visits[i - 1].endMin;
    if (visits[i].min - from > T.maxGapMin) gaps.push({ from, to: visits[i].min });
  }
  const last = visits[visits.length - 1] || null;
  const idle = last && !last.open ? nowMin - last.endMin : 0;
  if (last && idle > T.maxIdleMin && nowMin < win.end) gaps.push({ from: last.endMin, to: nowMin, open: true });

  const plannedCount = planned.length || visits.length;
  const dwellTotal = visits.reduce((s, v) => s + v.dwell, 0);
  const base = { planned, visits, missed, gaps, last, idle, plannedCount,
    coverage: plannedCount ? visits.length / plannedCount : null,
    avgDwell: visits.length ? Math.round(dwellTotal / visits.length) : null };

  if (team === "sales") {
    const orders = visits.filter((v) => v.outcome === "order").length;
    return { ...base, orders, value: visits.reduce((s, v) => s + v.value, 0),
      strike: visits.length ? orders / visits.length : null };
  }
  const ours = visits.reduce((s, v) => s + v.ours, 0);
  const comp = visits.reduce((s, v) => s + v.comp, 0);
  return { ...base, ours, comp,
    oos: visits.reduce((s, v) => s + v.oos, 0),
    photos: visits.reduce((s, v) => s + v.photos.length, 0),
    shortCalls: visits.filter((v) => !v.open && v.dwell < T.minCallMin).length,
    sos: ours + comp ? ours / (ours + comp) : null };
}

function buildExceptions(rows, team) {
  const out = [];
  rows.forEach(({ person, a }) => {
    if (a.idle > T.maxIdleMin)
      out.push({ sev: "high", who: person.name, text: `No check-in for ${a.idle} min — last seen at ${a.last.store}` });
    a.visits.forEach((v) => {
      if (v.gps != null && v.gps > T.maxGpsDeltaKm)
        out.push({ sev: "high", who: person.name, text: `Check-in ${v.gps.toFixed(2)} km from ${v.store} at ${v.time}` });
      if (team === "sales" && v.sageStatus === "failed")
        out.push({ sev: "high", who: person.name, text: `${v.orderRef || "Order"} failed to reach Sage` });
      if (team === "merchandising" && !v.open && !v.photos.length)
        out.push({ sev: "med", who: person.name, text: `No photos submitted for ${v.store}` });
    });
    if (a.missed.length >= 3)
      out.push({ sev: "med", who: person.name, text: `${a.missed.length} assigned calls skipped so far` });
    if (team === "sales" && a.strike != null && a.strike < T.minStrikeRate && a.visits.length >= 5)
      out.push({ sev: "med", who: person.name, text: `Strike rate ${pctText(a.strike)} — below the ${pctText(T.minStrikeRate)} floor` });
    if (team === "merchandising" && a.shortCalls >= 2)
      out.push({ sev: "med", who: person.name, text: `${a.shortCalls} calls under ${T.minCallMin} min` });
  });
  return out.sort((x, y) => (x.sev === "high" ? -1 : 1) - (y.sev === "high" ? -1 : 1));
}

/* ============================================================
   Shared UI
   ============================================================ */

const SectionHead = ({ title, note }) => (
  <div className="sechead"><h2>{title}</h2>{note && <span className="sechead-note">{note}</span>}</div>
);
const StatRail = ({ items }) => (
  <div className="rail">{items.map((it) => (
    <div className="rail-cell" key={it.label}>
      <div className="rail-label">{it.label}</div>
      <div className={"rail-value " + (it.tone || "")}>{it.value}</div>
      {it.sub && <div className="rail-sub">{it.sub}</div>}
    </div>))}
  </div>
);
const Field = ({ label, hint, children }) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {hint && <span className="field-hint">{hint}</span>}
    {children}
  </label>
);
const Chips = ({ options, value, onToggle, small }) => (
  <div className="chips">{(options || []).map((o) => {
    const id = typeof o === "string" ? o : o.id;
    const label = typeof o === "string" ? o : o.label;
    return (
      <button key={id} type="button"
        className={"chip " + (small ? "chip--sm " : "") + (value.includes(id) ? "chip--on" : "")}
        onClick={() => onToggle(id)} aria-pressed={value.includes(id)}>{label}</button>
    );
  })}</div>
);
const Loading = ({ label, rows = 4 }) => (
  <div className="pane">
    <div className="sechead"><h2>{label}</h2><span className="sechead-note">Loading…</span></div>
    {Array.from({ length: rows }).map((_, i) => (
      <div className="skel-row" key={i}><div className="skel skel--name" /><div className="skel skel--track" /></div>))}
  </div>
);
const ErrorState = ({ message, onRetry }) => (
  <div className="pane state">
    <div className="eyebrow">Connection</div>
    <h2 className="state-title">{message}</h2>
    <p className="state-copy">
      The dashboard talks to the operations service on this machine. Check it is running and
      that MongoDB is up, then try again.
    </p>
    <button className="primary" onClick={onRetry}>Try again</button>
  </div>
);
const EmptyState = ({ title, copy, action }) => (
  <div className="pane state">
    <div className="eyebrow">Nothing yet</div>
    <h2 className="state-title">{title}</h2>
    <p className="state-copy">{copy}</p>
    {action}
  </div>
);
function Meter({ v }) {
  if (v == null) return <span className="dim mono">—</span>;
  const p = Math.round(v * 100);
  const tone = p < 60 ? "bad" : p < T.minCoverage * 100 ? "warn" : "good";
  return (
    <span className="meter">
      <span className="meter-bar"><span className={"meter-fill " + tone} style={{ width: Math.min(p, 100) + "%" }} /></span>
      <span className="mono meter-num">{p}%</span>
    </span>
  );
}
function ShelfGraphic({ ours, comp }) {
  const arranged = []; let o = ours, c = comp, g = 0;
  while (o + c > 0 && g++ < 200) {
    const to = Math.min(o, 3), tc = Math.min(c, 4);
    for (let i = 0; i < to; i++) arranged.push("ours");
    for (let i = 0; i < tc; i++) arranged.push("comp");
    o -= to; c -= tc;
  }
  if (!arranged.length) return <div className="shelf shelf--empty mono">No facings recorded</div>;
  return <div className="shelf">{arranged.map((t, i) => <span key={i} className={"facing facing--" + t} />)}</div>;
}

/** Editable list of short strings, used for every picklist in settings. */
function TagList({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="taglist">
      <div className="chips">
        {value.map((v) => (
          <span key={v} className="chip chip--tag">{v}
            <button className="chip-x" onClick={() => onChange(value.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}>×</button>
          </span>
        ))}
        {!value.length && <span className="inline-empty">Nothing here yet.</span>}
      </div>
      <div className="row-actions">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button className="ghostbtn sm" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>
    </div>
  );
}

/* ============================================================
   Day strip
   ============================================================ */

function DayStrip({ rows, team, win, nowMin, showNow, onPick, selected }) {
  const pct = (m) => ((m - win.start) / (win.end - win.start)) * 100;
  const hours = [];
  for (let h = Math.ceil(win.start / 60); h <= Math.floor(win.end / 60); h++) hours.push(h);

  return (
    <div className="strip">
      <div className="strip-head">
        <div className="strip-gutter strip-gutter--head">
          <span className="eyebrow">{team === "sales" ? "Rep" : "Merchandiser"}</span>
        </div>
        <div className="strip-track strip-track--head">
          {hours.map((h) => (
            <div className="scale-tick" key={h} style={{ left: pct(h * 60) + "%" }}>
              <span className="mono">{String(h).padStart(2, "0")}</span></div>))}
        </div>
      </div>

      {rows.map(({ person, a }) => (
        <div className="strip-row" key={person.id}>
          <div className="strip-gutter">
            <div className="who">
              <span className="who-name">{person.name}</span>
              <span className="who-route">{person.route || "No route named"}</span>
            </div>
            <div className="who-cov">
              <span className="mono">{a.visits.length}</span><span className="slash">/</span>
              <span className="mono dim">{a.plannedCount || "—"}</span>
            </div>
          </div>
          <div className="strip-track">
            <div className="track-base" />
            {hours.slice(1, -1).map((h) => <div className="gridline" key={h} style={{ left: pct(h * 60) + "%" }} />)}
            {a.gaps.map((g, i) => (
              <div key={"g" + i} className={"gap " + (g.open ? "gap--open" : "")}
                style={{ left: pct(g.from) + "%", width: Math.max(pct(g.to) - pct(g.from), 0) + "%" }}
                title={`No activity for ${Math.round(g.to - g.from)} min`} />))}
            {a.planned.map((p, i) => (
              <div key={"p" + i} className="ghost" style={{ left: pct(p.min) + "%" }}
                title={`Assigned: ${p.store} at ${p.time}`} />))}
            {a.missed.map((p, i) => (
              <div key={"m" + i} className="missed" style={{ left: pct(p.min) + "%" }}
                title={`Not visited: ${p.store}`} />))}
            {a.visits.map((v, i) => {
              const key = person.id + "-" + (v.id || i);
              const sel = selected?.key === key;
              if (team === "sales") {
                const cls = v.outcome === "order" ? "order" : v.outcome === "collection" ? "credit" : "nosale";
                return <button key={key} style={{ left: pct(v.min) + "%" }}
                  className={`pin pin--${cls} ${sel ? "pin--sel" : ""} ${v.gps > T.maxGpsDeltaKm ? "pin--gps" : ""}`}
                  onClick={() => onPick({ key, person, team, visit: v })}
                  title={`${v.time} · ${v.store}`} aria-label={`${v.time} ${v.store}`} />;
              }
              const verdict = v.verdict || (v.dwell < T.minCallMin ? "short" : "complete");
              return <button key={key}
                className={`bar bar--${verdict} ${v.open ? "bar--open" : ""} ${sel ? "bar--sel" : ""}`}
                style={{ left: pct(v.min) + "%", width: Math.max((v.dwell / (win.end - win.start)) * 100, 0.9) + "%" }}
                onClick={() => onPick({ key, person, team, visit: v })}
                title={`${v.time} · ${v.store} · ${v.dwell} min`} aria-label={`${v.time} ${v.store}`} />;
            })}
            {showNow && nowMin >= win.start && nowMin <= win.end && (
              <div className="nowline" style={{ left: pct(nowMin) + "%" }} />)}
          </div>
        </div>
      ))}

      <div className="legend">
        {team === "sales" ? (<>
          <span><i className="k k--order" />Order placed</span>
          <span><i className="k k--nosale" />Visited, no order</span>
          <span><i className="k k--credit" />Collection</span>
          <span><i className="k k--ghost" />Assigned call</span>
          <span><i className="k k--missed" />Not visited</span>
        </>) : (<>
          <span><i className="k k--wide k--ok" />Full service call</span>
          <span><i className="k k--wide k--fix" />Issues raised</span>
          <span><i className="k k--wide k--short" />Under {T.minCallMin} min</span>
          <span><i className="k k--ghost" />Assigned call</span>
          <span className="legend-note">Bar width is time in store</span>
        </>)}
      </div>
    </div>
  );
}

function DetailPanel({ pick, date, onClose, onOpenPhoto }) {
  if (!pick) return (
    <aside className="detail detail--empty">
      <div className="eyebrow">Visit detail</div>
      <p className="empty-copy">Select a check-in on the strip to see the store, timing, location
        accuracy and the work submitted on site.</p>
    </aside>
  );
  const { person, visit: v, team } = pick;
  const share = v.ours + v.comp ? v.ours / (v.ours + v.comp) : null;
  return (
    <aside className="detail">
      <div className="detail-top"><div className="eyebrow">Visit detail</div>
        <button className="x" onClick={onClose} aria-label="Close visit detail">×</button></div>
      <h3 className="detail-store">{v.store}</h3>
      <div className="detail-meta mono">{v.time} · {person.name} · {prettyDate(date)}</div>

      <dl className="dl">
        <div><dt>Time in store</dt><dd className="mono">{v.dwell} min
          {v.open && <span className="live-tag">still there</span>}</dd></div>
        {team === "sales" ? (<>
          <div><dt>Outcome</dt><dd>{v.outcome === "order" ? "Order captured"
            : v.outcome === "collection" ? "Payment collected" : "No order"}</dd></div>
          <div><dt>Value</dt><dd className="mono">{v.value ? money(v.value) : "—"}</dd></div>
          <div><dt>Sage</dt><dd className={v.sageStatus === "failed" ? "bad" : ""}>
            {v.sageStatus === "pushed" ? "Pushed" : v.sageStatus === "queued" ? "Queued for push"
              : v.sageStatus === "failed" ? "Push failed" : "Not applicable"}</dd></div>
        </>) : (<>
          <div><dt>Our facings</dt><dd className="mono">{v.ours}</dd></div>
          <div><dt>Competitor facings</dt><dd className="mono">{v.comp}</dd></div>
          <div><dt>Share of shelf</dt><dd className={"mono " + (share != null && share < T.minShareOfShelf ? "bad" : "")}>
            {pctText(share)}</dd></div>
          <div><dt>Out of stock</dt><dd className={"mono " + (v.oos ? "bad" : "")}>{v.oos}</dd></div>
        </>)}
        <div><dt>Location accuracy</dt><dd className={"mono " + (v.gps > T.maxGpsDeltaKm ? "bad" : "")}>
          {v.gps == null ? "not captured" : `${v.gps.toFixed(2)} km`}</dd></div>
      </dl>

      {team === "merchandising" && (<>
        <div className="eyebrow eyebrow--mt">Shelf capture</div>
        <ShelfGraphic ours={v.ours} comp={v.comp} />
        <div className="eyebrow eyebrow--mt">Photos from site</div>
        {v.photos.length ? (
          <div className="thumbs">{v.photos.map((p) => (
            <button key={p.id} className="thumb" onClick={() => onOpenPhoto({ ...p, store: v.store, who: person.name })}>
              <img src={p.thumbUrl || p.url} alt={p.label || "Shelf photo"} loading="lazy" />
              <span className="thumb-label">{p.label}</span>
            </button>))}
          </div>
        ) : <p className="inline-empty">No photos submitted for this call.</p>}
      </>)}
      {v.notes && (<><div className="eyebrow eyebrow--mt">Note from the field</div>
        <p className="fieldnote">{v.notes}</p></>)}
    </aside>
  );
}

function Lightbox({ photo, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!photo) return null;
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <img src={photo.url} alt={photo.label || "Photo"} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar mono">{photo.label} · {photo.store} · {photo.who}
        <button className="linkbtn" onClick={onClose}>Close</button></div>
    </div>
  );
}

/* ============================================================
   Monitoring
   ============================================================ */

function FieldView({ team, date, setDate, pick, setPick, nowMin, onOpenPhoto }) {
  const { status, data, error, at, isToday, reload } = useFieldDay(team, date);
  const label = team === "sales" ? "Sales team" : "Merchandising";
  const win = shiftWindow(data);
  const rows = useMemo(() => (data?.people || [])
    .map((person) => ({ person, a: analyse(person, team, nowMin, win) })),
    [data, team, nowMin, win.start, win.end]);

  const today = nairobi().date;
  const head = (
    <div className="daybar">
      <h1 className="daybar-title">{label}</h1>
      <div className="daybar-right">
        <label className="datepick"><span className="eyebrow">Day</span>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></label>
        {!isToday && <button className="ghostbtn sm" onClick={() => setDate(today)}>Back to today</button>}
        <span className={"livestate " + (isToday ? "livestate--on" : "")}>
          {isToday ? <><span className="dot" />Live</> : "Historical"}
          {at && <span className="mono dim"> · {nairobi(at).time}</span>}</span>
        <button className="ghostbtn sm" onClick={reload} disabled={status === "refreshing"}>
          {status === "refreshing" ? "Refreshing…" : "Refresh"}</button>
      </div>
    </div>
  );

  if (status === "loading") return <>{head}<Loading label={label} /></>;
  if (status === "error") return <>{head}<ErrorState message={error} onRetry={reload} /></>;
  if (!rows.length) return <>{head}
    <EmptyState
      title={data?.planStatus === "none"
        ? `No plan was published for ${relativeDay(date, today).toLowerCase()}`
        : isToday ? "No one has checked in yet" : `No activity on ${prettyDate(date)}`}
      copy={data?.planStatus === "none"
        ? "Assign stops on Plan the day and publish them. Published stops appear here as the assigned route, and fill in as the team checks in."
        : "Check-ins appear the moment someone opens their first call."} />
  </>;

  const t = rows.reduce((s, { a }) => ({
    visits: s.visits + a.visits.length, planned: s.planned + a.plannedCount,
    missed: s.missed + a.missed.length, orders: s.orders + (a.orders || 0),
    value: s.value + (a.value || 0), ours: s.ours + (a.ours || 0), comp: s.comp + (a.comp || 0),
    oos: s.oos + (a.oos || 0), photos: s.photos + (a.photos || 0), short: s.short + (a.shortCalls || 0),
    active: s.active + (a.visits.length ? 1 : 0),
  }), { visits: 0, planned: 0, missed: 0, orders: 0, value: 0, ours: 0, comp: 0, oos: 0, photos: 0, short: 0, active: 0 });
  const coverage = t.planned ? t.visits / t.planned : null;
  const exceptions = buildExceptions(rows, team);

  const rail = team === "sales" ? [
    { label: "Reps active", value: `${t.active}`, sub: `of ${rows.length} assigned` },
    { label: "Calls made", value: `${t.visits}`, sub: `of ${t.planned || "—"} assigned` },
    { label: "Coverage", value: pctText(coverage), tone: coverage == null ? "" : coverage < T.minCoverage ? "warn" : "good" },
    { label: "Strike rate", value: pctText(t.visits ? t.orders / t.visits : null), sub: `${t.orders} orders` },
    { label: "Order value", value: compact(t.value), tone: "good" },
    { label: "Not visited", value: `${t.missed}`, tone: t.missed ? "bad" : "" },
  ] : [
    { label: "Outlets serviced", value: `${t.visits}`, sub: `of ${t.planned || "—"} assigned` },
    { label: "Route adherence", value: pctText(coverage), tone: coverage == null ? "" : coverage < T.minCoverage ? "warn" : "good" },
    { label: "Share of shelf", value: pctText(t.ours + t.comp ? t.ours / (t.ours + t.comp) : null),
      sub: `${t.ours} of ${t.ours + t.comp} facings` },
    { label: "Out of stock", value: `${t.oos}`, sub: "SKU / store", tone: t.oos ? "bad" : "" },
    { label: "Short calls", value: `${t.short}`, sub: `under ${T.minCallMin} min`, tone: t.short ? "warn" : "" },
    { label: "Photos in", value: `${t.photos}`, sub: "from site today" },
  ];

  return (<>
    {head}
    {status === "stale" && (
      <div className="banner">Showing the last good read from {at ? nairobi(at).time : "earlier"}. {error}.
        <button className="linkbtn" onClick={reload}>Retry now</button></div>)}
    <StatRail items={rail} />
    <div className="split">
      <section className="pane">
        <SectionHead title={team === "sales" ? "The day so far" : "Time in store"}
          note={team === "sales"
            ? "Hollow squares are the assigned route. Filled pins are actual check-ins."
            : "Bar width is how long the call lasted. Thin bars are drive-bys."} />
        <DayStrip rows={rows} team={team} win={win} nowMin={nowMin} showNow={isToday}
          onPick={setPick} selected={pick} />
      </section>
      <DetailPanel pick={pick} date={date} onClose={() => setPick(null)} onOpenPhoto={onOpenPhoto} />
    </div>

    {team === "merchandising" && <PhotoWall rows={rows} onOpenPhoto={onOpenPhoto} />}

    <div className="split split--btm">
      <section className="pane">{team === "sales" ? <SalesTable rows={rows} /> : <ShelfWall rows={rows} />}</section>
      <section className="pane">{team === "sales"
        ? <ExceptionFeed items={exceptions} />
        : <OutOfStock data={data} rows={rows} />}</section>
    </div>

    {team === "merchandising" && exceptions.length > 0 && (
      <section className="pane"><ExceptionFeed items={exceptions} /></section>)}
  </>);
}

function PhotoWall({ rows, onOpenPhoto }) {
  const shots = [];
  rows.forEach(({ person, a }) => a.visits.forEach((v) =>
    v.photos.forEach((p) => shots.push({ ...p, store: v.store, who: person.name, time: v.time }))));
  return (
    <section className="pane">
      <SectionHead title="Work submitted from the field" note={shots.length ? `${shots.length} photos today` : null} />
      {shots.length === 0
        ? <p className="inline-empty">Nothing submitted yet. Photos land here within seconds of a merchandiser sending them.</p>
        : <div className="wall">{shots.map((p) => (
            <button key={p.id} className="wall-item" onClick={() => onOpenPhoto(p)}>
              <img src={p.thumbUrl || p.url} alt={p.label || "Shelf photo"} loading="lazy" />
              <span className="wall-meta">
                <span className="wall-label">{p.label || "Shelf"}</span>
                <span className="wall-sub mono">{p.store} · {p.who} · {p.time}</span>
              </span></button>))}
          </div>}
    </section>
  );
}

const SalesTable = ({ rows }) => (<>
  <SectionHead title="Rep performance" note="Updates as check-ins arrive" />
  <div className="tbl-wrap"><table className="tbl">
    <thead><tr><th>Rep</th><th>Route</th><th className="num">Calls</th><th className="num">Coverage</th>
      <th className="num">Strike</th><th className="num">Avg in store</th><th className="num">Value</th>
      <th className="num">Last seen</th></tr></thead>
    <tbody>{rows.map(({ person, a }) => (
      <tr key={person.id}>
        <td className="td-name">{person.name}</td>
        <td className="dim">{person.route || "—"}</td>
        <td className="num mono">{a.visits.length}</td>
        <td className="num"><Meter v={a.coverage} /></td>
        <td className="num mono">{pctText(a.strike)}</td>
        <td className="num mono">{a.avgDwell == null ? "—" : a.avgDwell + "m"}</td>
        <td className="num mono">{money(a.value)}</td>
        <td className={"num mono " + (a.idle > T.maxIdleMin ? "bad" : "dim")}>{a.last ? a.last.time : "—"}</td>
      </tr>))}</tbody></table></div>
</>);

function ShelfWall({ rows }) {
  const cards = [];
  rows.forEach(({ person, a }) => a.visits.forEach((v) => {
    if (v.ours + v.comp > 0) cards.push({ ...v, who: person.name }); }));
  cards.sort((x, y) => x.ours / (x.ours + x.comp) - y.ours / (y.ours + y.comp));
  return (<>
    <SectionHead title="Shelf position" note={cards.length ? "Weakest first" : null} />
    {cards.length === 0 ? <p className="inline-empty">No facing counts submitted yet.</p> : (
      <div className="shelfwall">{cards.slice(0, 9).map((s, i) => {
        const share = s.ours / (s.ours + s.comp);
        return (
          <div className="shelfcard" key={i}>
            <div className="shelfcard-top"><span className="shelfcard-store">{s.store}</span>
              <span className={"share mono " + (share < 0.3 ? "bad" : share < 0.4 ? "warn" : "good")}>{pctText(share)}</span></div>
            <ShelfGraphic ours={s.ours} comp={s.comp} />
            <div className="shelfcard-foot mono">{s.who} · {s.time}{s.photos?.length ? ` · ${s.photos.length} photos` : ""}</div>
          </div>);
      })}</div>)}
  </>);
}

function OutOfStock({ data, rows }) {
  let list = data?.outOfStock;
  if (!list?.length) {
    list = [];
    rows.forEach(({ person, a }) => a.visits.forEach((v) =>
      (v.outOfStockSkus || []).forEach((sku) =>
        list.push({ store: v.store, sku, reportedBy: person.name, time: v.time }))));
  }
  return (<>
    <SectionHead title="Gaps on shelf" note={list.length ? `${list.length} reported` : null} />
    {list.length === 0 ? <p className="inline-empty">Nothing reported out of stock today.</p> : (
      <ul className="oos">{list.map((r, i) => (
        <li key={i}><div className="oos-top"><span className="oos-sku">{r.sku}</span></div>
          <div className="oos-sub mono">{r.store} · {r.reportedBy}{r.time ? " · " + r.time : ""}</div></li>))}
      </ul>)}
  </>);
}

const ExceptionFeed = ({ items }) => (<>
  <SectionHead title="Needs attention" note={items.length ? `${items.length} open` : null} />
  {items.length === 0 ? <p className="inline-empty">Nothing outside the thresholds right now.</p> : (
    <ul className="feed">{items.map((e, i) => (
      <li key={i} className={"feed-item feed-item--" + e.sev}>
        <span className="feed-who">{e.who}</span><span className="feed-text">{e.text}</span></li>))}
    </ul>)}
</>);

/* ============================================================
   Setup — everything the manager creates
   ============================================================ */

const ROLES = [
  { id: "merchandising", label: "Merchandiser" },
  { id: "sales", label: "Sales rep" },
  { id: "supervisor", label: "Supervisor" },
];

function SetupView() {
  const [sub, setSub] = useState("team");
  const tabs = [["team", "Team"], ["stores", "Stores"], ["duties", "Duties"], ["lists", "Lists & shift"]];
  return (
    <>
      <div className="daybar">
        <h1 className="daybar-title">Setup</h1>
        <div className="daybar-right"><div className="seg">
          {tabs.map(([k, l]) => (
            <button key={k} className={"seg-btn " + (sub === k ? "seg-btn--on" : "")}
              onClick={() => setSub(k)}>{l}</button>))}
        </div></div>
      </div>
      {sub === "team" && <StaffAdmin />}
      {sub === "stores" && <StoreAdmin />}
      {sub === "duties" && <DutyAdmin />}
      {sub === "lists" && <SettingsAdmin />}
    </>
  );
}

/* --------------------------------------------------------- staff */

/** The address field staff open on their own phones. It is deliberately a
 *  different page from this console — signing in there gives someone their
 *  own stops and nothing else. */
function FieldLinkPanel() {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : window.location.origin + "/field";
  const local = /localhost|127\.0\.0\.1/.test(url);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  };

  return (
    <section className="pane">
      <SectionHead title="The field app" note="What reps and merchandisers open" />
      <p className="inline-empty" style={{ marginBottom: 12 }}>
        Field staff use a separate address and sign in with the phone number you register
        below. They see their own stops for the day — never the routes, totals or setup on
        this console.
      </p>
      <div className="fieldlink">
        <code className="mono fieldlink-url">{url}</code>
        <button className="ghostbtn sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <a className="ghostbtn sm" href="/field" target="_blank" rel="noreferrer">Open</a>
      </div>
      {local && (
        <div className="note note--warn">
          This address only works on this computer. Before handing it to staff, put the
          service on a machine or domain their phones can reach — a phone in Buruburu
          cannot open <span className="mono">localhost</span>. Once it is hosted, this
          panel shows the real address.
        </div>
      )}
    </section>
  );
}

function StaffAdmin() {
  const { status, data, error, reload } = useResource("/staff");
  const [form, setForm] = useState(null);
  const staff = data?.staff || [];
  if (status === "loading") return <Loading label="Team" />;
  if (status === "error") return <ErrorState message={error} onRetry={reload} />;

  return (<>
    {form && <StaffForm value={form} onClose={() => setForm(null)}
      onSaved={() => { setForm(null); reload(); }} />}
    <FieldLinkPanel />
    <section className="pane">
      <SectionHead title="Everyone on the road"
        note={staff.length ? `${staff.length} on file` : null} />
      {staff.length === 0 ? (
        <p className="inline-empty">
          No employees yet. Add your sales reps and merchandisers — assignments, check-ins and
          photos all hang off these records, and the phone number is how they sign in to the field app.
        </p>
      ) : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Territory</th><th>Phone</th><th>PIN</th>
            <th>Employee no.</th><th>Status</th><th /></tr></thead>
          <tbody>{staff.map((s) => (
            <tr key={s.id}>
              <td className="td-name">{s.name}</td>
              <td>{ROLES.find((r) => r.id === s.role)?.label || s.role}</td>
              <td className="dim">{s.territory || "—"}</td>
              <td className="mono">{s.phone}</td>
              <td className="mono dim">{s.pin ? "set" : "none"}</td>
              <td className="mono dim">{s.employeeNo || "—"}</td>
              <td><span className={"pill " + (s.status === "active" ? "pill--on" : "pill--off")}>
                {s.status === "active" ? "Active" : "Inactive"}</span></td>
              <td className="num">
                <button className="linkbtn" onClick={() => setForm(s)}>Edit</button>
                <button className="linkbtn" onClick={async () => {
                  await apiSend(`/staff/${s.id}`, { status: s.status === "active" ? "inactive" : "active" }, "PATCH");
                  reload();
                }}>{s.status === "active" ? "Deactivate" : "Reactivate"}</button>
              </td>
            </tr>))}</tbody></table></div>
      )}
      <div className="row-actions">
        <button className="primary" onClick={() => setForm({})}>Add employee</button>
      </div>
    </section>
  </>);
}

function StaffForm({ value, onClose, onSaved }) {
  const editing = !!value.id;
  const [v, setV] = useState({
    name: "", role: "merchandising", phone: "", pin: "", territory: "",
    employeeNo: "", startDate: nairobi().date, status: "active", ...value,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const ready = v.name.trim() && v.phone.trim();

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (editing) await apiSend(`/staff/${v.id}`, v, "PATCH");
      else await apiSend("/staff", v);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="pane">
      <SectionHead title={editing ? `Edit ${value.name}` : "Add employee"}
        note="They can sign in to the field app as soon as this is saved" />
      <div className="grid3">
        <Field label="Full name"><input value={v.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Role"><select value={v.role} onChange={set("role")}>
          {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
        <Field label="Phone" hint="How they sign in">
          <input value={v.phone} onChange={set("phone")} inputMode="tel" placeholder="+254…" /></Field>
        <Field label="PIN" hint="Four digits. Leave blank to sign in with the phone number alone">
          <input value={v.pin} onChange={set("pin")} inputMode="numeric" maxLength={4} /></Field>
        <Field label="Territory" hint="Their usual patch"><input value={v.territory} onChange={set("territory")} /></Field>
        <Field label="Employee number"><input value={v.employeeNo} onChange={set("employeeNo")} /></Field>
        <Field label="Start date"><input type="date" value={v.startDate} onChange={set("startDate")} /></Field>
      </div>
      {err && <div className="note note--bad">Not saved — {err}.</div>}
      <div className="row-actions">
        <button className="primary" disabled={!ready || busy} onClick={save}>
          {busy ? "Saving…" : editing ? "Save changes" : "Save employee"}</button>
        <button className="ghostbtn" onClick={onClose}>Cancel</button>
        {!ready && <span className="hint-inline">Name and phone are required.</span>}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- stores */

function StoreAdmin() {
  const { status, data, error, reload } = useResource("/stores");
  const [form, setForm] = useState(null);
  const [q, setQ] = useState("");
  const stores = (data?.stores || []).filter((s) =>
    !q || s.name.toLowerCase().includes(q.toLowerCase()) || (s.area || "").toLowerCase().includes(q.toLowerCase()));
  if (status === "loading") return <Loading label="Stores" />;
  if (status === "error") return <ErrorState message={error} onRetry={reload} />;

  return (<>
    {form && <StoreForm value={form} onClose={() => setForm(null)}
      onSaved={() => { setForm(null); reload(); }} />}
    <section className="pane">
      <SectionHead title="Stores you call on"
        note={data?.stores?.length ? `${data.stores.length} on file` : null} />
      {!data?.stores?.length ? (
        <p className="inline-empty">
          No stores yet. Add the outlets your team visits — you pick from this list when building a
          day, and the coordinates let the system check that a check-in really happened at the door.
        </p>
      ) : (<>
        <div className="row-actions" style={{ marginTop: 0, marginBottom: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or area" className="grow" />
        </div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Store</th><th>Chain</th><th>Channel</th><th>Area</th>
            <th>Coordinates</th><th>Status</th><th /></tr></thead>
          <tbody>{stores.map((s) => (
            <tr key={s.id}>
              <td className="td-name">{s.name}</td>
              <td>{s.chain || "—"}</td>
              <td className="dim">{s.channel || "—"}</td>
              <td className="dim">{s.area || "—"}</td>
              <td className="mono dim">{s.lat != null && s.lng != null
                ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`
                : <span className="warn">not set</span>}</td>
              <td><span className={"pill " + (s.status === "active" ? "pill--on" : "pill--off")}>
                {s.status === "active" ? "Active" : "Inactive"}</span></td>
              <td className="num"><button className="linkbtn" onClick={() => setForm(s)}>Edit</button></td>
            </tr>))}</tbody></table></div>
      </>)}
      <div className="row-actions"><button className="primary" onClick={() => setForm({})}>Add store</button></div>
    </section>
  </>);
}

function StoreForm({ value, onClose, onSaved }) {
  const editing = !!value.id;
  const settings = useResource("/settings");
  const lists = settings.data?.lists || {};
  const [v, setV] = useState({
    name: "", chain: "", channel: "", area: "", address: "", contact: "",
    lat: "", lng: "", status: "active", ...value,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [locating, setLocating] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setV((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })); setLocating(false); },
      () => setLocating(false), { enableHighAccuracy: true, timeout: 12000 });
  };

  const save = async () => {
    setBusy(true); setErr(null);
    const body = { ...v, lat: v.lat === "" ? null : Number(v.lat), lng: v.lng === "" ? null : Number(v.lng) };
    try {
      if (editing) await apiSend(`/stores/${v.id}`, body, "PATCH");
      else await apiSend("/stores", body);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="pane">
      <SectionHead title={editing ? `Edit ${value.name}` : "Add store"}
        note="Coordinates are optional, but without them check-ins cannot be verified" />
      <div className="grid3">
        <Field label="Store name"><input value={v.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Chain" hint="Leave blank for independents">
          <input value={v.chain} onChange={set("chain")} list="chains" />
          <datalist id="chains">{(lists.chains || []).map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Channel"><input value={v.channel} onChange={set("channel")} list="channels" />
          <datalist id="channels">{(lists.channels || []).map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Area"><input value={v.area} onChange={set("area")} list="areas" />
          <datalist id="areas">{(lists.territories || []).map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Address"><input value={v.address} onChange={set("address")} /></Field>
        <Field label="Contact at the store"><input value={v.contact} onChange={set("contact")} /></Field>
        <Field label="Latitude"><input value={v.lat} onChange={set("lat")} inputMode="decimal" placeholder="-1.2635" /></Field>
        <Field label="Longitude"><input value={v.lng} onChange={set("lng")} inputMode="decimal" placeholder="36.8021" /></Field>
        <Field label="Status"><select value={v.status} onChange={set("status")}>
          <option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
      </div>
      <div className="row-actions">
        <button className="ghostbtn sm" onClick={useMyLocation} disabled={locating}>
          {locating ? "Reading location…" : "Use my current location"}</button>
        <span className="hint-inline">Stand at the shop door and tap this to record the exact spot.</span>
      </div>
      {err && <div className="note note--bad">Not saved — {err}.</div>}
      <div className="row-actions">
        <button className="primary" disabled={!v.name.trim() || busy} onClick={save}>
          {busy ? "Saving…" : editing ? "Save changes" : "Save store"}</button>
        <button className="ghostbtn" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- duties */

function DutyAdmin() {
  const { status, data, error, reload } = useResource("/reference/duties");
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const duties = data?.duties || [];
  if (status === "loading") return <Loading label="Duties" />;
  if (status === "error") return <ErrorState message={error} onRetry={reload} />;

  return (<>
    {form && <DutyForm value={form} onClose={() => setForm(null)}
      onSaved={() => { setForm(null); reload(); }} />}
    <section className="pane">
      <SectionHead title="What people do at a stop"
        note={duties.length ? `${duties.length} duties` : null} />
      {duties.length === 0 ? (<>
        <p className="inline-empty">
          No duties yet. These are what you tick against each stop when planning a day, and what the
          merchandiser sees as a checklist in the store. Duties marked for photos give them a labelled
          camera button, so the pictures arrive sorted rather than in a pile.
        </p>
        <div className="row-actions">
          <button className="primary" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await apiSend("/duties/standard", {}); reload(); } finally { setBusy(false); }
          }}>Start with the standard list</button>
          <button className="ghostbtn" onClick={() => setForm({})}>Write my own</button>
        </div>
      </>) : (<>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Duty</th><th>For</th><th>Photo</th><th>Photo label</th><th /></tr></thead>
          <tbody>{duties.map((d) => (
            <tr key={d.id}>
              <td className="td-name">{d.label}</td>
              <td>{d.role === "both" ? "Everyone" : d.role === "sales" ? "Sales reps" : "Merchandisers"}</td>
              <td>{d.requiresPhoto ? <span className="pill pill--draft">Required</span> : <span className="dim">—</span>}</td>
              <td className="dim">{d.photoLabel || "—"}</td>
              <td className="num">
                <button className="linkbtn" onClick={() => setForm(d)}>Edit</button>
                <button className="linkbtn" onClick={async () => { await apiDelete(`/duties/${d.id}`); reload(); }}>Remove</button>
              </td>
            </tr>))}</tbody></table></div>
        <div className="row-actions"><button className="primary" onClick={() => setForm({})}>Add duty</button></div>
      </>)}
    </section>
  </>);
}

function DutyForm({ value, onClose, onSaved }) {
  const editing = !!value.id;
  const [v, setV] = useState({ label: "", role: "merchandising", requiresPhoto: false,
    photoLabel: "", order: 99, ...value });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (editing) await apiSend(`/duties/${v.id}`, v, "PATCH");
      else await apiSend("/duties", v);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="pane">
      <SectionHead title={editing ? `Edit ${value.label}` : "Add duty"} />
      <div className="grid3">
        <Field label="What is done" hint="Written as an instruction">
          <input value={v.label} onChange={set("label")} placeholder="Restock from back store" autoFocus /></Field>
        <Field label="Who it applies to"><select value={v.role} onChange={set("role")}>
          <option value="merchandising">Merchandisers</option>
          <option value="sales">Sales reps</option>
          <option value="both">Everyone</option></select></Field>
        <Field label="Order in the list"><input value={v.order} onChange={set("order")} inputMode="numeric" /></Field>
      </div>
      <label className={"check " + (v.requiresPhoto ? "check--on" : "")} style={{ maxWidth: 340 }}>
        <input type="checkbox" checked={v.requiresPhoto}
          onChange={() => setV({ ...v, requiresPhoto: !v.requiresPhoto })} />
        <span>Needs a photo as proof</span>
      </label>
      {v.requiresPhoto && (
        <Field label="What the photo should show" hint="Appears on the camera button in the field app">
          <input value={v.photoLabel} onChange={set("photoLabel")} placeholder="Shelf after restock" /></Field>)}
      {err && <div className="note note--bad">Not saved — {err}.</div>}
      <div className="row-actions">
        <button className="primary" disabled={!v.label.trim() || busy} onClick={save}>
          {busy ? "Saving…" : editing ? "Save changes" : "Save duty"}</button>
        <button className="ghostbtn" onClick={onClose}>Cancel</button>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- settings */

const LIST_FIELDS = [
  ["categories", "Product categories", "Dried fruits"],
  ["channels", "Sales channels", "Mini-marts"],
  ["chains", "Retail chains", "Naivas"],
  ["territories", "Territories", "Westlands"],
  ["paymentTerms", "Payment terms", "30 days"],
  ["vatTreatments", "VAT treatments", "16% standard"],
  ["storage", "Storage conditions", "Ambient"],
  ["owners", "Who can raise a product", "Operations manager"],
];

/* Written from the manager's side of the screen: what each limit means in the
   day, not what the field is called in the database. */
const THRESHOLD_FIELDS = [
  ["minCallMin", "Shortest real call", "Below this a merchandising call is marked a drive-by", "min"],
  ["maxIdleMin", "Longest quiet spell", "Raise a flag when nobody has checked in for this long", "min"],
  ["maxGpsDeltaKm", "How far from the shop", "A check-in further than this is treated as out of range", "km"],
  ["minShareOfShelf", "Shelf share floor", "Below this the store is flagged as losing ground", "%"],
  ["minCoverage", "Route coverage target", "Colours the coverage bars amber below this", "%"],
  ["minStrikeRate", "Strike rate floor", "A rep converting less than this gets flagged", "%"],
  ["minMarginPct", "Margin floor on new products", "Onboarding warns below this", "%"],
  ["poorAccuracyM", "Weak GPS warning", "Tells the merchandiser their signal is poor at check-in", "m"],
];

function SettingsAdmin() {
  const { status, data, error, reload } = useResource("/settings");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { if (data) setDraft(JSON.parse(JSON.stringify(data))); }, [data]);
  if (status === "loading" || !draft) return <Loading label="Lists and shift" />;
  if (status === "error") return <ErrorState message={error} onRetry={reload} />;

  const setList = (k, v) => setDraft({ ...draft, lists: { ...draft.lists, [k]: v } });
  const save = async () => {
    setBusy(true); setMsg(null);
    const thresholds = Object.fromEntries(
      Object.entries(draft.thresholds || {})
        .filter(([, v]) => v !== "" && Number.isFinite(Number(v)))
        .map(([k, v]) => [k, Number(v)]));
    try {
      await apiSend("/settings", { shiftStart: draft.shiftStart, shiftEnd: draft.shiftEnd,
        currency: draft.currency, lists: draft.lists, thresholds }, "PUT");
      Object.assign(T, thresholds);          // apply to this screen without a reload
      CONFIG.currency = draft.currency || CONFIG.currency;
      setMsg({ tone: "good", text: "Saved. The new limits apply from the next call closed." });
      reload();
    } catch (e) { setMsg({ tone: "bad", text: `Not saved — ${e.message}.` }); }
    finally { setBusy(false); }
  };

  return (
    <section className="pane">
      <SectionHead title="Working day and picklists"
        note="These fill the dropdowns everywhere else in the dashboard" />
      <div className="grid3">
        <Field label="Day starts" hint="Left edge of every timeline">
          <input type="time" value={draft.shiftStart} onChange={(e) => setDraft({ ...draft, shiftStart: e.target.value })} /></Field>
        <Field label="Day ends"><input type="time" value={draft.shiftEnd}
          onChange={(e) => setDraft({ ...draft, shiftEnd: e.target.value })} /></Field>
        <Field label="Currency"><input value={draft.currency}
          onChange={(e) => setDraft({ ...draft, currency: e.target.value })} /></Field>
      </div>

      {LIST_FIELDS.map(([k, label, eg]) => (
        <div className="listblock" key={k}>
          <div className="field-label">{label}</div>
          <TagList value={draft.lists[k] || []} onChange={(v) => setList(k, v)} placeholder={`e.g. ${eg}`} />
        </div>
      ))}

      <div className="listblock">
        <SectionHead title="When to raise a flag"
          note="These decide what counts as a problem, on screen and in the verdict each call gets" />
        <div className="grid3">
          {THRESHOLD_FIELDS.map(([k, label, hint, unit]) => (
            <Field key={k} label={label} hint={hint}>
              <div className="unitwrap">
                <input inputMode="decimal"
                  value={unit === "%" ? Math.round((draft.thresholds?.[k] ?? 0) * 100) : (draft.thresholds?.[k] ?? "")}
                  onChange={(e) => {
                    const raw = e.target.value === "" ? "" : Number(e.target.value);
                    setDraft({ ...draft, thresholds: { ...draft.thresholds,
                      [k]: raw === "" ? "" : unit === "%" ? raw / 100 : raw } });
                  }} />
                <span className="unit mono">{unit}</span>
              </div>
            </Field>
          ))}
        </div>
      </div>

      {msg && <div className={"note note--" + msg.tone}>{msg.text}</div>}
      <div className="row-actions">
        <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      </div>
    </section>
  );
}

/* ============================================================
   Day planner
   ============================================================ */

function PlannerView({ today }) {
  const [team, setTeam] = useState("merchandising");
  const [date, setDate] = useState(shiftDate(today, 1));
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const staffRes = useResource("/staff", { role: team, status: "active" });
  const dutiesRes = useResource("/duties", { role: team });
  const storesRes = useResource("/reference/stores");

  const duties = dutiesRes.data?.duties || [];
  const stores = storesRes.data?.stores || [];
  const staff = staffRes.data?.staff || [];

  const load = useCallback(async () => {
    setStatus("loading"); setError(null);
    try {
      const d = await apiGet("/plans", { date, team });
      setPlan({ date, team, status: d?.status || "draft", assignments: d?.assignments || [] });
      setStatus("ready"); setDirty(false); setMsg(null);
    } catch (e) { setError(e.message); setStatus("error"); }
  }, [date, team]);
  useEffect(() => { load(); }, [load]);

  const update = (fn) => { setPlan((p) => fn(JSON.parse(JSON.stringify(p)))); setDirty(true); setMsg(null); };

  const addPerson = (personId) => {
    const s = staff.find((x) => x.id === personId);
    if (!s) return;
    update((p) => {
      if (!p.assignments.some((a) => a.personId === s.id))
        p.assignments.push({ personId: s.id, personName: s.name, role: s.role,
          routeName: s.territory || "", stops: [] });
      return p;
    });
  };
  const addStop = (personId) => update((p) => {
    const a = p.assignments.find((x) => x.personId === personId);
    const lastTime = a.stops.length ? a.stops[a.stops.length - 1].time : "07:30";
    const next = Math.min((toMin(lastTime) ?? 450) + 60, 17 * 60);
    a.stops.push({ id: "new-" + uid(), store: "", storeId: null,
      time: String(Math.floor(next / 60)).padStart(2, "0") + ":" + String(next % 60).padStart(2, "0"),
      duties: [], note: "" });
    return p;
  });

  const copyFrom = async (fromDate) => {
    setSaving(true); setMsg(null);
    try {
      const r = await apiSend("/plans/copy", { fromDate, toDate: date, team });
      setPlan({ date, team, status: r.status || "draft", assignments: r.assignments || [] });
      setDirty(false);
      setMsg({ tone: "good", text: `Brought forward from ${relativeDay(fromDate, today).toLowerCase()}. Adjust it, then publish.` });
    } catch (e) { setMsg({ tone: "bad", text: `Could not copy — ${e.message}.` }); }
    finally { setSaving(false); }
  };

  const save = async (publish) => {
    setSaving(true); setMsg(null);
    try {
      const saved = await apiSend("/plans", { ...plan, status: publish ? "published" : "draft" });
      setPlan({ date, team, status: saved.status, assignments: saved.assignments });
      setDirty(false);
      setMsg({ tone: "good", text: publish
        ? `Published. Everyone on this list now sees their stops for ${relativeDay(date, today).toLowerCase()} in the field app.`
        : "Saved as a draft. Nobody sees it until you publish." });
    } catch (e) { setMsg({ tone: "bad", text: `Not saved — ${e.message}. Your edits are still on screen.` }); }
    finally { setSaving(false); }
  };

  const setupGap = !staff.length || !duties.length || !stores.length;
  const totalStops = plan?.assignments.reduce((s, a) => s + a.stops.length, 0) || 0;
  const unassigned = staff.filter((s) => !plan?.assignments.some((a) => a.personId === s.id));

  return (
    <>
      <div className="daybar">
        <h1 className="daybar-title">Plan the day</h1>
        <div className="daybar-right">
          <div className="seg">
            {[["merchandising", "Merchandisers"], ["sales", "Sales reps"]].map(([k, l]) => (
              <button key={k} className={"seg-btn " + (team === k ? "seg-btn--on" : "")}
                onClick={() => setTeam(k)}>{l}</button>))}
          </div>
          <label className="datepick"><span className="eyebrow">For</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value || today)} /></label>
          <span className="daytag">{relativeDay(date, today)}</span>
        </div>
      </div>

      {setupGap && (
        <div className="note note--warn">
          Before you can build a day you need{" "}
          {[!staff.length && "people on the team", !stores.length && "stores to visit",
            !duties.length && "duties to assign"].filter(Boolean).join(", ")}. Add them under Setup.
        </div>
      )}

      {status === "loading" && <Loading label="Assignments" rows={3} />}
      {status === "error" && <ErrorState message={error} onRetry={load} />}

      {status === "ready" && (<>
        <div className="planbar">
          <div className="planbar-left">
            <span className={"pill " + (plan.status === "published" ? "pill--on" : "pill--draft")}>
              {plan.status === "published" ? "Published" : "Draft"}</span>
            <span className="dim">{plan.assignments.length} {plan.assignments.length === 1 ? "person" : "people"} · {totalStops} stops</span>
            {dirty && <span className="warn">Unsaved changes</span>}
          </div>
          <div className="planbar-right">
            <button className="ghostbtn sm" disabled={saving} onClick={() => copyFrom(shiftDate(date, -1))}>
              Bring forward {relativeDay(shiftDate(date, -1), today).toLowerCase()}</button>
            <button className="ghostbtn sm" disabled={saving || !dirty} onClick={() => save(false)}>Save draft</button>
            <button className="primary sm" disabled={saving || !totalStops} onClick={() => save(true)}>
              {saving ? "Working…" : "Publish to the team"}</button>
          </div>
        </div>

        {msg && <div className={"note note--" + msg.tone}>{msg.text}</div>}

        {plan.assignments.length === 0 ? (
          <EmptyState title={`Nobody is assigned for ${relativeDay(date, today).toLowerCase()}`}
            copy="Add someone below, or bring forward the previous day's plan and adjust it."
            action={<AddPerson people={unassigned} onAdd={addPerson} />} />
        ) : (<>
          <div className="plangrid">
            {plan.assignments.map((a) => (
              <PersonPlan key={a.personId} a={a} duties={duties} stores={stores}
                onRoute={(routeName) => update((p) => {
                  p.assignments.find((x) => x.personId === a.personId).routeName = routeName; return p; })}
                onAddStop={() => addStop(a.personId)}
                onSetStop={(id, patch) => update((p) => {
                  const t2 = p.assignments.find((x) => x.personId === a.personId);
                  Object.assign(t2.stops.find((s) => s.id === id), patch); return p; })}
                onRemoveStop={(id) => update((p) => {
                  const t2 = p.assignments.find((x) => x.personId === a.personId);
                  t2.stops = t2.stops.filter((s) => s.id !== id); return p; })}
                onRemove={() => update((p) => {
                  p.assignments = p.assignments.filter((x) => x.personId !== a.personId); return p; })} />
            ))}
          </div>
          <div className="pane"><AddPerson people={unassigned} onAdd={addPerson} /></div>
        </>)}
      </>)}
    </>
  );
}

function AddPerson({ people, onAdd }) {
  const [sel, setSel] = useState("");
  if (!people.length) return <p className="inline-empty">Everyone available is already assigned.</p>;
  return (
    <div className="addperson">
      <span className="eyebrow">Add someone to this day</span>
      <div className="row-actions">
        <select value={sel} onChange={(e) => setSel(e.target.value)} className="grow">
          <option value="">Choose a person…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.territory ? ` — ${p.territory}` : ""}</option>)}
        </select>
        <button className="ghostbtn" disabled={!sel} onClick={() => { onAdd(sel); setSel(""); }}>Add</button>
      </div>
    </div>
  );
}

function PersonPlan({ a, duties, stores, onRoute, onAddStop, onSetStop, onRemoveStop, onRemove }) {
  return (
    <section className="pane plancard">
      <div className="plancard-head">
        <div>
          <div className="plancard-name">{a.personName}</div>
          <input className="routename" value={a.routeName} placeholder="Name this route"
            onChange={(e) => onRoute(e.target.value)} />
        </div>
        <button className="linkbtn" onClick={onRemove}>Remove</button>
      </div>

      {a.stops.length === 0 ? <p className="inline-empty">No stops yet.</p> : (
        <ol className="stops">
          {a.stops.map((s, i) => (
            <li className="stop" key={s.id}>
              <div className="stop-top">
                <span className="stop-n mono">{String(i + 1).padStart(2, "0")}</span>
                <input className="stop-time mono" type="time" value={s.time}
                  onChange={(e) => onSetStop(s.id, { time: e.target.value })} />
                <select className="stop-store" value={s.storeId || ""}
                  onChange={(e) => {
                    const st = stores.find((x) => x.id === e.target.value);
                    onSetStop(s.id, { storeId: st?.id || null, store: st?.name || "" });
                  }}>
                  <option value="">Which store?</option>
                  {stores.map((st) => <option key={st.id} value={st.id}>{st.name}{st.area ? ` — ${st.area}` : ""}</option>)}
                </select>
                <button className="x" onClick={() => onRemoveStop(s.id)} aria-label="Remove stop">×</button>
              </div>
              <Chips small options={duties} value={s.duties}
                onToggle={(id) => onSetStop(s.id, {
                  duties: s.duties.includes(id) ? s.duties.filter((d) => d !== id) : [...s.duties, id] })} />
              {!s.duties.length && <span className="hint-inline">Pick at least one duty, or they arrive with nothing to do.</span>}
            </li>))}
        </ol>)}
      <button className="ghostbtn sm" onClick={onAddStop}>Add a stop</button>
    </section>
  );
}

/* ============================================================
   Field app
   ============================================================ */

async function downscale(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, CONFIG.photo.maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return (await new Promise((r) => c.toBlob(r, "image/jpeg", CONFIG.photo.quality))) || file;
  } catch { return file; } finally { URL.revokeObjectURL(url); }
}

const locate = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
});

function SignIn({ onIn }) {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await apiSend("/field/sign-in", { phone, pin }); onIn(r.person); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fa">
      <div className="fa-head"><div>
        <div className="eyebrow">G2M field</div>
        <h1 className="fa-title">Sign in</h1>
      </div></div>
      <div className="fa-block">
        <p className="fa-copy">Use the phone number the office registered for you.</p>
        <Field label="Phone number"><input value={phone} onChange={(e) => setPhone(e.target.value)}
          inputMode="tel" placeholder="+254…" autoFocus /></Field>
        <Field label="PIN" hint="Leave blank if you were not given one">
          <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={4} /></Field>
        {err && <div className="note note--bad">{err}.</div>}
        <button className="primary wide" onClick={go} disabled={!phone.trim() || busy}>
          {busy ? "Checking…" : "Sign in"}</button>
      </div>
    </div>
  );
}

function MyDay({ person, today }) {
  const { status, data, error, reload, setData } = useResource("/field/me/day", { personId: person.id, date: today });
  const [openStop, setOpenStop] = useState(null);

  if (status === "loading") return <div className="fa"><Loading label="My day" /></div>;
  if (status === "error") return <div className="fa"><ErrorState message={error} onRetry={reload} /></div>;

  const stops = data?.stops || [];
  const done = stops.filter((s) => s.status === "done").length;
  const current = openStop && stops.find((s) => s.id === openStop);

  if (current) return <StopScreen stop={current} onBack={() => { setOpenStop(null); reload(); }}
    onChange={(patch) => setData({ ...data, stops: stops.map((s) => s.id === current.id ? { ...s, ...patch } : s) })}
    onDone={() => { setOpenStop(null); reload(); }} />;

  return (
    <div className="fa">
      <div className="fa-head">
        <div>
          <div className="eyebrow">{prettyDate(today)}</div>
          <h1 className="fa-title">Morning, {person.name.split(" ")[0]}</h1>
        </div>
        <div className="fa-count mono">{done}<span className="dim">/{stops.length}</span></div>
      </div>

      {stops.length === 0 ? (
        <EmptyState title="No stops yet"
          copy="Your route is published by the office each morning. Check again once it is out."
          action={<button className="ghostbtn" onClick={reload}>Check again</button>} />
      ) : (
        <ol className="fa-list">{stops.map((s, i) => {
          const total = (s.duties || []).length;
          const fin = (s.duties || []).filter((d) => d.done).length;
          return (
            <li key={s.id}>
              <button className={"fa-card fa-card--" + (s.status || "pending")} onClick={() => setOpenStop(s.id)}>
                <div className="fa-card-top">
                  <span className="fa-time mono">{s.time}</span>
                  <span className="fa-store">{s.store}</span>
                  <span className={"fa-state fa-state--" + (s.status || "pending")}>
                    {s.status === "done" ? "Done" : s.status === "open" ? "In progress" : `Stop ${i + 1}`}</span>
                </div>
                <div className="fa-card-sub mono">
                  {s.address || "—"} · {fin}/{total} duties{s.photos?.length ? ` · ${s.photos.length} photos` : ""}
                </div>
              </button>
            </li>);
        })}</ol>
      )}
    </div>
  );
}

function StopScreen({ stop, onBack, onChange, onDone }) {
  const [notes, setNotes] = useState(stop.notes || "");
  const [ours, setOurs] = useState(stop.ourFacings ?? "");
  const [comp, setComp] = useState(stop.competitorFacings ?? "");
  const [oosText, setOosText] = useState((stop.outOfStockSkus || []).join(", "));
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const pending = useRef({ label: null, dutyId: null });

  // Object URLs for the local previews are released when the stop is left.
  const live = useRef([]);
  useEffect(() => () => live.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const duties = stop.duties || [];
  const required = duties.filter((d) => d.requiresPhoto);
  const sentLabels = [...(stop.photos || []).map((p) => p.label),
    ...queue.filter((q) => q.status === "sent").map((q) => q.label)];
  const missingShots = required.filter((d) => !sentLabels.includes(d.photoLabel || d.label));

  const checkIn = async () => {
    setBusy("checkin"); setErr(null);
    const where = await locate();
    setPos(where);
    try {
      const r = await apiSend(`/field/visits/${stop.id}/check-in`, { ...(where || {}), at: new Date().toISOString() });
      onChange({ status: "open", checkInAt: r.checkInAt });
    } catch (e) { setErr(`Check-in did not go through — ${e.message}.`); }
    finally { setBusy(null); }
  };

  const pickPhoto = (label, dutyId) => { pending.current = { label, dutyId }; inputRef.current?.click(); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const { label, dutyId } = pending.current;
    const preview = URL.createObjectURL(file);
    live.current.push(preview);
    const item = { localId: uid(), label, dutyId, status: "uploading", preview };
    setQueue((q) => [...q, item]);
    try {
      const blob = await downscale(file);
      const where = pos || (await locate());
      const fd = new FormData();
      fd.append("photo", blob, `${(label || "photo").replace(/\s+/g, "-").toLowerCase()}.jpg`);
      fd.append("label", label || "Photo");
      if (dutyId) fd.append("dutyId", dutyId);
      fd.append("capturedAt", new Date().toISOString());
      if (where) { fd.append("lat", where.lat); fd.append("lng", where.lng); fd.append("accuracyM", where.accuracyM); }
      await apiUpload(`/field/visits/${stop.id}/photos`, fd);
      setQueue((q) => q.map((x) => x.localId === item.localId ? { ...x, status: "sent" } : x));
    } catch (e2) {
      setQueue((q) => q.map((x) => x.localId === item.localId ? { ...x, status: "failed", error: e2.message } : x));
    }
  };

  const toggleDuty = (dutyId) =>
    onChange({ duties: duties.map((d) => (d.dutyId === dutyId ? { ...d, done: !d.done } : d)) });

  const saveWork = async () => {
    setBusy("save"); setErr(null);
    try {
      await apiSend(`/field/visits/${stop.id}`, {
        duties: duties.map((d) => ({ dutyId: d.dutyId, done: !!d.done })),
        notes: notes.trim(),
        outOfStockSkus: oosText.split(",").map((s) => s.trim()).filter(Boolean),
        ourFacings: ours === "" ? null : Number(ours),
        competitorFacings: comp === "" ? null : Number(comp),
      }, "PATCH");
      return true;
    } catch (e) { setErr(`Not saved — ${e.message}.`); return false; }
    finally { setBusy(null); }
  };

  const complete = async () => {
    if (!(await saveWork())) return;
    setBusy("complete");
    try { await apiSend(`/field/visits/${stop.id}/complete`, { at: new Date().toISOString() }); onDone(); }
    catch (e) { setErr(`Could not close the call — ${e.message}.`); }
    finally { setBusy(null); }
  };

  const notCheckedIn = stop.status !== "open" && stop.status !== "done";

  return (
    <div className="fa">
      <button className="fa-back" onClick={onBack}>← My day</button>
      <div className="fa-head"><div>
        <div className="eyebrow mono">{stop.time}</div>
        <h1 className="fa-title">{stop.store}</h1>
        {stop.address && <div className="fa-addr mono">{stop.address}</div>}
      </div></div>

      {notCheckedIn ? (
        <div className="fa-block">
          <p className="fa-copy">Check in when you are inside the store. Your location is recorded
            once, at check-in — not through the day.</p>
          <button className="primary wide" onClick={checkIn} disabled={busy === "checkin"}>
            {busy === "checkin" ? "Checking in…" : "Check in here"}</button>
        </div>
      ) : (
        <div className="fa-checked mono">
          Checked in{stop.checkInAt ? ` at ${nairobi(new Date(stop.checkInAt)).time}` : ""}
          {pos && <> · accuracy {pos.accuracyM} m
            {pos.accuracyM > T.poorAccuracyM && <span className="warn"> · weak signal</span>}</>}
        </div>
      )}

      <fieldset className="fa-block" disabled={notCheckedIn}>
        <div className="eyebrow">What to do here</div>
        <ul className="dutylist">
          {duties.map((d) => (
            <li key={d.id}>
              <label className={"duty " + (d.done ? "duty--done" : "")}>
                <input type="checkbox" checked={!!d.done} onChange={() => toggleDuty(d.dutyId)} />
                <span className="duty-label">{d.label}</span>
                {d.requiresPhoto && <span className="duty-cam">photo</span>}
              </label>
              {d.requiresPhoto && (
                <button className="shotbtn" onClick={() => pickPhoto(d.photoLabel || d.label, d.dutyId)}>
                  Take photo — {d.photoLabel || d.label}</button>)}
            </li>))}
          {duties.length === 0 && <li className="inline-empty">No duties were set for this stop.</li>}
        </ul>

        <input ref={inputRef} type="file" accept="image/*" capture="environment"
          onChange={onFile} style={{ display: "none" }} />

        <div className="eyebrow eyebrow--mt">Photos</div>
        <div className="fa-thumbs">
          {(stop.photos || []).map((p) => (
            <div className="fa-thumb" key={p.id}>
              <img src={p.thumbUrl || p.url} alt={p.label} />
              <span className="fa-thumb-tag good">sent</span></div>))}
          {queue.map((q) => (
            <div className="fa-thumb" key={q.localId}>
              <img src={q.preview} alt={q.label} />
              <span className={"fa-thumb-tag " + (q.status === "sent" ? "good" : q.status === "failed" ? "bad" : "dim")}>
                {q.status === "uploading" ? "sending…" : q.status === "sent" ? "sent" : "not sent"}</span>
              {q.status === "failed" && (
                <button className="retry" onClick={() => {
                  setQueue((x) => x.filter((y) => y.localId !== q.localId));
                  pickPhoto(q.label, q.dutyId);
                }}>Retake</button>)}
            </div>))}
          <button className="fa-addshot" onClick={() => pickPhoto("Extra photo", null)}>+ Add a photo</button>
        </div>

        <div className="grid2 fa-grid">
          <Field label="Our facings"><input value={ours} onChange={(e) => setOurs(e.target.value)} inputMode="numeric" /></Field>
          <Field label="Competitor facings"><input value={comp} onChange={(e) => setComp(e.target.value)} inputMode="numeric" /></Field>
        </div>
        <Field label="Anything out of stock" hint="Separate with commas">
          <input value={oosText} onChange={(e) => setOosText(e.target.value)} /></Field>
        <Field label="Note for the office">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

        {missingShots.length > 0 && (
          <div className="note note--warn">
            Still to photograph: {missingShots.map((d) => d.photoLabel || d.label).join(", ")}.</div>)}
        {err && <div className="note note--bad">{err}</div>}

        <div className="fa-actions">
          <button className="ghostbtn wide" onClick={saveWork} disabled={busy === "save"}>
            {busy === "save" ? "Saving…" : "Save and keep working"}</button>
          <button className="primary wide" onClick={complete} disabled={busy === "complete"}>
            {busy === "complete" ? "Closing…" : "Finish this store"}</button>
        </div>
      </fieldset>
    </div>
  );
}

/* ============================================================
   Products
   ============================================================ */

const RESEARCH = [
  ["pricing", "Pricing bands in Nairobi retail"],
  ["competitors", "Competitor scan and shelf prices"],
  ["stores", "Target store list by channel"],
  ["swot", "SWOT and positioning"],
  ["forecast", "Volume forecast and first order sizing"],
  ["checklist", "Launch checklist and rep briefing"],
];

function ProductsView() {
  const [mode, setMode] = useState("list");
  const list = useResource("/onboarding/products");
  if (mode === "new") return <OnboardForm onClose={() => setMode("list")}
    onSaved={() => { setMode("list"); list.reload(); }} />;

  const products = list.data?.products || [];
  return (
    <>
      <div className="daybar">
        <h1 className="daybar-title">Products</h1>
        <div className="daybar-right">
          <button className="primary" onClick={() => setMode("new")}>Onboard a product</button>
        </div>
      </div>
      {list.status === "loading" ? <Loading label="Products" /> :
       list.status === "error" ? <ErrorState message={list.error} onRetry={list.reload} /> :
       products.length === 0 ? (
        <EmptyState title="No products in the pipeline"
          copy="When a supplier brings something new, capture it here once. What you enter becomes the SKU record, the pricing check and the brief for market research." />
      ) : (
        <section className="pane">
          <SectionHead title="In the pipeline" note={`${products.length} on file`} />
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Product</th><th>Supplier</th><th>Category</th><th className="num">Cost</th>
              <th className="num">Trade</th><th className="num">Margin</th><th>ETR</th><th>Stage</th></tr></thead>
            <tbody>{products.map((p) => (
              <tr key={p.id}>
                <td className="td-name">{p.name}{p.variant ? ` · ${p.variant}` : ""}</td>
                <td className="dim">{p.supplier}</td>
                <td className="dim">{p.category || "—"}</td>
                <td className="num mono">{money(p.supplierCost)}</td>
                <td className="num mono">{money(p.tradePrice)}</td>
                <td className={"num mono " + (p.distributorMarginPct == null ? "dim"
                  : p.distributorMarginPct < T.minMarginPct ? "bad" : "good")}>
                  {p.distributorMarginPct == null ? "—" : p.distributorMarginPct + "%"}</td>
                <td>{p.etrReady ? <span className="pill pill--on">Ready</span>
                  : <span className="pill pill--draft">Held</span>}</td>
                <td className="dim">{p.stage}</td>
              </tr>))}</tbody></table></div>
        </section>
      )}
    </>
  );
}

function OnboardForm({ onClose, onSaved }) {
  const settings = useResource("/settings");
  const lists = settings.data?.lists || {};
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    productName: "", supplier: "", category: "", variant: "", packSize: "", unitsPerCase: "",
    barcode: "", shelfLife: "", storage: "", sampleAvailable: "yes",
    cost: "", tradePrice: "", chainPrice: "", rrp: "", moq: "", leadTime: "",
    paymentTerms: "", vat: "", channels: [], chains: [], territories: [],
    competitor: "", competitorPrice: "", expectedVolume: "",
    kebs: "pending", kraCode: "", launchDate: "", firstOrder: "", priority: "Standard",
    notes: "", research: ["pricing", "competitors", "stores", "checklist"], owner: "",
  });
  const [send, setSend] = useState({ status: "idle" });

  useEffect(() => {
    if (!settings.data) return;
    setF((c) => ({ ...c,
      category: c.category || lists.categories?.[0] || "",
      storage: c.storage || lists.storage?.[0] || "",
      paymentTerms: c.paymentTerms || lists.paymentTerms?.[0] || "",
      vat: c.vat || lists.vatTreatments?.[0] || "",
      owner: c.owner || lists.owners?.[0] || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleList = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const num = (v) => (v === "" || v == null ? null : Number(v));

  const margin = useMemo(() => {
    const c = num(f.cost), t = num(f.tradePrice);
    return !c || !t || t <= 0 ? null : Math.round(((t - c) / t) * 1000) / 10;
  }, [f.cost, f.tradePrice]);
  const retailMargin = useMemo(() => {
    const t = num(f.tradePrice), r = num(f.rrp);
    return !t || !r || r <= 0 ? null : Math.round(((r - t) / r) * 1000) / 10;
  }, [f.tradePrice, f.rrp]);

  const missing = [];
  if (!f.productName.trim()) missing.push("product name");
  if (!f.supplier.trim()) missing.push("supplier");
  if (!f.cost) missing.push("supplier cost");
  if (!f.tradePrice) missing.push("price to independents");
  if (!f.channels.length) missing.push("at least one channel");
  const ready = missing.length === 0;

  const submit = async () => {
    setSend({ status: "sending" });
    try {
      const r = await apiSend("/onboarding/products", {
        submittedBy: f.owner,
        product: { name: f.productName.trim(), variant: f.variant.trim(), supplier: f.supplier.trim(),
          category: f.category, packSize: f.packSize.trim(), unitsPerCase: num(f.unitsPerCase),
          barcode: f.barcode.trim(), shelfLifeMonths: num(f.shelfLife), storage: f.storage,
          sampleAvailable: f.sampleAvailable === "yes" },
        commercials: { supplierCost: num(f.cost), tradePrice: num(f.tradePrice), chainPrice: num(f.chainPrice),
          recommendedRetail: num(f.rrp), distributorMarginPct: margin, retailerMarginPct: retailMargin,
          moqCases: num(f.moq), leadTimeDays: num(f.leadTime), paymentTerms: f.paymentTerms, vatTreatment: f.vat },
        market: { channels: f.channels, targetChains: f.chains, territories: f.territories,
          knownCompetitor: f.competitor.trim(), competitorShelfPrice: num(f.competitorPrice),
          expectedMonthlyUnits: num(f.expectedVolume) },
        compliance: { kebsStandardisationMark: f.kebs, kraItemClassification: f.kraCode.trim(),
          etrReady: Boolean(f.kraCode.trim()) },
        launch: { targetDate: f.launchDate, firstOrderCases: num(f.firstOrder), priority: f.priority, notes: f.notes.trim() },
        researchPack: f.research,
      });
      setSend({ status: "sent", reference: r.reference });
    } catch (e) { setSend({ status: "failed", message: e.message }); }
  };

  if (send.status === "sent") return (
    <div className="onb onb--done"><div className="done">
      <div className="eyebrow">Saved</div>
      <h2 className="done-title">{f.productName} is in the pipeline</h2>
      <p className="done-copy">
        Reference {send.reference}. {f.kraCode.trim()
          ? "The KRA classification is on the record, so the ETR line is ready."
          : "No KRA classification was given, so the ETR line stays held until one is added."}
      </p>
      <button className="primary" onClick={onSaved}>Back to products</button>
    </div></div>
  );

  const steps = ["Product", "Commercials", "Where it sells", "Compliance & launch", "Review"];

  return (
    <div className="onb">
      <ol className="stepper">{steps.map((s, i) => (
        <li key={s}><button className={"step " + (i === step ? "step--on" : i < step ? "step--done" : "")}
          onClick={() => setStep(i)}>
          <span className="mono step-n">{String(i + 1).padStart(2, "0")}</span><span>{s}</span></button></li>))}
      </ol>

      <div className="onb-body">
        <div className="form">
          {step === 0 && (<>
            <SectionHead title="What are we bringing in?" note="This becomes the SKU record" />
            <div className="grid2">
              <Field label="Product name" hint="As it will read on the shelf edge">
                <input value={f.productName} onChange={set("productName")} /></Field>
              <Field label="Supplier"><input value={f.supplier} onChange={set("supplier")} list="suppliers" />
                <datalist id="suppliers">{(lists.suppliers || []).map((s) => <option key={s} value={s} />)}</datalist></Field>
              <Field label="Category"><select value={f.category} onChange={set("category")}>
                {(lists.categories || []).map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Variant" hint="Flavour, scent or format"><input value={f.variant} onChange={set("variant")} /></Field>
              <Field label="Pack size"><input value={f.packSize} onChange={set("packSize")} placeholder="100 g" /></Field>
              <Field label="Units per case"><input value={f.unitsPerCase} onChange={set("unitsPerCase")} inputMode="numeric" /></Field>
              <Field label="Barcode (EAN)"><input value={f.barcode} onChange={set("barcode")} inputMode="numeric" /></Field>
              <Field label="Shelf life" hint="Months from production"><input value={f.shelfLife} onChange={set("shelfLife")} inputMode="numeric" /></Field>
              <Field label="Storage"><select value={f.storage} onChange={set("storage")}>
                {(lists.storage || []).map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Samples in hand?"><select value={f.sampleAvailable} onChange={set("sampleAvailable")}>
                <option value="yes">Yes, samples received</option><option value="no">No, still to request</option></select></Field>
            </div></>)}

          {step === 1 && (<>
            <SectionHead title="The numbers" note="Margins calculate as you type" />
            <div className="grid2">
              <Field label="Supplier cost per unit" hint={`${CONFIG.currency}, excluding VAT`}>
                <input value={f.cost} onChange={set("cost")} inputMode="decimal" /></Field>
              <Field label="Price to independents"><input value={f.tradePrice} onChange={set("tradePrice")} inputMode="decimal" /></Field>
              <Field label="Price to chains" hint="Usually below trade"><input value={f.chainPrice} onChange={set("chainPrice")} inputMode="decimal" /></Field>
              <Field label="Recommended retail"><input value={f.rrp} onChange={set("rrp")} inputMode="decimal" /></Field>
              <Field label="Minimum order" hint="Cases"><input value={f.moq} onChange={set("moq")} inputMode="numeric" /></Field>
              <Field label="Lead time" hint="Days"><input value={f.leadTime} onChange={set("leadTime")} inputMode="numeric" /></Field>
              <Field label="Payment terms"><select value={f.paymentTerms} onChange={set("paymentTerms")}>
                {(lists.paymentTerms || []).map((p) => <option key={p}>{p}</option>)}</select></Field>
              <Field label="VAT treatment" hint="Drives the ETR line in EfiSales">
                <select value={f.vat} onChange={set("vat")}>
                  {(lists.vatTreatments || []).map((p) => <option key={p}>{p}</option>)}</select></Field>
            </div>
            <div className="calc">
              <div className="calc-cell"><span className="rail-label">G2M margin</span>
                <span className={"calc-num mono " + (margin == null ? "dim" : margin < T.minMarginPct ? "bad" : "good")}>
                  {margin == null ? "—" : margin + "%"}</span></div>
              <div className="calc-cell"><span className="rail-label">Retailer margin</span>
                <span className={"calc-num mono " + (retailMargin == null ? "dim" : retailMargin < 20 ? "warn" : "good")}>
                  {retailMargin == null ? "—" : retailMargin + "%"}</span></div>
              <div className="calc-cell calc-cell--wide"><span className="rail-label">Read</span>
                <span className="calc-note">{margin == null
                  ? `Enter a cost and a trade price to see whether this clears the ${T.minMarginPct}% floor.`
                  : margin < T.minMarginPct
                  ? `Below the ${T.minMarginPct}% floor. Renegotiate cost or lift the trade price before this goes further.`
                  : `Clears the ${T.minMarginPct}% floor. Fine to proceed.`}</span></div>
            </div></>)}

          {step === 2 && (<>
            <SectionHead title="Where it sells" note="Drawn from your lists in Setup" />
            <Field label="Channels"><Chips options={lists.channels || []} value={f.channels}
              onToggle={(v) => toggleList("channels", v)} /></Field>
            <Field label="Target chains"><Chips options={lists.chains || []} value={f.chains}
              onToggle={(v) => toggleList("chains", v)} /></Field>
            <Field label="Territories" hint="Routes that get the launch first">
              <Chips options={lists.territories || []} value={f.territories}
                onToggle={(v) => toggleList("territories", v)} /></Field>
            <div className="grid2">
              <Field label="Closest competitor"><input value={f.competitor} onChange={set("competitor")} /></Field>
              <Field label="Their shelf price"><input value={f.competitorPrice} onChange={set("competitorPrice")} inputMode="decimal" /></Field>
              <Field label="Expected monthly units" hint="Best guess is fine">
                <input value={f.expectedVolume} onChange={set("expectedVolume")} inputMode="numeric" /></Field>
            </div></>)}

          {step === 3 && (<>
            <SectionHead title="Compliance and launch" note="Incomplete compliance holds the launch" />
            <div className="grid2">
              <Field label="KEBS standardisation mark"><select value={f.kebs} onChange={set("kebs")}>
                <option value="held">Held — certificate on file</option><option value="pending">Applied for</option>
                <option value="none">Not started</option><option value="na">Not applicable</option></select></Field>
              <Field label="KRA item classification" hint="Needed before EfiSales can raise an ETR">
                <input value={f.kraCode} onChange={set("kraCode")} placeholder="0813.40.00" /></Field>
              <Field label="Target launch date"><input type="date" value={f.launchDate} onChange={set("launchDate")} /></Field>
              <Field label="First order" hint="Cases"><input value={f.firstOrder} onChange={set("firstOrder")} inputMode="numeric" /></Field>
              <Field label="Priority"><select value={f.priority} onChange={set("priority")}>
                <option>Standard</option><option>Fast track</option><option>Exploratory</option></select></Field>
              <Field label="Raised by"><select value={f.owner} onChange={set("owner")}>
                {(lists.owners || []).map((o) => <option key={o}>{o}</option>)}</select></Field>
            </div>
            <Field label="Anything the research should know">
              <textarea rows={3} value={f.notes} onChange={set("notes")} /></Field>
            <Field label="Research to cover" hint="Recorded with the product for whoever picks it up">
              <div className="checks">{RESEARCH.map(([k, l]) => (
                <label key={k} className={"check " + (f.research.includes(k) ? "check--on" : "")}>
                  <input type="checkbox" checked={f.research.includes(k)} onChange={() => toggleList("research", k)} />
                  <span>{l}</span></label>))}</div></Field></>)}

          {step === 4 && (<>
            <SectionHead title="Review and save" />
            <dl className="dl summary">
              <div><dt>Product</dt><dd>{[f.productName, f.variant, f.packSize].filter(Boolean).join(" · ") || "—"}</dd></div>
              <div><dt>Supplier</dt><dd>{f.supplier || "—"}</dd></div>
              <div><dt>Cost → trade</dt><dd>{f.cost && f.tradePrice
                ? `${money(Number(f.cost))} → ${money(Number(f.tradePrice))}` : "—"}</dd></div>
              <div><dt>Margin</dt><dd>{margin == null ? "—" : `${margin}% G2M`}</dd></div>
              <div><dt>Channels</dt><dd>{f.channels.join(", ") || "—"}</dd></div>
              <div><dt>KRA classification</dt><dd>{f.kraCode || "—"}</dd></div>
            </dl>
            {!ready && <div className="note note--warn">Still needed: {missing.join(", ")}.</div>}
            {send.status === "failed" && (
              <div className="note note--bad">Not saved — {send.message}. Nothing was written, so try again.</div>)}
          </>)}
        </div>

        <div className="onb-side">
          <div className="eyebrow">Draft</div>
          <div className="draft-name">{f.productName || "Untitled product"}</div>
          <div className="draft-sub mono">{f.supplier || "no supplier yet"} · {f.category}</div>
          <dl className="dl dl--tight">
            <div><dt>Cost</dt><dd className="mono">{f.cost ? money(Number(f.cost)) : "—"}</dd></div>
            <div><dt>Trade</dt><dd className="mono">{f.tradePrice ? money(Number(f.tradePrice)) : "—"}</dd></div>
            <div><dt>Margin</dt><dd className={"mono " + (margin == null ? "dim" : margin < T.minMarginPct ? "bad" : "good")}>
              {margin == null ? "—" : margin + "%"}</dd></div>
            <div><dt>Channels</dt><dd>{f.channels.length || "—"}</dd></div>
          </dl>
          <div className="side-actions">
            {step < 4
              ? <button className="primary" onClick={() => setStep(step + 1)}>Continue</button>
              : <button className="primary" disabled={!ready || send.status === "sending"} onClick={submit}>
                  {send.status === "sending" ? "Saving…" : "Save product"}</button>}
            {step > 0 ? <button className="ghostbtn" onClick={() => setStep(step - 1)}>Back</button>
              : <button className="ghostbtn" onClick={onClose}>Cancel</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Shell

   Two separate apps behind one build, chosen by the address:

     /          the operations console — planning, monitoring, setup
     /field     the field app — what a rep or merchandiser signs in to

   They are kept apart on purpose. A merchandiser opening the field
   address gets their own stops and nothing else: no company totals,
   no other people's routes, no way to reach the console.
   ============================================================ */

const FIELD_PATH = "/field";
const isFieldUrl = () =>
  typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === FIELD_PATH;

export default function App() {
  const [field, setField] = useState(isFieldUrl);

  // Keep up with the back and forward buttons.
  useEffect(() => {
    const onPop = () => setField(isFieldUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return field ? <FieldShell /> : <OpsShell />;
}

/* ---------------- operations console ---------------- */

function OpsShell() {
  const [tab, setTab] = useState("sales");
  const [pick, setPick] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [clock, setClock] = useState(() => nairobi());
  const [date, setDate] = useState(() => nairobi().date);
  useSettings();

  useEffect(() => {
    const id = setInterval(() => setClock(nairobi()), 20000);
    return () => clearInterval(id);
  }, []);

  const TABS = [["sales", "Sales team"], ["merchandising", "Merchandising"],
    ["plan", "Plan the day"], ["products", "Products"], ["setup", "Setup"]];

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="top">
        <div className="brand"><span className="mark">G2M</span>
          <span className="brand-sub">Operations</span></div>
        <nav className="tabs">{TABS.map(([k, l]) => (
          <button key={k} className={"tab " + (tab === k ? "tab--on" : "")}
            onClick={() => { setTab(k); setPick(null); }} aria-current={tab === k}>{l}</button>))}
        </nav>
        <div className="topright">
          <span className="clock mono">{clock.time} EAT</span>
        </div>
      </header>

      <main className="main">
        {tab === "setup" ? <SetupView />
          : tab === "plan" ? <PlannerView today={clock.date} />
          : tab === "products" ? <ProductsView />
          : <FieldView key={tab} team={tab} date={date} setDate={setDate} pick={pick}
              setPick={setPick} nowMin={clock.minutes} onOpenPhoto={setPhoto} />}
      </main>

      <Lightbox photo={photo} onClose={() => setPhoto(null)} />
    </div>
  );
}

/* ---------------- field app ---------------- */

const SESSION_KEY = "g2m.field.person";

/** Field staff stay signed in between shifts; they should not retype a
 *  phone number every morning on a phone keyboard. */
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.id ? p : null;
  } catch { return null; }
}
function saveSession(person) {
  try {
    if (person) localStorage.setItem(SESSION_KEY, JSON.stringify(person));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private browsing — they sign in each time */ }
}

function FieldShell() {
  const [person, setPerson] = useState(loadSession);
  const [clock, setClock] = useState(() => nairobi());
  useSettings();

  useEffect(() => {
    const id = setInterval(() => setClock(nairobi()), 20000);
    return () => clearInterval(id);
  }, []);

  const signIn = (p) => { saveSession(p); setPerson(p); };
  const signOut = () => { saveSession(null); setPerson(null); };

  return (
    <div className="app app--field">
      <style>{CSS}</style>
      <header className="top top--field">
        <div className="brand"><span className="mark">G2M</span>
          <span className="brand-sub">Field</span></div>
        <div className="topright">
          {person && (
            <>
              <span className="whoami">{person.name}</span>
              <button className="signout" onClick={signOut}>Sign out</button>
            </>
          )}
          <span className="clock mono">{clock.time}</span>
        </div>
      </header>
      <main className="main main--field">
        {person
          ? <MyDay person={person} today={clock.date} />
          : <SignIn onIn={signIn} />}
      </main>
    </div>
  );
}

/* ============================================================
   Styles
   ============================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

.app {
  --ink: #14181c; --ink2: #4a535c; --dim: #7b858f;
  --paper: #e8e9e3; --card: #fbfbf8; --line: #d2d4ca; --line2: #e2e3db;
  --green: #1a6b4c; --ochre: #a8761a; --stamp: #9c1b32; --slate: #26547c;
  background: var(--paper); color: var(--ink);
  font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 13px;
  min-height: 100vh; -webkit-font-smoothing: antialiased;
}
.app *, .app *::before, .app *::after { box-sizing: border-box; }
.app button { font: inherit; cursor: pointer; }
.app button:disabled { cursor: not-allowed; opacity: .45; }
.app fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.app fieldset:disabled { opacity: .45; }
.mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.dim { color: var(--dim); } .good { color: var(--green); }
.warn { color: var(--ochre); } .bad { color: var(--stamp); }
.num { text-align: right; } .grow { flex: 1; }

.top { display: flex; align-items: center; gap: 20px; padding: 0 20px; height: 54px;
  background: var(--ink); color: #eceee8; position: sticky; top: 0; z-index: 20; }
.brand { display: flex; align-items: baseline; gap: 10px; }
.mark { font-family: Archivo, sans-serif; font-weight: 700; font-size: 19px; letter-spacing: -0.03em; }
.brand-sub { font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: #8b959e; }
.tabs { display: flex; gap: 2px; margin-left: auto; }
.tab { background: none; border: 0; color: #98a2ab; padding: 7px 12px; border-radius: 3px; }
.tab:hover { color: #eceee8; }
.tab--on { background: #262d34; color: #fff; }
.topright { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.tabs ~ .topright { margin-left: 0; }
.clock { font-size: 11px; color: #98a2ab; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
.seg-btn { background: var(--card); border: 0; padding: 5px 11px; font-size: 11.5px; color: var(--ink2); }
.seg-btn--on { background: var(--ink); color: #fff; }
.seg--dark { border-color: #3a434b; }
.seg--dark .seg-btn { background: #1d2329; color: #98a2ab; }
.seg--dark .seg-btn--on { background: #3a434b; color: #fff; }

.main { padding: 18px 20px 40px; max-width: 1560px; margin: 0 auto; }
.main--field { max-width: 560px; padding: 14px 14px 60px; }

.eyebrow { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.17em; color: var(--dim); font-weight: 600; }
.eyebrow--mt { display: block; margin: 20px 0 8px; }
.sechead { display: flex; align-items: baseline; gap: 12px; padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--line); }
.sechead h2 { font-family: Archivo, sans-serif; font-size: 15px; font-weight: 600; letter-spacing: -0.015em; margin: 0; }
.sechead-note { font-size: 11px; color: var(--dim); margin-left: auto; text-align: right; max-width: 46%; }

.daybar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.daybar-title { font-family: Archivo, sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
.daybar-right { display: flex; align-items: center; gap: 12px; margin-left: auto; flex-wrap: wrap; }
.datepick { display: flex; align-items: center; gap: 7px; }
.datepick input { width: auto; padding: 5px 8px; font-size: 12px; border: 1px solid var(--line);
  background: var(--card); border-radius: 2px; font-family: 'IBM Plex Mono', monospace; }
.daytag { font-size: 11px; font-weight: 600; color: var(--slate); }
.livestate { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--dim); }
.livestate--on { color: var(--green); font-weight: 600; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }
.banner { background: #f6efe0; border: 1px solid #e2d3ae; border-left: 2px solid var(--ochre);
  padding: 9px 13px; font-size: 12px; margin-bottom: 14px; }
.linkbtn { background: none; border: 0; color: var(--slate); text-decoration: underline; padding: 0 0 0 10px; font-size: 12px; }

.rail { display: grid; grid-template-columns: repeat(6, 1fr); background: var(--card); border: 1px solid var(--line); margin-bottom: 16px; }
.rail-cell { padding: 13px 16px; border-right: 1px solid var(--line2); }
.rail-cell:last-child { border-right: 0; }
.rail-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--dim); font-weight: 600; margin-bottom: 6px; }
.rail-value { font-family: 'IBM Plex Mono', monospace; font-size: 21px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.1; }
.rail-sub { font-size: 11px; color: var(--dim); margin-top: 3px; }

.split { display: grid; grid-template-columns: 1fr 268px; gap: 16px; }
.split--btm { grid-template-columns: 1fr 340px; }
.split > .pane, .split > .detail { margin-bottom: 0; }
.split { margin-bottom: 16px; }
.pane { background: var(--card); border: 1px solid var(--line); padding: 16px; min-width: 0; margin-bottom: 16px; }
.state { text-align: center; padding: 44px 24px; }
.state-title { font-family: Archivo, sans-serif; font-size: 17px; font-weight: 600; letter-spacing: -0.02em; margin: 10px 0 8px; }
.state-copy { font-size: 12.5px; line-height: 1.6; color: var(--ink2); max-width: 480px; margin: 0 auto 18px; }
.inline-empty { font-size: 12px; color: var(--dim); line-height: 1.6; margin: 4px 0; max-width: 70ch; }
.hint-inline { font-size: 11px; color: var(--dim); }
.skel-row { display: flex; gap: 14px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line2); }
.skel { background-color: #e0e1da; height: 12px; border-radius: 2px; animation: pulse 1.4s ease-in-out infinite; }
.skel--name { width: 180px; flex: none; } .skel--track { flex: 1; height: 16px; }
@keyframes pulse { 0%,100% { opacity: .5 } 50% { opacity: .95 } }

.strip-head { display: flex; margin-bottom: 2px; }
.strip-gutter { width: 200px; flex: none; padding-right: 14px; display: flex; align-items: center; gap: 8px; }
.strip-gutter--head { align-items: flex-end; padding-bottom: 4px; }
.strip-track { flex: 1; position: relative; height: 34px; min-width: 0; }
.strip-track--head { height: 18px; }
.scale-tick { position: absolute; top: 0; transform: translateX(-50%); }
.scale-tick span { font-size: 9.5px; color: var(--dim); }
.strip-row { display: flex; align-items: center; border-top: 1px solid var(--line2); }
.strip-row:last-of-type { border-bottom: 1px solid var(--line2); }
.who { display: flex; flex-direction: column; min-width: 0; }
.who-name { font-weight: 600; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who-route { font-size: 10.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who-cov { margin-left: auto; font-size: 11.5px; white-space: nowrap; }
.slash { color: var(--dim); margin: 0 1px; }
.track-base { position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--line); transform: translateY(-50%); }
.gridline { position: absolute; top: 4px; bottom: 4px; width: 1px; background: var(--line2); }
.nowline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--slate); opacity: .55; }
.ghost { position: absolute; top: 50%; width: 7px; height: 7px; transform: translate(-50%,-50%); border: 1px solid var(--line); }
.missed { position: absolute; top: 50%; width: 9px; height: 9px; transform: translate(-50%,-50%) rotate(45deg);
  border: 1.5px solid var(--stamp); background: var(--card); }
.gap { position: absolute; top: 50%; height: 2px; transform: translateY(-50%); opacity: .5;
  background: repeating-linear-gradient(90deg, var(--stamp) 0 3px, transparent 3px 6px); }
.gap--open { opacity: .85; }
.pin { position: absolute; top: 50%; width: 11px; height: 11px; padding: 0; transform: translate(-50%,-50%);
  border: 1px solid var(--ink); border-radius: 2px; background: var(--ink); }
.pin:hover { transform: translate(-50%,-50%) scale(1.35); z-index: 3; }
.pin--order { background: var(--green); border-color: var(--green); }
.pin--nosale { background: var(--card); border-color: var(--ink2); }
.pin--credit { background: var(--slate); border-color: var(--slate); }
.pin--gps { box-shadow: 0 0 0 3px rgba(156,27,50,.28); }
.pin--sel { box-shadow: 0 0 0 3px rgba(38,84,124,.4); z-index: 4; }
.bar { position: absolute; top: 50%; height: 13px; padding: 0; transform: translateY(-50%); border: 1px solid transparent; border-radius: 2px; }
.bar--complete { background: var(--green); } .bar--issues { background: var(--ochre); }
.bar--short { background: var(--card); border-color: var(--stamp);
  background-image: repeating-linear-gradient(45deg, rgba(156,27,50,.35) 0 2px, transparent 2px 4px); }
.bar--open { border-right: 2px dashed var(--slate); }
.bar:hover { filter: brightness(1.15); z-index: 3; }
.bar--sel { box-shadow: 0 0 0 2px rgba(38,84,124,.5); z-index: 4; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--line2); font-size: 10.5px; color: var(--ink2); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend-note { color: var(--dim); font-style: italic; }
.k { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.k--wide { width: 18px; height: 9px; }
.k--order, .k--ok { background: var(--green); }
.k--nosale { background: var(--card); border: 1px solid var(--ink2); }
.k--credit { background: var(--slate); }
.k--ghost { background: transparent; border: 1px solid var(--line); width: 8px; height: 8px; }
.k--missed { border: 1.5px solid var(--stamp); background: var(--card); transform: rotate(45deg); }
.k--fix { background: var(--ochre); }
.k--short { border: 1px solid var(--stamp); background-image: repeating-linear-gradient(45deg, rgba(156,27,50,.35) 0 2px, transparent 2px 4px); }

.detail { background: var(--card); border: 1px solid var(--line); padding: 16px; align-self: start; }
.detail--empty { color: var(--dim); }
.empty-copy { font-size: 12px; line-height: 1.55; margin: 10px 0 0; }
.detail-top { display: flex; align-items: center; }
.x { background: none; border: 0; font-size: 18px; line-height: 1; color: var(--dim); padding: 0 4px; margin-left: auto; }
.x:hover { color: var(--ink); }
.detail-store { font-family: Archivo, sans-serif; font-size: 16px; font-weight: 600; letter-spacing: -0.02em; margin: 10px 0 2px; }
.detail-meta { font-size: 10.5px; color: var(--dim); }
.dl { margin: 16px 0 0; }
.dl > div { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line2); font-size: 12px; }
.dl dt { color: var(--dim); margin: 0; }
.dl dd { margin: 0; text-align: right; font-weight: 500; }
.dl--tight > div { padding: 5px 0; }
.summary { margin-bottom: 18px; }
.live-tag { color: var(--slate); font-size: 10px; margin-left: 6px; text-transform: uppercase; letter-spacing: .1em; }
.fieldnote { font-size: 12px; line-height: 1.55; color: var(--ink2); background: #f3f3ee; padding: 9px 11px; margin: 6px 0 0; }

.shelf { display: flex; gap: 2px; align-items: flex-end; height: 34px; background: #f1f1ec;
  border: 1px solid var(--line2); padding: 4px; overflow: hidden; }
.shelf--empty { align-items: center; justify-content: center; font-size: 10px; color: var(--dim); }
.facing { flex: 1 1 0; min-width: 3px; border-radius: 1px 1px 0 0; }
.facing--ours { background: var(--ochre); height: 100%; }
.facing--comp { background: #c9cbc2; height: 78%; }

.thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.thumb { border: 1px solid var(--line2); padding: 0; background: #fff; display: block; overflow: hidden; }
.thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.thumb-label { display: block; font-size: 9px; padding: 3px 4px; color: var(--dim); text-align: left;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.wall-item { border: 1px solid var(--line2); background: #fff; padding: 0; text-align: left; overflow: hidden; }
.wall-item img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }
.wall-meta { display: block; padding: 7px 9px; }
.wall-label { display: block; font-size: 11.5px; font-weight: 600; }
.wall-sub { display: block; font-size: 9.5px; color: var(--dim); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lightbox { position: fixed; inset: 0; background: rgba(12,14,16,.92); z-index: 60;
  display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 24px; }
.lightbox img { max-width: 100%; max-height: 82vh; object-fit: contain; }
.lightbox-bar { color: #cfd4d8; font-size: 11px; margin-top: 12px; }
.lightbox-bar .linkbtn { color: #8fb4d6; }

.tbl-wrap { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.13em;
  color: var(--dim); font-weight: 600; padding: 0 10px 8px 0; border-bottom: 1px solid var(--line); white-space: nowrap; }
.tbl th.num { text-align: right; }
.tbl td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--line2); white-space: nowrap; }
.tbl tr:last-child td { border-bottom: 0; }
.td-name { font-weight: 600; }
.meter { display: inline-flex; align-items: center; gap: 7px; justify-content: flex-end; }
.meter-bar { width: 52px; height: 5px; background: var(--line2); display: inline-block; }
.meter-fill { display: block; height: 100%; }
.meter-fill.good { background: var(--green); } .meter-fill.warn { background: var(--ochre); } .meter-fill.bad { background: var(--stamp); }
.meter-num { font-size: 11px; width: 30px; text-align: right; }
.pill { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; font-weight: 600; padding: 3px 8px; border-radius: 100px; }
.pill--on { background: #dcece4; color: var(--green); }
.pill--off { background: #eceded; color: var(--dim); }
.pill--draft { background: #f2e8d2; color: var(--ochre); }

.feed { list-style: none; margin: 0; padding: 0; }
.feed-item { padding: 9px 0 9px 12px; border-bottom: 1px solid var(--line2); border-left: 2px solid var(--line); font-size: 12px; line-height: 1.45; }
.feed-item--high { border-left-color: var(--stamp); } .feed-item--med { border-left-color: var(--ochre); }
.feed-who { font-weight: 600; display: block; font-size: 11.5px; }
.feed-text { color: var(--ink2); }
.shelfwall { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.shelfcard { border: 1px solid var(--line2); padding: 10px; }
.shelfcard-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.shelfcard-store { font-weight: 600; font-size: 12px; }
.share { margin-left: auto; font-size: 13px; font-weight: 600; }
.shelfcard-foot { font-size: 10px; color: var(--dim); margin-top: 7px; }
.oos { list-style: none; margin: 0; padding: 0; }
.oos li { padding: 9px 0; border-bottom: 1px solid var(--line2); }
.oos-sku { font-size: 12px; font-weight: 500; }
.oos-sub { font-size: 10.5px; color: var(--dim); margin-top: 2px; }

.planbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; background: var(--card);
  border: 1px solid var(--line); padding: 11px 14px; margin-bottom: 16px; }
.planbar-left { display: flex; align-items: center; gap: 12px; font-size: 12px; }
.planbar-right { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.plangrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; margin-bottom: 16px; }
.plancard { margin-bottom: 0; }
.plancard-head { display: flex; align-items: flex-start; gap: 10px; padding-bottom: 10px;
  margin-bottom: 12px; border-bottom: 1px solid var(--line); }
.plancard-name { font-family: Archivo, sans-serif; font-size: 14px; font-weight: 600; }
.routename { border: 0; border-bottom: 1px dashed var(--line); padding: 3px 0; font-size: 11.5px;
  color: var(--ink2); background: transparent; border-radius: 0; }
.routename:focus { border-bottom-color: var(--slate); }
.stops { list-style: none; margin: 0 0 12px; padding: 0; }
.stop { border-top: 1px solid var(--line2); padding: 10px 0; }
.stop-top { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
.stop-n { font-size: 10px; color: var(--dim); flex: none; }
.stop-time { width: 84px; flex: none; padding: 5px 6px; font-size: 12px; }
.stop-store { flex: 1; min-width: 0; padding: 5px 7px; font-size: 12px; }
.addperson { padding: 4px 0; }
.row-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.listblock { padding: 14px 0; border-top: 1px solid var(--line2); }
.taglist { margin-top: 6px; }
.chip--tag { display: inline-flex; align-items: center; gap: 4px; padding-right: 6px; }
.chip-x { background: none; border: 0; color: var(--dim); font-size: 14px; line-height: 1; padding: 0 2px; }
.chip-x:hover { color: var(--stamp); }

.app--field { background: #f2f2ee; }
.fa { max-width: 560px; margin: 0 auto; }
.fa-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.fa-title { font-family: Archivo, sans-serif; font-size: 22px; font-weight: 600; letter-spacing: -0.03em; margin: 3px 0 0; }
.fa-addr { font-size: 11px; color: var(--dim); margin-top: 4px; }
.fa-count { margin-left: auto; font-size: 24px; font-weight: 500; }
.fa-back { background: none; border: 0; color: var(--slate); padding: 0 0 12px; font-size: 12.5px; }
.fa-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.fa-card { width: 100%; text-align: left; background: var(--card); border: 1px solid var(--line);
  border-left: 3px solid var(--line); padding: 13px 14px; border-radius: 3px; }
.fa-card--open { border-left-color: var(--slate); }
.fa-card--done { border-left-color: var(--green); background: #f5f6f2; }
.fa-card-top { display: flex; align-items: baseline; gap: 10px; }
.fa-time { font-size: 12px; color: var(--dim); flex: none; }
.fa-store { font-weight: 600; font-size: 14px; }
.fa-state { margin-left: auto; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--dim); }
.fa-state--open { color: var(--slate); font-weight: 600; }
.fa-state--done { color: var(--green); font-weight: 600; }
.fa-card-sub { font-size: 10.5px; color: var(--dim); margin-top: 5px; }
.fa-block { background: var(--card); border: 1px solid var(--line); padding: 16px; margin-bottom: 14px; border-radius: 3px; }
.fa-copy { font-size: 12.5px; line-height: 1.6; color: var(--ink2); margin: 0 0 14px; }
.fa-checked { font-size: 11px; color: var(--green); background: #e4efe9; border: 1px solid #c6ded2;
  padding: 8px 11px; margin-bottom: 14px; border-radius: 3px; }
.dutylist { list-style: none; margin: 8px 0 0; padding: 0; }
.dutylist > li { border-top: 1px solid var(--line2); padding: 9px 0; }
.duty { display: flex; align-items: center; gap: 10px; font-size: 13.5px; cursor: pointer; }
.duty input { width: 20px; height: 20px; flex: none; }
.duty-label { flex: 1; }
.duty--done .duty-label { color: var(--dim); text-decoration: line-through; }
.duty-cam { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: var(--ochre); font-weight: 600; }
.shotbtn { margin-top: 8px; width: 100%; background: #f3f3ee; border: 1px dashed var(--line);
  color: var(--ink2); padding: 11px; font-size: 12.5px; border-radius: 3px; text-align: left; }
.shotbtn:hover { border-color: var(--slate); color: var(--slate); }
.fa-thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
.fa-thumb { position: relative; border: 1px solid var(--line2); background: #fff; }
.fa-thumb img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.fa-thumb-tag { position: absolute; left: 0; bottom: 0; right: 0; font-size: 9px; text-transform: uppercase;
  letter-spacing: .1em; background: rgba(255,255,255,.92); padding: 3px 5px; font-weight: 600; }
.retry { position: absolute; inset: 0; background: rgba(156,27,50,.14); border: 0; color: var(--stamp);
  font-size: 11px; font-weight: 600; }
.fa-addshot { border: 1px dashed var(--line); background: transparent; color: var(--dim);
  font-size: 11.5px; aspect-ratio: 1; border-radius: 3px; }
.fa-grid { margin-top: 16px; }
.fa-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.wide { width: 100%; padding: 13px; font-size: 14px; }

.onb { background: var(--card); border: 1px solid var(--line); }
.stepper { display: flex; list-style: none; margin: 0; padding: 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
.stepper li { flex: 1; min-width: 130px; }
.step { width: 100%; display: flex; align-items: center; gap: 9px; background: none; border: 0;
  border-right: 1px solid var(--line2); padding: 13px 14px; text-align: left; color: var(--dim); border-bottom: 2px solid transparent; }
.step:hover { background: #f4f4ef; }
.step-n { font-size: 10px; }
.step--done { color: var(--ink2); } .step--done .step-n { color: var(--green); }
.step--on { color: var(--ink); font-weight: 600; border-bottom-color: var(--ink); }
.onb-body { display: grid; grid-template-columns: 1fr 262px; }
.form { padding: 20px 22px 26px; min-width: 0; }
.onb-side { border-left: 1px solid var(--line); padding: 20px 18px; background: #f3f3ee; }
.draft-name { font-family: Archivo, sans-serif; font-size: 16px; font-weight: 600; margin: 8px 0 2px; line-height: 1.2; }
.draft-sub { font-size: 10.5px; color: var(--dim); }
.side-actions { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 18px; }
.field { display: block; margin-bottom: 14px; }
.field-label { display: block; font-size: 11.5px; font-weight: 600; margin-bottom: 2px; }
.field-hint { display: block; font-size: 10.5px; color: var(--dim); margin-bottom: 5px; }
.fieldlink { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: #f3f3ee; border: 1px solid var(--line2); padding: 10px 12px; }
.fieldlink-url { font-size: 12.5px; color: var(--ink); flex: 1; min-width: 200px; word-break: break-all; }
.fieldlink a.ghostbtn { text-decoration: none; display: inline-block; }
.top--field { position: sticky; top: 0; }
.whoami { font-size: 12px; color: #cfd4d8; }
.signout { background: none; border: 1px solid #3a434b; color: #98a2ab;
  padding: 4px 10px; border-radius: 3px; font-size: 11.5px; }
.signout:hover { color: #fff; border-color: #5a636b; }
.unitwrap { position: relative; display: block; }
.unitwrap input { padding-right: 38px; }
.unit { position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
  font-size: 11px; color: var(--dim); pointer-events: none; }
.app input, .app select, .app textarea { width: 100%; font-family: inherit; font-size: 12.5px; color: var(--ink);
  background: #fff; border: 1px solid var(--line); padding: 8px 9px; border-radius: 2px; }
.app textarea { resize: vertical; line-height: 1.5; }
.app input:focus, .app select:focus, .app textarea:focus, .app button:focus-visible { outline: 2px solid var(--slate); outline-offset: 1px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid var(--line); background: #fff; padding: 5px 11px; border-radius: 100px; font-size: 11.5px; color: var(--ink2); }
.chip--sm { padding: 3px 9px; font-size: 10.5px; }
.chip:hover { border-color: var(--ink2); }
.chip--on { background: var(--ink); border-color: var(--ink); color: #fff; }
.checks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 12px; border: 1px solid var(--line); padding: 8px 10px; background: #fff; cursor: pointer; }
.check input { width: auto; }
.check--on { border-color: var(--ink); background: #f4f4ef; }
.calc { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 1px; background: var(--line2); border: 1px solid var(--line); margin-top: 6px; }
.calc-cell { background: #f3f3ee; padding: 12px 14px; }
.calc-num { display: block; font-size: 22px; font-weight: 500; margin-top: 4px; }
.calc-note { display: block; font-size: 11.5px; line-height: 1.5; margin-top: 5px; color: var(--ink2); }
.primary { background: var(--ink); color: #fff; border: 1px solid var(--ink); padding: 10px 14px; border-radius: 2px; font-weight: 600; font-size: 12.5px; }
.primary.sm { padding: 6px 12px; font-size: 12px; }
.primary:hover:not(:disabled) { background: #000; }
.ghostbtn { background: transparent; border: 1px solid var(--line); color: var(--ink2); padding: 9px 14px; border-radius: 2px; font-size: 12px; }
.ghostbtn.sm { padding: 5px 10px; font-size: 11.5px; }
.ghostbtn:hover:not(:disabled) { border-color: var(--ink2); color: var(--ink); }
.note { margin: 14px 0; padding: 11px 13px; font-size: 12px; line-height: 1.55; border-left: 2px solid var(--line); background: #f3f3ee; }
.note--warn { border-left-color: var(--ochre); } .note--bad { border-left-color: var(--stamp); } .note--good { border-left-color: var(--green); }
.onb--done { padding: 0; }
.done { padding: 56px 28px; text-align: center; max-width: 540px; margin: 0 auto; }
.done-title { font-family: Archivo, sans-serif; font-size: 20px; font-weight: 600; margin: 10px 0; }
.done-copy { font-size: 13px; line-height: 1.65; color: var(--ink2); margin: 0 0 18px; }

@media (max-width: 1180px) {
  .split, .split--btm { grid-template-columns: 1fr; }
  .rail { grid-template-columns: repeat(3, 1fr); }
  .rail-cell:nth-child(3) { border-right: 0; }
  .onb-body { grid-template-columns: 1fr; }
  .onb-side { border-left: 0; border-top: 1px solid var(--line); }
  .grid3 { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 760px) {
  .top { flex-wrap: wrap; height: auto; padding: 10px 14px; gap: 10px; }
  .tabs { margin-left: 0; order: 3; width: 100%; overflow-x: auto; }
  .tab { flex: 1; text-align: center; padding: 8px 6px; font-size: 11.5px; white-space: nowrap; }
  .topright { margin-left: auto; }
  .main { padding: 14px 12px 30px; }
  .rail { grid-template-columns: repeat(2, 1fr); }
  .grid2, .grid3, .checks, .calc { grid-template-columns: 1fr; }
  .daybar-right, .planbar-right { margin-left: 0; width: 100%; }
  .strip-row { flex-direction: column; align-items: stretch; padding: 8px 0; }
  .strip-gutter { width: auto; padding: 0 0 4px; }
  .strip-head .strip-gutter { display: none; }
  .plangrid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .app * { animation: none !important; transition: none !important; } }
`;
