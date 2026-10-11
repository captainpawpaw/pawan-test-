import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  DAY, SCALES, SCALE_LABEL, SCALE_SPAN_DAYS, METRICS,
  adjustScale, periodStart, nextPeriod, periodLabel, flattenMonths,
  metricsFor, bucketize, bucketizeWeightReps, niceTicks, niceRange, compact, parseIso, daysOnTarget,
} from "./progress";

const ink = "#23211D";
const inkFaint = "#706B5E";
const paper = "#EDE8DE";
const raised = "#F5F1E8";
const line = "#D9D2C2";
const grid = "#E4DDCF";
const rust = "#B5551F";
const teal = "#1F6E64";
const plum = "#7A3E62";
const blue = "#3F6FA8"; // reps, beside rust weight (checked for colour-blind separation)
const colorFor = (type) => (type === "cardio" ? teal : type === "food" ? plum : rust);
const mono = "'IBM Plex Mono', monospace";
const condensed = "'Barlow Condensed', sans-serif";

const MIN_SPAN = 7 * DAY;
const MAX_SPAN = 30 * 365 * DAY;
const PLOT_H = 220;
const PAD = { top: 18, right: 12, bottom: 28, left: 44 };
const SEL_KEY = "fitness-tracker:progress-selection";

const fmtNum = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmt = (v, unit) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;

function readSaved() {
  try { return JSON.parse(window.localStorage.getItem(SEL_KEY) || "null"); } catch { return null; }
}
function writeSaved(v) {
  try { window.localStorage.setItem(SEL_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

export default function Progress({ loadAll, version, tagMap, bwOn, targets }) {
  const [months, setMonths] = useState(null);
  const [selection, setSelection] = useState(() => readSaved()); // { kind, value }
  const [metric, setMetric] = useState(null);

  useEffect(() => {
    let live = true;
    loadAll().then((m) => { if (live) setMonths(m); }).catch(() => { if (live) setMonths({}); });
    return () => { live = false; };
  }, [loadAll, version]);

  const rows = useMemo(() => flattenMonths(months || {}), [months]);

  // Choices: exercises and tags that have something logged.
  const { exercises, tags, foodDays } = useMemo(() => {
    const counts = new Map();
    rows.forEach((r) => { if (r.type !== "food") counts.set(r.name, (counts.get(r.name) || 0) + 1); });
    const ex = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const tagCounts = new Map();
    for (const [name, n] of counts) {
      for (const t of tagMap[name]?.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + n);
    }
    const tg = [...tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    return { exercises: ex, tags: tg, foodDays: new Set(rows.filter((r) => r.type === "food").map((r) => r.date)).size };
  }, [rows, tagMap]);

  // Fall back to the most-logged exercise when nothing (valid) is chosen.
  const sel = useMemo(() => {
    if (selection?.kind === "exercise" && exercises.some(([n]) => n === selection.value)) return selection;
    if (selection?.kind === "tag" && tags.some(([t]) => t === selection.value)) return selection;
    if (selection?.kind === "food" && foodDays) return selection;
    if (exercises.length) return { kind: "exercise", value: exercises[0][0] };
    return foodDays ? { kind: "food", value: "all" } : null;
  }, [selection, exercises, tags, foodDays]);

  const selRows = useMemo(() => {
    if (!sel) return [];
    if (sel.kind === "food") return rows.filter((r) => r.type === "food");
    if (sel.kind === "exercise") return rows.filter((r) => r.name === sel.value && r.type !== "food");
    const names = new Set(Object.entries(tagMap).filter(([, v]) => (v?.tags || []).includes(sel.value)).map(([n]) => n));
    return rows.filter((r) => names.has(r.name) && r.type !== "food");
  }, [sel, rows, tagMap]);

  const metricOptions = useMemo(() => metricsFor(selRows), [selRows]);
  const activeMetric = metricOptions.includes(metric) ? metric : metricOptions[0] || null;

  const choose = (kind, value) => {
    const next = { kind, value };
    setSelection(next);
    writeSaved(next);
  };

  if (months === null) return <div style={s.empty}>Loading your log…</div>;
  if (!rows.length) {
    return (
      <div style={s.empty}>
        <strong style={{ color: ink }}>Nothing logged yet.</strong> Log a few sets in the Log tab and your progress will chart here.
      </div>
    );
  }

  const selectValue = sel ? `${sel.kind}:${sel.value}` : "";

  return (
    <div style={s.wrap}>
      <label htmlFor="progress-pick" style={s.label}>Show progress for</label>
      <select
        id="progress-pick"
        value={selectValue}
        onChange={(e) => {
          const [kind, ...rest] = e.target.value.split(":");
          choose(kind, rest.join(":"));
        }}
        style={s.select}
      >
        {foodDays > 0 && (
          <optgroup label="Food">
            <option value="food:all">Calories & macros ({foodDays} day{foodDays === 1 ? "" : "s"})</option>
          </optgroup>
        )}
        {tags.length > 0 && (
          <optgroup label="Tags">
            {tags.map(([t, n]) => <option key={`t-${t}`} value={`tag:${t}`}>#{t} ({n})</option>)}
          </optgroup>
        )}
        {exercises.length > 0 && (
          <optgroup label="Exercises">
            {exercises.map(([name, n]) => <option key={`e-${name}`} value={`exercise:${name}`}>{name} ({n})</option>)}
          </optgroup>
        )}
      </select>

      {metricOptions.length > 1 && (
        <div role="group" aria-label="Measure" style={s.chips}>
          {metricOptions.map((m) => {
            const on = m === activeMetric;
            const color = colorFor(METRICS[m].type);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => setMetric(m)}
                style={{ ...s.chip, borderColor: color, color: on ? raised : color, background: on ? color : "transparent" }}
              >
                {METRICS[m].label}
              </button>
            );
          })}
        </div>
      )}

      {activeMetric && (
        <Chart
          key={`${selectValue}|${activeMetric}`}
          rows={selRows}
          metric={activeMetric}
          bwOn={bwOn}
          target={METRICS[activeMetric].target ? Number(targets?.[METRICS[activeMetric].target]) || null : null}
          title={sel.kind === "tag" ? `#${sel.value}` : sel.kind === "food" ? "Food" : sel.value}
        />
      )}
    </div>
  );
}

/* ---------- chart ---------- */
function Chart({ rows, metric, bwOn, title, target }) {
  const m = METRICS[metric];
  const color = colorFor(m.type);
  const boxRef = useRef(null);
  const [width, setWidth] = useState(360);
  const [hover, setHover] = useState(null); // bucket index in visible list
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Time range of the data, plus today.
  const [dataStart, dataEnd] = useMemo(() => {
    const first = rows.length ? parseIso(rows[0].date).getTime() : Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return [first, Math.max(today.getTime() + DAY, parseIso(rows[rows.length - 1].date).getTime() + DAY)];
  }, [rows]);

  // Initial view: weekly over the last 26 weeks, or the whole log if shorter.
  const dual = m.form === "dual";
  const padR = dual ? 40 : PAD.right; // room for the reps axis
  const plotW = width - PAD.left - padR;

  // view: visible time range and the period scale it's grouped by.
  const [view, setViewRaw] = useState(() => {
    const dataSpan = dataEnd - dataStart;
    const span = Math.min(Math.max(dataSpan + 7 * DAY, 30 * DAY), SCALE_SPAN_DAYS.week * DAY);
    return { start: dataEnd - span, end: dataEnd, scale: "week" };
  });

  // Keeps the view on the data (a little either side) and the scale readable.
  const setView = useCallback((start, end, scale) => {
    setViewRaw((prev) => {
      const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, end - start));
      const lo = dataStart - span * 0.4, hi = dataEnd + span * 0.4;
      const c = Math.min(hi, Math.max(lo, (start + end) / 2));
      return { start: c - span / 2, end: c + span / 2, scale: adjustScale(scale || prev.scale, span, plotW) };
    });
  }, [dataStart, dataEnd, plotW]);

  const span = view.end - view.start;
  const scale = view.scale;
  const buckets = useMemo(
    () => (dual ? bucketizeWeightReps(rows, scale, bwOn) : bucketize(rows, metric, scale, bwOn)),
    [rows, metric, scale, bwOn, dual],
  );

  const x = (t) => PAD.left + ((t - view.start) / span) * plotW;
  const visible = buckets.filter((b) => b.end.getTime() > view.start && b.start.getTime() < view.end);
  const vals = dual ? visible.flatMap((b) => [b.wMax, b.wMin]).filter((v) => v != null) : visible.map((b) => b.value);
  const yTicks = (m.form === "line" || dual) && vals.length ? niceRange(Math.min(...vals), Math.max(...vals)) : niceTicks(Math.max(0, target || 0, ...vals) || 1);
  // Reps axis (right), for the weight & reps view.
  const repVals = dual ? visible.flatMap((b) => [b.rMax, b.rMin]).filter((v) => v != null) : [];
  // Reps are whole numbers: whole-number steps, at most about 5 of them.
  const rTicks = (() => {
    if (!dual) return [];
    const top = Math.max(1, ...repVals);
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((st) => top / st <= 5) || 1000;
    return Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step);
  })();
  const rMax = rTicks[rTicks.length - 1] || 1;
  const yR = (v) => PAD.top + PLOT_H - (v / rMax) * PLOT_H;
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const y = (v) => PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin || 1)) * PLOT_H;

  // One period's width on screen, for column sizing and tick thinning.
  const periodPx = (() => {
    const p = periodStart(new Date(view.start), scale);
    return x(nextPeriod(p, scale).getTime()) - x(p.getTime());
  })();

  // X ticks at period starts, thinned so labels don't collide.
  const xTicks = useMemo(() => {
    const out = [];
    const minGap = scale === "year" ? 40 : 52;
    const step = Math.max(1, Math.ceil(minGap / Math.max(1, periodPx)));
    let p = periodStart(new Date(view.start), scale);
    let i = 0;
    while (p.getTime() < view.end && out.length < 400) {
      const t = p.getTime();
      const anchor = scale === "week" ? Math.round(t / (7 * DAY)) : scale === "day" ? Math.round(t / DAY) : scale === "month" ? p.getFullYear() * 12 + p.getMonth() : p.getFullYear();
      if (t >= view.start && anchor % step === 0) out.push(p);
      p = nextPeriod(p, scale);
      i += 1;
    }
    return out;
  }, [view.start, view.end, scale, periodPx]);

  const zoomAt = (factor, px) => {
    const t = view.start + ((px - PAD.left) / plotW) * span;
    const newSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span * factor));
    const ratio = (t - view.start) / span;
    setView(t - ratio * newSpan, t - ratio * newSpan + newSpan);
  };
  const panBy = (dxPx) => {
    const dt = (dxPx / plotW) * span;
    setView(view.start - dt, view.end - dt);
  };

  const localX = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return e.clientX - r.left;
  };
  const nearest = (px) => {
    if (!visible.length) return null;
    let best = 0, bestD = Infinity;
    visible.forEach((b, i) => {
      const cx = x((b.start.getTime() + b.end.getTime()) / 2);
      const d = Math.abs(cx - px);
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= Math.max(24, periodPx) ? best : null;
  };

  const onPointerDown = (e) => {
    try { boxRef.current.setPointerCapture?.(e.pointerId); } catch { /* synthetic or ended pointer */ }
    pointers.current.set(e.pointerId, { x: localX(e) });
    const pts = [...pointers.current.values()];
    if (pts.length === 1) gesture.current = { kind: "pan", lastX: pts[0].x, startX: pts[0].x, moved: false };
    if (pts.length === 2) gesture.current = { kind: "pinch", dist: Math.abs(pts[0].x - pts[1].x) || 1, view, mid: (pts[0].x + pts[1].x) / 2 };
  };
  const onPointerMove = (e) => {
    const px = localX(e);
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse") setHover(nearest(px));
      return;
    }
    pointers.current.set(e.pointerId, { x: px });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (g?.kind === "pinch" && pts.length >= 2) {
      const dist = Math.abs(pts[0].x - pts[1].x) || 1;
      const s0 = g.view.end - g.view.start;
      const newSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, s0 * (g.dist / dist)));
      const t = g.view.start + ((g.mid - PAD.left) / plotW) * s0;
      const mid = (pts[0].x + pts[1].x) / 2;
      const start = t - ((mid - PAD.left) / plotW) * newSpan;
      setView(start, start + newSpan);
      setHover(null);
    } else if (g?.kind === "pan") {
      const dx = px - g.lastX;
      if (Math.abs(px - g.startX) > 4) g.moved = true;
      if (g.moved) { panBy(dx); setHover(null); }
      g.lastX = px;
    }
  };
  const onPointerUp = (e) => {
    const g = gesture.current;
    if (g?.kind === "pan" && !g.moved) setHover(nearest(localX(e))); // a tap shows the value
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { kind: "pan", lastX: p.x, startX: p.x, moved: true };
    } else if (!pointers.current.size) gesture.current = null;
  };

  // Trackpad pinch arrives as ctrl+wheel; plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(Math.exp(e.deltaY * 0.01), localX(e));
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        panBy(-e.deltaX);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onKeyDown = (e) => {
    const k = e.key;
    if (k === "+" || k === "=") { e.preventDefault(); zoomAt(0.7, PAD.left + plotW / 2); }
    else if (k === "-" || k === "_") { e.preventDefault(); zoomAt(1 / 0.7, PAD.left + plotW / 2); }
    else if (k === "ArrowLeft") { e.preventDefault(); setHover((h) => (h == null ? visible.length - 1 : Math.max(0, h - 1))); }
    else if (k === "ArrowRight") { e.preventDefault(); setHover((h) => (h == null ? 0 : Math.min(visible.length - 1, h + 1))); }
    else if (k === "Escape") setHover(null);
  };

  // Scale buttons: jump to a span that suits the scale, ending where the view
  // ends now (Yearly shows the whole log).
  const jumpTo = (sc) => {
    const end = sc === "year" ? dataEnd : Math.min(view.end, dataEnd);
    let newSpan = SCALE_SPAN_DAYS[sc] * DAY;
    if (sc === "year") newSpan = Math.max(2.6 * 365 * DAY, (dataEnd - dataStart) * 1.15 + 120 * DAY);
    setView(end - newSpan, end, sc);
    setHover(null);
  };

  // Summary: best period and latest period in view, sessions in view.
  const inView = visible;
  const best = inView.reduce((a, b) => (!a || b.value > a.value ? b : a), null);
  const latest = inView[inView.length - 1] || null;
  const sessions = new Set(rows.filter((r) => { const t = parseIso(r.date).getTime(); return t >= view.start && t < view.end; }).map((r) => r.date)).size;
  const periodWord = { day: "day", week: "week", month: "month", year: "year" }[scale];
  const foodDaysInView = sessions;
  const avgInView = inView.length ? inView.reduce((a, b) => a + b.value * b.days, 0) / Math.max(1, inView.reduce((a, b) => a + b.days, 0)) : 0;
  const onTarget = target && m.type === "food" ? daysOnTarget(rows, metric, target, view.start, view.end) : null;

  const hb = hover != null ? visible[hover] : null;
  const colW = Math.max(2, Math.min(24, periodPx * 0.7));

  return (
    <div style={s.card}>
      <div style={s.tiles}>
        {dual ? (
          <>
            <Tile label="Heaviest in view" value={vals.length ? fmt(Math.max(...visible.map((b) => b.wMax ?? -Infinity)), "kg") : "–"} sub={best ? periodLabel(best.start, scale, true) : "No data in view"} />
            <Tile label={`Latest ${periodWord}`} value={latest?.wMax != null ? fmt(latest.wMax, "kg") : "–"} sub={latest?.rMax != null ? `up to ${fmtNum(latest.rMax)} reps` : ""} />
            <Tile label="Most reps in a set" value={repVals.length ? fmtNum(Math.max(...repVals)) : "–"} sub="in view" />
          </>
        ) : m.agg === "avg" ? (
          <>
            <Tile label={scale === "day" ? "Average day in view" : `Average day, latest ${periodWord}`} value={latest ? fmt(scale === "day" ? avgInView : latest.value, m.unit) : "–"} sub={latest && scale !== "day" ? periodLabel(latest.start, scale, true) : `${foodDaysInView} day${foodDaysInView === 1 ? "" : "s"} logged`} />
            <Tile label={`Highest ${scale === "day" ? "day" : `${periodWord}'s average`}`} value={best ? fmt(best.value, m.unit) : "–"} sub={best ? periodLabel(best.start, scale, true) : "No data in view"} />
            {onTarget ? (
              <Tile label={metric === "kcal" ? "Days within 10% of target" : "Days at or over target"} value={`${onTarget.hit} of ${onTarget.days}`} sub={`target ${fmt(target, m.unit)}`} />
            ) : (
              <Tile label="Days logged in view" value={String(foodDaysInView)} sub={`${SCALE_LABEL[scale].toLowerCase()} view`} />
            )}
          </>
        ) : (
          <>
            <Tile label={m.agg === "max" ? `Best ${periodWord} in view` : `Most in a ${periodWord}${metric === "volume" ? " (average-weight volume)" : ""}`} value={best ? fmt(best.value, m.unit) : "–"} sub={best ? periodLabel(best.start, scale, true) : "No data in view"} />
            <Tile label={`Latest ${periodWord}`} value={latest ? fmt(latest.value, m.unit) : "–"} sub={latest ? periodLabel(latest.start, scale, true) : ""} />
            <Tile label="Workout days in view" value={String(sessions)} sub={`${SCALE_LABEL[scale].toLowerCase()} view`} />
          </>
        )}
      </div>

      <div style={s.chartHead}>
        <div style={{ minWidth: 0 }}>
          <div style={s.chartTitle}>{m.label} · {title}</div>
          <div style={s.chartSub}>{dual ? `${SCALE_LABEL[scale]}: highest and lowest weight (kg) and reps per set` : <>{m.agg === "avg" ? (scale === "day" ? "Daily total" : `Average day per ${periodWord}`) : `${SCALE_LABEL[scale]} ${m.agg === "max" ? "best" : "total"}`}, {`${m.unit}${m.note ? ` · ${m.note}` : ""}`}</>}</div>
        </div>
        <div role="group" aria-label="Time scale" style={s.scaleRow}>
          {SCALES.map((sc) => (
            <button key={sc} type="button" aria-pressed={sc === scale} onClick={() => jumpTo(sc)} style={{ ...s.scaleBtn, ...(sc === scale ? s.scaleBtnOn : {}) }}>
              {SCALE_LABEL[sc]}
            </button>
          ))}
        </div>
      </div>

      {dual && (
        <div style={s.legend} aria-label="Legend">
          {[["Max weight (kg, left)", rust, 1], ["Min weight", rust, 0.38], ["Max reps (right)", blue, 1], ["Min reps", blue, 0.38]].map(([label, c, o]) => (
            <span key={label} style={s.legendItem}>
              <span style={{ display: "inline-block", width: 16, height: 2, background: c, opacity: o }} />
              {label}
            </span>
          ))}
        </div>
      )}
      <div
        ref={boxRef}
        tabIndex={0}
        role="img"
        aria-label={`${m.label} for ${title}, ${SCALE_LABEL[scale].toLowerCase()}. Drag to move through time, pinch or use plus and minus to zoom, arrow keys to step through values.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => { if (e.pointerType === "mouse" && !pointers.current.size) setHover(null); }}
        onKeyDown={onKeyDown}
        style={s.plotBox}
      >
        <svg width={width} height={PAD.top + PLOT_H + PAD.bottom} style={{ display: "block" }}>
          <defs>
            <clipPath id="plot-clip"><rect x={PAD.left} y={0} width={plotW} height={PAD.top + PLOT_H + 1} /></clipPath>
          </defs>
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={width - padR} y1={y(v)} y2={y(v)} stroke={i === 0 ? line : grid} strokeWidth="1" />
              <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" style={s.tick}>{compact(v)}</text>
            </g>
          ))}
          {dual && rTicks.map((v, i) => (
            <text key={`r${i}`} x={width - padR + 6} y={yR(v)} dy="0.32em" textAnchor="start" style={s.tick}>{compact(v)}</text>
          ))}
          {dual && (
            <>
              <text x={PAD.left - 6} y={PAD.top - 8} textAnchor="end" style={s.axisTitle}>kg</text>
              <text x={width - padR + 6} y={PAD.top - 8} textAnchor="start" style={s.axisTitle}>reps</text>
            </>
          )}
          <g clipPath="url(#plot-clip)">
            {dual ? (
              <>
                {[
                  ["wMin", rust, y, true], ["rMin", blue, yR, true],
                  ["wMax", rust, y, false], ["rMax", blue, yR, false],
                ].map(([k, c, sy, faint]) => {
                  const pts = visible.filter((b) => b[k] != null);
                  return (
                    <g key={k} opacity={faint ? 0.38 : 1}>
                      <path
                        d={pts.map((b, i) => `${i ? "L" : "M"}${x((b.start.getTime() + b.end.getTime()) / 2)},${sy(b[k])}`).join(" ")}
                        fill="none" stroke={c} strokeWidth={faint ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round"
                      />
                      {pts.map((b) => {
                        const i = visible.indexOf(b);
                        return <circle key={i} cx={x((b.start.getTime() + b.end.getTime()) / 2)} cy={sy(b[k])} r={faint ? 3 : hover === i ? 5.5 : 4} fill={c} stroke={raised} strokeWidth="2" />;
                      })}
                    </g>
                  );
                })}
              </>
            ) : m.form === "column"
              ? visible.map((b, i) => {
                  const cx = x((b.start.getTime() + b.end.getTime()) / 2);
                  const top = y(b.value), base = y(0), h = Math.max(1, base - top), r = Math.min(4, colW / 2, h);
                  const d = `M${cx - colW / 2},${base} V${top + r} Q${cx - colW / 2},${top} ${cx - colW / 2 + r},${top} H${cx + colW / 2 - r} Q${cx + colW / 2},${top} ${cx + colW / 2},${top + r} V${base} Z`;
                  return <path key={i} d={d} fill={color} opacity={hover == null || hover === i ? 1 : 0.55} />;
                })
              : (
                <>
                  <path
                    d={visible.map((b, i) => `${i ? "L" : "M"}${x((b.start.getTime() + b.end.getTime()) / 2)},${y(b.value)}`).join(" ")}
                    fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                  />
                  {visible.map((b, i) => (
                    <circle key={i} cx={x((b.start.getTime() + b.end.getTime()) / 2)} cy={y(b.value)} r={hover === i ? 5.5 : 4} fill={color} stroke={raised} strokeWidth="2" />
                  ))}
                </>
              )}
            {hb && (
              <line x1={x((hb.start.getTime() + hb.end.getTime()) / 2)} x2={x((hb.start.getTime() + hb.end.getTime()) / 2)} y1={PAD.top} y2={PAD.top + PLOT_H} stroke={inkFaint} strokeWidth="1" opacity="0.6" />
            )}
            {target && (
              <g>
                <line x1={PAD.left} x2={width - padR} y1={y(target)} y2={y(target)} stroke={ink} strokeWidth="1.5" opacity="0.7" />
                <text x={PAD.left + 4} y={y(target) - 5} style={s.targetLabel}>Target {compact(target)}</text>
              </g>
            )}
            {best && hover == null && !dual && (
              <text
                x={Math.min(width - padR - 4, Math.max(PAD.left + 4, x((best.start.getTime() + best.end.getTime()) / 2)))}
                y={y(best.value) - 8}
                textAnchor={x((best.start.getTime() + best.end.getTime()) / 2) > width - 60 ? "end" : x((best.start.getTime() + best.end.getTime()) / 2) < PAD.left + 40 ? "start" : "middle"}
                style={s.valueLabel}
              >
                {compact(best.value)}
              </text>
            )}
          </g>
          {xTicks.map((p, i) => {
            const tx = x(p.getTime() + (nextPeriod(p, scale).getTime() - p.getTime()) / 2);
            if (tx < PAD.left + 10 || tx > width - padR - 10) return null;
            return <text key={i} x={tx} y={PAD.top + PLOT_H + 18} textAnchor="middle" style={s.tick}>{periodLabel(p, scale)}</text>;
          })}
          {!visible.length && (
            <text x={PAD.left + plotW / 2} y={PAD.top + PLOT_H / 2} textAnchor="middle" style={s.emptyPlot}>Nothing logged in this range. Drag to move through time.</text>
          )}
        </svg>
        {hb && (
          <div
            role="status"
            style={{
              ...s.tooltip,
              left: Math.min(width - 150, Math.max(4, x((hb.start.getTime() + hb.end.getTime()) / 2) - 70)),
              top: dual ? 4 : Math.max(0, y(hb.value) - 58),
            }}
          >
            {dual ? (
              <>
                <span style={s.tipLabel}>{periodLabel(hb.start, scale, true)}</span>
                {[["Max weight", hb.wMax, "kg", rust, 1], ["Min weight", hb.wMin, "kg", rust, 0.4], ["Max reps", hb.rMax, "reps", blue, 1], ["Min reps", hb.rMin, "reps", blue, 0.4]].map(([label, v, u, c, o]) => (
                  <span key={label} style={s.tipRow}>
                    <span style={{ display: "inline-block", width: 10, height: 2, background: c, opacity: o, verticalAlign: "middle", marginRight: 5 }} />
                    <strong style={s.tipStrong}>{v == null ? "–" : `${fmtNum(v)} ${u}`}</strong> {label.toLowerCase()}
                  </span>
                ))}
              </>
            ) : (
              <>
                <span style={s.tipValue}>{fmt(hb.value, m.unit)}</span>
                <span style={s.tipLabel}>
                  <span style={{ display: "inline-block", width: 10, height: 2, background: color, verticalAlign: "middle", marginRight: 5 }} />
                  {periodLabel(hb.start, scale, true)}
                </span>
              </>
            )}
            <span style={s.tipLabel}>{hb.days} workout day{hb.days === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>

      <div style={s.zoomRow}>
        <span style={s.hint}>Drag to move · pinch to zoom</span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 0.7, PAD.left + plotW / 2)} style={s.zoomBtn}>−</button>
          <button type="button" aria-label="Zoom in" onClick={() => zoomAt(0.7, PAD.left + plotW / 2)} style={s.zoomBtn}>+</button>
        </span>
      </div>

      <details style={s.tableBox}>
        <summary style={s.summary}>Table of values in view ({visible.length})</summary>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{SCALE_LABEL[scale].replace("ly", "").replace("Dai", "Day")}</th>
              {dual ? (
                ["Max kg", "Min kg", "Max reps", "Min reps"].map((h) => <th key={h} style={{ ...s.th, textAlign: "right" }}>{h}</th>)
              ) : (
                <th style={{ ...s.th, textAlign: "right" }}>{m.label} ({m.unit})</th>
              )}
              <th style={{ ...s.th, textAlign: "right" }}>Days</th>
            </tr>
          </thead>
          <tbody>
            {[...visible].reverse().map((b, i) => (
              <tr key={i}>
                <td style={s.td}>{periodLabel(b.start, scale, true)}</td>
                {dual ? (
                  [b.wMax, b.wMin, b.rMax, b.rMin].map((v, j) => <td key={j} style={{ ...s.td, textAlign: "right" }}>{v == null ? "–" : fmtNum(v)}</td>)
                ) : (
                  <td style={{ ...s.td, textAlign: "right" }}>{b.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                )}
                <td style={{ ...s.td, textAlign: "right" }}>{b.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div style={s.tile}>
      <span style={s.tileLabel}>{label}</span>
      <span style={s.tileValue}>{value}</span>
      {sub && <span style={s.tileSub}>{sub}</span>}
    </div>
  );
}

const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10, marginTop: 16 },
  empty: { marginTop: 24, fontSize: 14, color: inkFaint, lineHeight: 1.5 },
  label: { fontFamily: mono, fontSize: 11, color: inkFaint, letterSpacing: "0.06em" },
  select: { fontFamily: "'Inter', sans-serif", fontSize: 15, padding: "8px 10px", border: `1px solid ${line}`, borderRadius: 4, background: "#fff", color: ink, width: "100%" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { fontFamily: mono, fontSize: 12, border: "1px solid", borderRadius: 999, padding: "5px 12px" },
  card: { background: raised, border: `1px solid ${line}`, borderRadius: 4, padding: "12px 0 10px", display: "flex", flexDirection: "column", gap: 10 },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, padding: "0 12px" },
  tile: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  tileLabel: { fontSize: 11, color: inkFaint },
  tileValue: { fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 20, color: ink, lineHeight: 1.15 },
  tileSub: { fontFamily: mono, fontSize: 10, color: inkFaint, overflowWrap: "anywhere" },
  chartHead: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 8, padding: "4px 12px 0", borderTop: `1px solid ${line}`, paddingTop: 10 },
  chartTitle: { fontFamily: condensed, fontWeight: 700, fontSize: 18, letterSpacing: "0.02em", color: ink, overflowWrap: "anywhere" },
  chartSub: { fontFamily: mono, fontSize: 10, color: inkFaint },
  scaleRow: { display: "inline-flex", border: `1px solid ${ink}`, borderRadius: 4, overflow: "hidden" },
  scaleBtn: { fontFamily: mono, fontSize: 11, padding: "5px 8px", border: "none", borderLeft: `1px solid ${ink}`, background: "transparent", color: ink, marginLeft: -1 },
  scaleBtnOn: { background: ink, color: raised },
  plotBox: { position: "relative", touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none", cursor: "grab", outlineOffset: -2 },
  tick: { fontFamily: mono, fontSize: 10, fill: inkFaint, fontVariantNumeric: "tabular-nums" },
  targetLabel: { fontFamily: mono, fontSize: 10, fontWeight: 500, fill: ink },
  axisTitle: { fontFamily: mono, fontSize: 10, fill: inkFaint },
  legend: { display: "flex", flexWrap: "wrap", gap: "4px 14px", padding: "0 12px", fontFamily: mono, fontSize: 10, color: inkFaint },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  tipRow: { fontFamily: mono, fontSize: 10, color: inkFaint, whiteSpace: "nowrap" },
  tipStrong: { fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600, color: ink },
  valueLabel: { fontFamily: mono, fontSize: 11, fontWeight: 500, fill: ink },
  emptyPlot: { fontFamily: "'Inter', sans-serif", fontSize: 12, fill: inkFaint },
  tooltip: { position: "absolute", pointerEvents: "none", display: "flex", flexDirection: "column", gap: 2, background: "#fff", border: `1px solid ${line}`, borderRadius: 4, boxShadow: "0 4px 14px rgba(35,33,29,0.12)", padding: "6px 9px", width: 146 },
  tipValue: { fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14, color: ink },
  tipLabel: { fontFamily: mono, fontSize: 10, color: inkFaint },
  zoomRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 12px" },
  hint: { fontFamily: mono, fontSize: 10, color: inkFaint },
  zoomBtn: { width: 30, height: 30, border: `1px solid ${line}`, borderRadius: 4, background: "transparent", color: ink, fontSize: 16, lineHeight: 1 },
  tableBox: { padding: "0 12px" },
  summary: { fontFamily: mono, fontSize: 11, color: inkFaint, cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: 12, fontVariantNumeric: "tabular-nums" },
  th: { textAlign: "left", fontFamily: mono, fontSize: 10, color: inkFaint, fontWeight: 500, borderBottom: `1px solid ${line}`, padding: "4px 2px" },
  td: { padding: "4px 2px", borderBottom: `1px solid ${paper}`, color: ink },
};
