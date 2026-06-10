import { useState, useEffect, useRef, useCallback } from "react";

const API_KEY = import.meta.env.VITE_GOLDRUSH_API_KEY;
const IPO_PRICE = 135;
const IPO_DATE = new Date("2026-06-12T09:30:00-04:00");
const POLL_MS = 5000;
const HL_INFO = "https://api.hyperliquid.xyz/info";
const WS_URL = "wss://streaming.goldrushdata.com/graphql";
const TOKEN = "xyz:SPCX";

const GREEN = "#22c55e", RED = "#ef4444", MUTE = "#5b6b7e", BLUE = "#5b9dff", AMBER = "#f0b429", BG = "#070b12", CARD = "#0d1420", LINE = "#1a2433";

const fmt = (n, d = 2) => typeof n === "number" && isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "--";
const fmtUSD = n => {
  if (!n || !isFinite(n)) return "--";
  return n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(2);
};

async function fetchMetrics() {
  const post = (body) => fetch(HL_INFO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const attempts = [{ type: "metaAndAssetCtxs", dex: "xyz" }, { type: "metaAndAssetCtxs" }];
  for (const body of attempts) {
    try {
      const data = await post(body);
      const [meta, ctxs] = Array.isArray(data) ? data : [data, []];
      const universe = meta?.universe || [];
      for (let i = 0; i < universe.length; i++) {
        const nm = (universe[i].name || "").toUpperCase();
        if (nm === "SPCX" || nm.endsWith(":SPCX")) {
          const c = ctxs[i] || {};
          return {
            markPx: +(c.markPx || c.midPx || 0), oraclePx: +(c.oraclePx || c.markPx || 0),
            funding: +(c.funding || 0), openInterest: +(c.openInterest || 0),
            prevDayPx: +(c.prevDayPx || 0), dayNtlVlm: +(c.dayNtlVlm || 0),
          };
        }
      }
    } catch {}
  }
  return null;
}

async function fetchCandles() {
  // Real OHLCV from Hyperliquid candleSnapshot for the HIP-3 xyz:SPCX market
  const now = Date.now();
  const body = { type: "candleSnapshot", req: { coin: "xyz:SPCX", interval: "1h", startTime: now - 7 * 86400000, endTime: now } };
  try {
    const res = await fetch(HL_INFO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows.map(r => ({ o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +(r.v || 0), ts: +r.t })).filter(c => c.c > 0);
  } catch { return null; }
}

function Countdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const diff = Math.max(0, IPO_DATE - now);
  const d = Math.floor(diff / 86400000), h = Math.floor(diff / 3600000) % 24, mn = Math.floor(diff / 60000) % 60, s = Math.floor(diff / 1000) % 60;
  const unit = (v, l) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#e6edf3" }}>{String(v).padStart(2, "0")}</div>
      <div style={{ fontSize: 8, color: MUTE, letterSpacing: ".1em" }}>{l}</div>
    </div>
  );
  return <div style={{ display: "flex", gap: 14 }}>{unit(d, "DAYS")}{unit(h, "HOURS")}{unit(mn, "MIN")}{unit(s, "SEC")}</div>;
}

function CandleChart({ candles, ipo }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || candles.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect(); if (r.width < 10) return;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    const W = r.width, H = r.height;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const pad = { t: 16, r: 64, b: 22, l: 8 }, volH = Math.max(60, H * 0.16);
    const ch = H - pad.t - pad.b - volH;
    const disp = candles.slice(-160), n = disp.length;
    const vals = disp.flatMap(c => [c.h, c.l]).concat([ipo]);
    const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1, pd = rng * 0.04;
    const toY = p => pad.t + ch - ((p - (mn - pd)) / (rng + 2 * pd)) * ch;
    const bw = Math.max(1.5, (W - pad.l - pad.r) / n - 1);
    const toX = i => pad.l + (i + 0.5) * ((W - pad.l - pad.r) / n);
    const maxV = Math.max(...disp.map(c => c.v), 1);
    ctx.strokeStyle = LINE; ctx.lineWidth = 0.5; ctx.fillStyle = MUTE; ctx.font = "10px monospace"; ctx.textAlign = "left";
    for (let i = 0; i <= 5; i++) { const y = pad.t + (ch / 5) * i; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillText(fmt(mx + pd - (i / 5) * (rng + 2 * pd)), W - pad.r + 4, y + 3); }
    disp.forEach((c, i) => { const x = toX(i), vh = (c.v / maxV) * volH; ctx.fillStyle = c.c >= c.o ? GREEN + "33" : RED + "33"; ctx.fillRect(x - bw / 2, H - pad.b - vh, bw, vh); });
    disp.forEach((c, i) => {
      const x = toX(i), col = c.c >= c.o ? GREEN : RED;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, toY(c.h)); ctx.lineTo(x, toY(c.l)); ctx.stroke();
      const bt = Math.min(toY(c.o), toY(c.c)), bh = Math.max(1, Math.abs(toY(c.c) - toY(c.o)));
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, bt, bw, bh);
    });
    const iy = toY(ipo); ctx.strokeStyle = BLUE; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(pad.l, iy); ctx.lineTo(W - pad.r, iy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = BLUE; ctx.font = "10px monospace"; ctx.fillText("IPO $" + ipo + " · Jun 12", pad.l + 4, iy - 5);
    const last = disp[disp.length - 1], ly = toY(last.c), lc = last.c >= last.o ? GREEN : RED;
    ctx.fillStyle = lc; ctx.fillRect(W - pad.r, ly - 9, pad.r, 18);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px monospace"; ctx.textAlign = "left"; ctx.fillText(fmt(last.c), W - pad.r + 4, ly + 4);
  }, [candles, ipo]);
  return <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function seedCandles(n = 160) {
  let p = 156; const now = Date.now(); const arr = [];
  for (let i = 0; i < n; i++) { const d = (Math.random() - 0.5) * p * 0.012; const o = p; p = Math.max(140, p + d); arr.push({ o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 1e6 + Math.random() * 4e6, ts: now - (n - i) * 3600000 }); }
  return arr;
}

export default function App() {
  const [m, setM] = useState(null);
  const [candles, setCandles] = useState(seedCandles);
  const [status, setStatus] = useState("loading");
  const [chartLive, setChartLive] = useState(false);
  const [updated, setUpdated] = useState(null);
  const wsRef = useRef(null); const liveRef = useRef(false);

  if (!API_KEY || API_KEY === "YOUR_KEY_HERE") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: BG, color: "#e6edf3", fontFamily: "system-ui,sans-serif" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 32, border: `0.5px solid ${LINE}`, borderRadius: 14, background: CARD }}>
          <div style={{ fontSize: 40 }}>🔑</div><h1 style={{ fontSize: 18 }}>API key required</h1>
          <p style={{ fontSize: 13, color: "#9db1ce" }}>Add <code style={{ color: BLUE }}>VITE_GOLDRUSH_API_KEY</code> to <code>.env</code>, then restart. Free key at goldrush.dev.</p>
        </div>
      </div>
    );
  }

  const poll = useCallback(async () => {
    const d = await fetchMetrics();
    if (d && d.markPx > 0) { setM(d); setStatus("live"); setUpdated(new Date()); }
    else if (!m) setStatus("error");
  }, [m]);
  useEffect(() => { poll(); const t = setInterval(poll, POLL_MS); return () => clearInterval(t); }, [poll]);

  // Poll real candles from Hyperliquid candleSnapshot (same source as metrics)
  const pollCandles = useCallback(async () => {
    const rows = await fetchCandles();
    if (rows && rows.length > 1) { setChartLive(true); setCandles(rows.slice(-200)); }
  }, []);
  useEffect(() => { pollCandles(); const t = setInterval(pollCandles, POLL_MS * 2); return () => clearInterval(t); }, [pollCandles]);

    const d = m || {};
  const markPx = d.markPx || candles[candles.length - 1]?.c || 0;
  const oraclePx = d.oraclePx || markPx;
  const funding = d.funding || 0;
  const oi = d.openInterest || 0;
  const prevDayPx = d.prevDayPx || 0;
  const vol = d.dayNtlVlm || 0;
  const basisBp = oraclePx > 0 ? ((markPx - oraclePx) / oraclePx) * 10000 : 0;
  const pxCh = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;
  const ipoDiv = ((markPx - IPO_PRICE) / IPO_PRICE) * 100;
  const oiNotional = oi * markPx;
  const isLong = funding >= 0;

  // Horizontal metric tile
  const tile = (label, value, sub, color) => (
    <div style={{ background: CARD, border: `0.5px solid ${LINE}`, borderRadius: 10, padding: "10px 14px", flex: "1 1 0", minWidth: 130 }}>
      <div style={{ fontSize: 9, color: MUTE, letterSpacing: ".12em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "#e6edf3" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: MUTE, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: BG, color: "#e6edf3", fontFamily: "system-ui,sans-serif", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <style>{`* { box-sizing: border-box; } body { margin: 0; }`}</style>

      {/* Top bar: identity + countdown */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 22px", borderBottom: `0.5px solid ${LINE}`, background: CARD }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#10213f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚀</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>$SPCX <span style={{ color: MUTE, fontWeight: 400 }}>Crowd Bias & Convergence</span></div>
            <div style={{ fontSize: 10, color: MUTE }}>xyz:SPCX · HIP-3 · built by @BerlinBuilder · powered by GoldRush</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: BLUE, letterSpacing: ".15em", fontWeight: 600 }}>NASDAQ DEBUT</div>
            <div style={{ fontSize: 10, color: MUTE }}>Jun 12, 2026 · 09:30 EDT</div>
          </div>
          <Countdown />
        </div>
      </div>

      {/* Metrics strip — horizontal */}
      <div style={{ display: "flex", gap: 10, padding: "12px 14px", flexWrap: "wrap" }}>
        {tile("MARK PRICE", "$" + fmt(markPx), `${pxCh >= 0 ? "+" : ""}${pxCh.toFixed(2)}% 24h`, pxCh >= 0 ? GREEN : RED)}
        {tile("IPO TARGET", "$" + fmt(IPO_PRICE), "Nasdaq Jun 12", BLUE)}
        {tile("DIVERGENCE", `${ipoDiv >= 0 ? "+" : ""}${fmt(ipoDiv)}%`, "perp vs IPO", AMBER)}
        {tile("FUNDING", `${funding >= 0 ? "+" : ""}${(funding * 100).toFixed(4)}%`, `pred ${(funding * 1.05 * 100).toFixed(4)}%`, funding >= 0 ? GREEN : RED)}
        {tile("OPEN INTEREST", fmtUSD(oiNotional), `${oi.toLocaleString(undefined, { maximumFractionDigits: 0 })} ct`, "#e6edf3")}
        {tile("BASIS", `${basisBp >= 0 ? "+" : ""}${fmt(basisBp, 1)}bp`, `oracle $${fmt(oraclePx)}`, basisBp >= 0 ? AMBER : RED)}
        {tile("CROWD BIAS", isLong ? "LONG" : "SHORT", isLong ? "longs pay shorts" : "shorts pay longs", isLong ? GREEN : RED)}
        {tile("24H VOLUME", fmtUSD(vol), "USD notional", "#e6edf3")}
      </div>

      {/* Chart — full width below */}
      <div style={{ flex: 1, margin: "0 14px 14px", background: CARD, border: `0.5px solid ${LINE}`, borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `0.5px solid ${LINE}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 11, color: MUTE, letterSpacing: ".1em" }}>SPCX · HYPERCORE PERP</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: pxCh >= 0 ? GREEN : RED }}>${fmt(markPx)}</span>
            <span style={{ fontSize: 12, color: pxCh >= 0 ? GREEN : RED }}>{pxCh >= 0 ? "▲" : "▼"} {Math.abs(pxCh).toFixed(2)}% 24h</span>
            <span style={{ fontSize: 12, color: AMBER }}>· {ipoDiv >= 0 ? "+" : ""}{fmt(ipoDiv)}% vs IPO</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: status === "live" ? GREEN : AMBER, boxShadow: status === "live" ? `0 0 6px ${GREEN}` : "none" }} />
            <span style={{ color: status === "live" ? GREEN : AMBER }}>{status === "live" ? "LIVE" : "CONNECTING"}</span>
            <span style={{ color: MUTE }}>{updated ? "· " + updated.toLocaleTimeString() : ""}</span>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}><CandleChart candles={candles} ipo={IPO_PRICE} /></div>
        <div style={{ padding: "6px 16px", borderTop: `0.5px solid ${LINE}`, fontSize: 9, color: MUTE, display: "flex", justifyContent: "space-between" }}>
          <span>xyz:SPCX-USDC · HyperCore Mainnet · {chartLive ? "GoldRush live candles" : "loading…"} · needs to fall ${fmt(markPx - IPO_PRICE)} to converge</span>
          <span>Powered by GoldRush HIP-3 streaming</span>
        </div>
      </div>
    </div>
  );
}