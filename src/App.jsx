import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const GOLDRUSH_API_KEY = import.meta.env.VITE_GOLDRUSH_API_KEY;
const GOLDRUSH_CHAINS_URL = "https://api.covalenthq.com/v1/chains/";
const IPO_PRICE = 135;
const IPO_OPEN = new Date("2026-06-12T09:30:00-04:00").getTime();
const POLL_MS = 5000;
const HL_INFO = "https://api.hyperliquid.xyz/info";
const COIN = "xyz:SPCX";

const GREEN = "#22c55e";
const RED = "#ef4444";
const MUTE = "#8091a7";
const BLUE = "#5b9dff";
const AMBER = "#f0b429";
const BG = "#070b12";
const CARD = "#0d1420";
const PANEL = "#0a101a";
const LINE = "#1a2433";
const TEXT = "#e6edf3";

const fmt = (n, d = 2) =>
  typeof n === "number" && Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
    : "--";

const fmtUSD = (n) => {
  if (!n || !Number.isFinite(n)) return "--";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function fetchGoldRushStatus() {
  if (!GOLDRUSH_API_KEY) {
    return { ok: false, message: "Add VITE_GOLDRUSH_API_KEY to .env", chains: 0 };
  }

  try {
    const res = await fetch(`${GOLDRUSH_CHAINS_URL}?key=${GOLDRUSH_API_KEY}`);
    if (!res.ok) return { ok: false, message: `GoldRush API error ${res.status}`, chains: 0 };

    const json = await res.json();
    return {
      ok: true,
      message: "GoldRush API connected",
      chains: json?.data?.items?.length || 0,
    };
  } catch {
    return { ok: false, message: "GoldRush API unreachable", chains: 0 };
  }
}

async function postInfo(body) {
  const res = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function fetchMetrics() {
  const attempts = [{ type: "metaAndAssetCtxs", dex: "xyz" }, { type: "metaAndAssetCtxs" }];

  for (const body of attempts) {
    try {
      const data = await postInfo(body);
      const [meta, ctxs] = Array.isArray(data) ? data : [data, []];
      const universe = meta?.universe || [];

      for (let i = 0; i < universe.length; i += 1) {
        const name = String(universe[i]?.name || "").toUpperCase();

        if (name === "SPCX" || name.endsWith(":SPCX")) {
          const c = ctxs[i] || {};
          return {
            markPx: Number(c.markPx || c.midPx || 0),
            oraclePx: Number(c.oraclePx || c.markPx || 0),
            funding: Number(c.funding || 0),
            openInterest: Number(c.openInterest || 0),
            prevDayPx: Number(c.prevDayPx || 0),
            dayNtlVlm: Number(c.dayNtlVlm || 0),
          };
        }
      }
    } catch {
      // Try next shape.
    }
  }

  return null;
}

async function fetchCandles() {
  const now = Date.now();

  try {
    const rows = await postInfo({
      type: "candleSnapshot",
      req: {
        coin: COIN,
        interval: "1h",
        startTime: now - 7 * 86400000,
        endTime: now,
      },
    });

    if (!Array.isArray(rows) || rows.length === 0) return null;

    return rows
      .map((r) => ({
        o: Number(r.o),
        h: Number(r.h),
        l: Number(r.l),
        c: Number(r.c),
        v: Number(r.v || 0),
        ts: Number(r.t),
      }))
      .filter((c) => c.c > 0);
  } catch {
    return null;
  }
}

function seedCandles(n = 160) {
  let price = 156;
  const now = Date.now();
  const rows = [];

  for (let i = 0; i < n; i += 1) {
    const move = (Math.random() - 0.5) * price * 0.012;
    const open = price;
    price = Math.max(120, price + move);

    rows.push({
      o: open,
      h: Math.max(open, price) * 1.003,
      l: Math.min(open, price) * 0.997,
      c: price,
      v: 1e6 + Math.random() * 4e6,
      ts: now - (n - i) * 3600000,
    });
  }

  return rows;
}

function buildMarketModel({ markPx, ipoDiv, funding, basisBp, pxCh, oiDelta, goldRushOk }) {
  const convergenceScore = clamp(100 - Math.abs(ipoDiv) * 1.8 - Math.abs(basisBp) / 6, 0, 100);
  const riskScore = clamp(Math.abs(ipoDiv) * 1.4 + Math.abs(funding * 10000) * 2 + Math.abs(basisBp) / 8, 0, 100);

  let sentiment = "Neutral";
  if (funding > 0.0002 && ipoDiv > 10) sentiment = "Crowded long";
  else if (funding < -0.0002 && ipoDiv < -5) sentiment = "Crowded short";
  else if (pxCh > 3 && ipoDiv > 0) sentiment = "Bullish";
  else if (pxCh < -3) sentiment = "Bearish";

  let narrative = "GoldRush analytics layer is monitoring market structure, divergence, funding, and open interest.";

  if (!goldRushOk) {
    narrative = "GoldRush API key is missing or offline. Add VITE_GOLDRUSH_API_KEY to enable the GoldRush analytics layer.";
  } else if (ipoDiv > 20 && funding > 0) {
    narrative = "GoldRush signal: perp pricing is far above IPO reference while longs are paying funding. Crowd positioning looks aggressive.";
  } else if (Math.abs(ipoDiv) < 5 && Math.abs(basisBp) < 25) {
    narrative = "GoldRush signal: SPCX is moving close to IPO alignment. Convergence conditions look healthier.";
  } else if (pxCh < -5 && oiDelta !== null && oiDelta > 8) {
    narrative = "GoldRush signal: price is falling while open interest rises. This can indicate new short pressure or trapped longs.";
  } else if (pxCh > 5 && funding > 0) {
    narrative = "GoldRush signal: momentum is positive, but positive funding means long exposure is paying for the move.";
  }

  const signal =
    convergenceScore > 70
      ? "CONVERGING"
      : riskScore > 65
        ? "ELEVATED RISK"
        : funding > 0
          ? "LONG BIAS"
          : "SHORT BIAS";

  const scenarios = [
    { label: "BULL", price: IPO_PRICE * 1.25, note: "strong demand premium" },
    { label: "BASE", price: IPO_PRICE, note: "IPO reference case" },
    { label: "BEAR", price: IPO_PRICE * 0.82, note: "discount repricing" },
  ].map((s) => ({
    ...s,
    move: markPx > 0 ? ((s.price - markPx) / markPx) * 100 : 0,
  }));

  return { convergenceScore, riskScore, sentiment, narrative, signal, scenarios };
}

function Countdown() {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const diff = Math.max(0, IPO_OPEN - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000) % 24;
  const mins = Math.floor(diff / 60000) % 60;
  const secs = Math.floor(diff / 1000) % 60;

  const unit = (value, label) => (
    <div style={{ textAlign: "center", minWidth: 38 }}>
      <div style={{ fontSize: 23, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {String(value).padStart(2, "0")}
      </div>
      <div style={{ fontSize: 8, color: MUTE, letterSpacing: ".12em" }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 12 }}>
      {unit(days, "DAYS")}
      {unit(hours, "HRS")}
      {unit(mins, "MIN")}
      {unit(secs, "SEC")}
    </div>
  );
}

function MetricTile({ label, value, sub, color = TEXT }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 13px", flex: "1 1 135px", minWidth: 130 }}>
      <div style={{ fontSize: 9, color: MUTE, letterSpacing: ".12em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, whiteSpace: "nowrap" }}>{value}</div>
      {sub ? <div style={{ fontSize: 9, color: color === TEXT ? MUTE : color, marginTop: 3 }}>{sub}</div> : null}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "9px 12px", borderBottom: `1px solid ${LINE}`, fontSize: 10, color: MUTE, fontWeight: 800, letterSpacing: ".12em" }}>
        {title}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function Gauge({ value, color, label }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: MUTE, marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 800 }}>{value.toFixed(0)}/100</span>
      </div>
      <div style={{ height: 8, background: PANEL, borderRadius: 999, border: `1px solid ${LINE}`, overflow: "hidden" }}>
        <div style={{ width: `${clamp(value, 0, 100)}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

function IPOStatusBanner({ goldRush }) {
  const color = goldRush.ok ? GREEN : AMBER;

  return (
    <div style={{ margin: "0 14px 10px", padding: "9px 16px", background: CARD, border: `1px solid ${color}33`, borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: "#10213f", display: "grid", placeItems: "center", color: BLUE, fontWeight: 900, fontSize: 11 }}>
        GR
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>
          GoldRush Powered SPCX IPO Dashboard <span style={{ color: MUTE, fontWeight: 400 }}>- Analytics, signals, risk, and convergence</span>
        </div>
        <div style={{ fontSize: 10, color: MUTE, marginTop: 2 }}>
          {goldRush.ok ? `GoldRush API connected - ${goldRush.chains} indexed chains available` : goldRush.message}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, background: `${color}18`, border: `1px solid ${color}55`, borderRadius: 6, padding: "5px 10px" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: goldRush.ok ? `0 0 8px ${color}` : "none" }} />
        <span style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: ".1em" }}>
          {goldRush.ok ? "GOLDRUSH LIVE" : "GOLDRUSH SETUP"}
        </span>
      </div>
    </div>
  );
}

function InsightPanel({ model, funding, basisBp, oiDelta, goldRush }) {
  const riskColor = model.riskScore > 65 ? RED : model.riskScore > 40 ? AMBER : GREEN;
  const convColor = model.convergenceScore > 70 ? GREEN : model.convergenceScore > 40 ? AMBER : RED;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Panel title="GOLDRUSH AI COMMENTARY">
        <div style={{ fontSize: 13, lineHeight: 1.45, color: TEXT }}>{model.narrative}</div>
        <div style={{ marginTop: 10, display: "inline-flex", padding: "5px 8px", borderRadius: 6, background: `${convColor}18`, border: `1px solid ${convColor}55`, color: convColor, fontSize: 10, fontWeight: 900, letterSpacing: ".1em" }}>
          {model.signal}
        </div>
      </Panel>

      <Panel title="GOLDRUSH API STATUS">
        <div style={{ display: "grid", gap: 7, fontSize: 11 }}>
          <div>Status: <span style={{ color: goldRush.ok ? GREEN : RED, fontWeight: 800 }}>{goldRush.ok ? "CONNECTED" : "OFFLINE"}</span></div>
          <div>Message: <span style={{ color: MUTE }}>{goldRush.message}</span></div>
          <div>Indexed chains: <span style={{ color: BLUE, fontWeight: 800 }}>{goldRush.chains}</span></div>
          <div>Dashboard role: <span style={{ color: TEXT, fontWeight: 800 }}>GoldRush analytics layer</span></div>
        </div>
      </Panel>

      <Panel title="CONVERGENCE ENGINE">
        <div style={{ display: "grid", gap: 12 }}>
          <Gauge value={model.convergenceScore} color={convColor} label="IPO alignment" />
          <Gauge value={model.riskScore} color={riskColor} label="Risk pressure" />
          <div style={{ display: "grid", gap: 6, fontSize: 11, color: MUTE }}>
            <div>Sentiment: <span style={{ color: TEXT, fontWeight: 800 }}>{model.sentiment}</span></div>
            <div>Funding: <span style={{ color: funding >= 0 ? GREEN : RED }}>{(funding * 100).toFixed(4)}%</span></div>
            <div>Basis: <span style={{ color: basisBp >= 0 ? AMBER : RED }}>{basisBp >= 0 ? "+" : ""}{fmt(basisBp, 1)}bp</span></div>
            <div>OI change: <span style={{ color: oiDelta === null ? MUTE : oiDelta >= 0 ? GREEN : RED }}>{oiDelta === null ? "building baseline" : `${oiDelta >= 0 ? "+" : ""}${oiDelta.toFixed(1)}%`}</span></div>
          </div>
        </div>
      </Panel>

      <Panel title="BULL / BASE / BEAR">
        <div style={{ display: "grid", gap: 8 }}>
          {model.scenarios.map((s) => (
            <div key={s.label} style={{ display: "grid", gridTemplateColumns: "48px 1fr auto", gap: 8, alignItems: "center", fontSize: 11 }}>
              <span style={{ color: s.label === "BULL" ? GREEN : s.label === "BEAR" ? RED : BLUE, fontWeight: 900 }}>{s.label}</span>
              <span style={{ color: MUTE }}>{s.note}</span>
              <span style={{ color: s.move >= 0 ? GREEN : RED, fontWeight: 800 }}>
                ${fmt(s.price)} / {s.move >= 0 ? "+" : ""}{s.move.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function CandleChart({ candles, ipo }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || candles.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = rect.width;
    const H = rect.height;
    const pad = { t: 16, r: 66, b: 24, l: 10 };
    const volH = Math.max(52, H * 0.16);
    const chartH = H - pad.t - pad.b - volH;
    const disp = candles.slice(-160);
    const n = disp.length;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const values = disp.flatMap((c) => [c.h, c.l]).concat([ipo]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const extra = range * 0.05;

    const toY = (p) => pad.t + chartH - ((p - (min - extra)) / (range + extra * 2)) * chartH;
    const plotW = W - pad.l - pad.r;
    const step = plotW / n;
    const bodyW = Math.max(1.5, step - 1);
    const toX = (i) => pad.l + (i + 0.5) * step;
    const maxVol = Math.max(...disp.map((c) => c.v), 1);

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.fillStyle = MUTE;
    ctx.font = "10px monospace";
    ctx.textAlign = "left";

    for (let i = 0; i <= 5; i += 1) {
      const y = pad.t + (chartH / 5) * i;
      const price = max + extra - (i / 5) * (range + extra * 2);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(W - pad.r, y);
      ctx.stroke();
      ctx.fillText(fmt(price), W - pad.r + 5, y + 3);
    }

    disp.forEach((c, i) => {
      const x = toX(i);
      const vh = (c.v / maxVol) * volH;
      ctx.fillStyle = c.c >= c.o ? `${GREEN}33` : `${RED}33`;
      ctx.fillRect(x - bodyW / 2, H - pad.b - vh, bodyW, vh);
    });

    disp.forEach((c, i) => {
      const x = toX(i);
      const color = c.c >= c.o ? GREEN : RED;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, toY(c.h));
      ctx.lineTo(x, toY(c.l));
      ctx.stroke();

      const top = Math.min(toY(c.o), toY(c.c));
      const height = Math.max(1, Math.abs(toY(c.c) - toY(c.o)));
      ctx.fillStyle = color;
      ctx.fillRect(x - bodyW / 2, top, bodyW, height);
    });

    const ipoY = toY(ipo);
    ctx.strokeStyle = BLUE;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, ipoY);
    ctx.lineTo(W - pad.r, ipoY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = BLUE;
    ctx.font = "10px monospace";
    ctx.fillText(`IPO $${ipo} - Jun 12`, pad.l + 4, ipoY - 6);

    const last = disp[disp.length - 1];
    const lastY = toY(last.c);
    const lastColor = last.c >= last.o ? GREEN : RED;

    ctx.fillStyle = lastColor;
    ctx.fillRect(W - pad.r, lastY - 9, pad.r, 18);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px monospace";
    ctx.fillText(fmt(last.c), W - pad.r + 5, lastY + 4);
  }, [candles, ipo]);

  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />;
}

export default function App() {
  const [metrics, setMetrics] = useState(null);
  const [candles, setCandles] = useState(seedCandles);
  const [status, setStatus] = useState("loading");
  const [chartLive, setChartLive] = useState(false);
  const [updated, setUpdated] = useState(null);
  const [goldRush, setGoldRush] = useState({ ok: false, message: "Checking GoldRush API...", chains: 0 });
  const oiBaselineRef = useRef(null);

  useEffect(() => {
    fetchGoldRushStatus().then(setGoldRush);
  }, []);

  const pollMetrics = useCallback(async () => {
    const data = await fetchMetrics();

    if (data && data.markPx > 0) {
      if (oiBaselineRef.current === null && data.openInterest > 0) {
        oiBaselineRef.current = { oi: data.openInterest, ts: Date.now() };
      }

      setMetrics(data);
      setStatus("live");
      setUpdated(new Date());
    } else {
      setStatus((prev) => (prev === "live" ? "stale" : "error"));
    }
  }, []);

  const pollCandles = useCallback(async () => {
    const rows = await fetchCandles();

    if (rows && rows.length > 1) {
      setChartLive(true);
      setCandles(rows.slice(-200));
    }
  }, []);

  useEffect(() => {
    pollMetrics();
    const t = setInterval(pollMetrics, POLL_MS);
    return () => clearInterval(t);
  }, [pollMetrics]);

  useEffect(() => {
    pollCandles();
    const t = setInterval(pollCandles, POLL_MS * 2);
    return () => clearInterval(t);
  }, [pollCandles]);

  const data = metrics || {};
  const markPx = data.markPx || candles[candles.length - 1]?.c || 0;
  const oraclePx = data.oraclePx || markPx;
  const funding = data.funding || 0;
  const openInterest = data.openInterest || 0;
  const prevDayPx = data.prevDayPx || 0;
  const volume = data.dayNtlVlm || 0;

  const basisBp = oraclePx > 0 ? ((markPx - oraclePx) / oraclePx) * 10000 : 0;
  const pxCh = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;
  const ipoDiv = markPx > 0 ? ((markPx - IPO_PRICE) / IPO_PRICE) * 100 : 0;
  const oiNotional = openInterest * markPx;

  const oiBaseline = oiBaselineRef.current;
  const oiDelta =
    oiBaseline && oiBaseline.oi > 0 && openInterest > 0
      ? ((openInterest - oiBaseline.oi) / oiBaseline.oi) * 100
      : null;

  const model = useMemo(
    () => buildMarketModel({ markPx, ipoDiv, funding, basisBp, pxCh, oiDelta, goldRushOk: goldRush.ok }),
    [markPx, ipoDiv, funding, basisBp, pxCh, oiDelta, goldRush.ok]
  );

  const statusColor = status === "live" ? GREEN : status === "stale" ? AMBER : RED;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: BG, color: TEXT, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{`*{box-sizing:border-box}body{margin:0;background:${BG}}`}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "12px 22px", borderBottom: `1px solid ${LINE}`, background: CARD }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "#10213f", color: BLUE, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 12 }}>
            GR
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900 }}>
              GoldRush $SPCX <span style={{ color: MUTE, fontWeight: 500 }}>IPO Intelligence Terminal</span>
            </div>
            <div style={{ fontSize: 10, color: MUTE }}>
              GoldRush API analytics layer - {COIN} market feed - risk, sentiment, convergence
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: BLUE, letterSpacing: ".15em", fontWeight: 800 }}>NASDAQ DEBUT</div>
            <div style={{ fontSize: 10, color: MUTE }}>Jun 12, 2026 - 09:30 EDT</div>
          </div>
          <Countdown />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, padding: "12px 14px", flexWrap: "wrap" }}>
        <MetricTile label="GOLDRUSH API" value={goldRush.ok ? "CONNECTED" : "OFFLINE"} sub={goldRush.ok ? `${goldRush.chains} chains indexed` : goldRush.message} color={goldRush.ok ? GREEN : RED} />
        <MetricTile label="MARK PRICE" value={`$${fmt(markPx)}`} sub={`${pxCh >= 0 ? "+" : ""}${pxCh.toFixed(2)}% 24h`} color={pxCh >= 0 ? GREEN : RED} />
        <MetricTile label="IPO TARGET" value={`$${fmt(IPO_PRICE)}`} sub="Nasdaq reference" color={BLUE} />
        <MetricTile label="DIVERGENCE" value={`${ipoDiv >= 0 ? "+" : ""}${fmt(ipoDiv)}%`} sub="perp vs IPO" color={Math.abs(ipoDiv) > 15 ? AMBER : GREEN} />
        <MetricTile label="CONVERGENCE" value={`${model.convergenceScore.toFixed(0)}/100`} sub="GoldRush score" color={model.convergenceScore > 70 ? GREEN : model.convergenceScore > 40 ? AMBER : RED} />
        <MetricTile label="FUNDING" value={`${funding >= 0 ? "+" : ""}${(funding * 100).toFixed(4)}%`} sub={funding >= 0 ? "longs pay shorts" : "shorts pay longs"} color={funding >= 0 ? GREEN : RED} />
        <MetricTile label="OPEN INTEREST" value={fmtUSD(oiNotional)} sub={oiDelta === null ? `${openInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ct` : `${oiDelta >= 0 ? "+" : ""}${oiDelta.toFixed(1)}% session`} color={oiDelta === null ? TEXT : oiDelta >= 0 ? GREEN : RED} />
        <MetricTile label="24H VOLUME" value={fmtUSD(volume)} sub="USD notional" />
      </div>

      <IPOStatusBanner goldRush={goldRush} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 12, padding: "0 14px 14px", flex: 1, minHeight: 0 }}>
        <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 8, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 520 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "10px 16px", borderBottom: `1px solid ${LINE}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: MUTE, letterSpacing: ".1em" }}>GOLDRUSH MARKET PANEL - SPCX</span>
              <span style={{ fontSize: 24, fontWeight: 900, color: pxCh >= 0 ? GREEN : RED }}>${fmt(markPx)}</span>
              <span style={{ fontSize: 12, color: pxCh >= 0 ? GREEN : RED }}>{pxCh >= 0 ? "UP" : "DOWN"} {Math.abs(pxCh).toFixed(2)}% 24h</span>
              <span style={{ fontSize: 12, color: AMBER }}>{ipoDiv >= 0 ? "+" : ""}{fmt(ipoDiv)}% vs IPO</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor, boxShadow: status === "live" ? `0 0 7px ${statusColor}` : "none" }} />
              <span style={{ color: statusColor, fontWeight: 800 }}>{status.toUpperCase()}</span>
              <span style={{ color: MUTE }}>{updated ? `- ${updated.toLocaleTimeString()}` : ""}</span>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            <CandleChart candles={candles} ipo={IPO_PRICE} />
          </div>

          <div style={{ padding: "7px 16px", borderTop: `1px solid ${LINE}`, fontSize: 9, color: MUTE, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>GoldRush analytics layer - {COIN}-USDC - {chartLive ? "live market candles" : "seeded fallback candles"}</span>
            <span>Signal: {model.signal}</span>
          </div>
        </div>

        <InsightPanel model={model} funding={funding} basisBp={basisBp} oiDelta={oiDelta} goldRush={goldRush} />
      </div>
    </div>
  );
}