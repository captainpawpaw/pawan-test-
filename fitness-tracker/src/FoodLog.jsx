import React, { useEffect, useMemo, useRef, useState } from "react";
import { C } from "./theme";
import {
  NUTRIENTS, MACRO_LABEL, MACRO_UNIT, scale, sumFood, loadFoods, searchFoods,
  onlineLookupsAllowed, searchOpenFoodFacts, lookupBarcode, searchUsdaOnline, usdaOnlineKnownOff,
  cameraAllowed, startBarcodeScan, claudeEstimateAvailable, claudePhotoLimits, estimateWithClaude,
} from "./food";

const ink = C.ink;
const inkFaint = C.inkFaint;
const paper = C.paper;
const raised = C.raised;
const line = C.line;
const plum = C.plum;
const plumSoft = C.plumSoft;
const mono = "'IBM Plex Mono', monospace";
const sans = C.sans;
const condensed = C.display;

const SOURCE_LABEL = { usda: "USDA", "usda-online": "USDA online", off: "Open Food Facts", claude: "Claude estimate", custom: "Your entry" };
const fmtG = (n) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;

// entries: this day's food; recent: foods logged before (newest first);
// onAdd(list) adds one or more entries to the day.
export default function FoodLog({ entries, recent, onAdd, onDelete, onEdit, targets, onSaveTargets, saveError }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const totals = useMemo(() => sumFood(entries), [entries]);

  return (
    <div className="ft-card" style={st.section}>
      <div style={st.head}>
        <span style={st.title}>FOOD</span>
        <button
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
          style={{ ...st.addBtn, color: adding ? C.onFill : plum, background: adding ? plum : "transparent" }}
        >
          {adding ? "Close" : "+ Add"}
        </button>
      </div>

      <Totals totals={totals} targets={targets} onSaveTargets={onSaveTargets} />
      {saveError && <div role="alert" style={st.error}>Not saved — try again</div>}

      {adding && <AddFood recent={recent} onAdd={onAdd} onDone={() => setAdding(false)} />}

      <div style={st.rows}>
        {!entries?.length ? (
          <div style={st.empty}>No food logged for this day.</div>
        ) : (
          entries.map((e) => (
            <React.Fragment key={e.id}>
            <div style={{ ...st.row, ...(editingId === e.id ? { outline: `2px solid ${plum}`, outlineOffset: -2 } : {}) }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={st.rowName}>{e.name}</div>
                <div style={st.rowMeta}>
                  {e.qty && e.portion ? `${fmtG(e.qty)} × ${e.portion} · ` : ""}{e.grams > 0 ? `${fmtG(e.grams)} g · ` : ""}P {fmtG(e.protein)} · C {fmtG(e.carbs)} · F {fmtG(e.fat)}
                  {e.estimate ? " · ≈ estimate" : ""}
                </div>
              </div>
              <span style={st.rowKcal}>{Math.round(e.kcal)} kcal</span>
              {onEdit && (
                <button aria-label={`Edit ${e.name}`} onClick={() => setEditingId(editingId === e.id ? null : e.id)} style={st.editBtn}>✎</button>
              )}
              <button aria-label={`Delete ${e.name}`} onClick={() => { if (editingId === e.id) setEditingId(null); onDelete(e.id); }} style={st.deleteBtn}>×</button>
            </div>
            {editingId === e.id && (
              <EditFood entry={e} onSave={(next) => { onEdit(e.id, next); setEditingId(null); }} onCancel={() => setEditingId(null)} />
            )}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}

/* ---------- totals and targets ---------- */
function Meter({ label, value, target, unit }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const diff = target ? Math.round(target - value) : null;
  return (
    <div style={st.meter}>
      <div style={st.meterTop}>
        <span style={st.meterLabel}>{label}</span>
        <span style={st.meterValue}>
          {fmtG(value)}{target ? <span style={st.meterOf}> / {fmtG(target)} {unit}</span> : <span style={st.meterOf}> {unit}</span>}
        </span>
      </div>
      {target ? (
        <>
          <div style={st.track} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={value}>
            <div style={{ ...st.fill, width: `${pct}%` }} />
          </div>
          <span style={st.meterNote}>{diff >= 0 ? `${fmtG(diff)} ${unit} left` : `${fmtG(-diff)} ${unit} over`}</span>
        </>
      ) : null}
    </div>
  );
}

function Totals({ totals, targets, onSaveTargets }) {
  const [editing, setEditing] = useState(false);
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [err, setErr] = useState("");
  const hasTargets = targets?.kcal || targets?.protein;

  const open = () => { setKcal(targets?.kcal ? String(targets.kcal) : ""); setProtein(targets?.protein ? String(targets.protein) : ""); setErr(""); setEditing(true); };
  const save = async (ev) => {
    ev.preventDefault();
    const k = kcal ? Number(kcal) : null, p = protein ? Number(protein) : null;
    if ((k != null && !(k >= 500 && k <= 10000)) || (p != null && !(p >= 10 && p <= 600))) {
      setErr("Use calories between 500 and 10,000 and protein between 10 and 600 g.");
      return;
    }
    const ok = await onSaveTargets({ kcal: k, protein: p });
    if (!ok) { setErr("Couldn't save. Try again."); return; }
    setEditing(false);
  };

  return (
    <div style={st.totals}>
      <div style={st.meters}>
        <Meter label="Calories" value={totals.kcal} target={targets?.kcal} unit="kcal" />
        <Meter label="Protein" value={totals.protein} target={targets?.protein} unit="g" />
      </div>
      <div style={st.macroLine}>
        Carbs {fmtG(totals.carbs)} g · Fat {fmtG(totals.fat)} g · Fibre {fmtG(totals.fibre)} g
        {!editing && (
          <button type="button" onClick={open} style={st.linkBtn}>{hasTargets ? "Change targets" : "Set daily targets"}</button>
        )}
      </div>
      {editing && (
        <form onSubmit={save} noValidate style={st.targetForm}>
          <label style={st.fieldLabel}>
            Calories per day
            <input type="number" inputMode="numeric" value={kcal} onChange={(e) => { setKcal(e.target.value); setErr(""); }} placeholder="2200" style={{ ...st.input, width: 110 }} />
          </label>
          <label style={st.fieldLabel}>
            Protein per day (g)
            <input type="number" inputMode="numeric" value={protein} onChange={(e) => { setProtein(e.target.value); setErr(""); }} placeholder="150" style={{ ...st.input, width: 110 }} />
          </label>
          <div style={st.btnRow}>
            <button type="submit" style={st.primaryBtn}>Save targets</button>
            <button type="button" onClick={() => setEditing(false)} style={st.secondaryBtn}>Cancel</button>
          </div>
          {err && <span role="alert" style={st.error}>{err}</span>}
          <span style={st.note}>Leave one blank to track it without a target.</span>
        </form>
      )}
    </div>
  );
}

/* ---------- adding food ---------- */
function AddFood({ recent, onAdd, onDone }) {
  const [mode, setMode] = useState("search"); // search | amount | claude | manual | scan
  const [picked, setPicked] = useState(null);
  const [flash, setFlash] = useState("");

  const pick = (food) => { setPicked(food); setMode("amount"); };
  const added = (e) => {
    onAdd([e]);
    setFlash(`Added ${e.name}.`);
    setPicked(null);
    setMode("search");
  };

  return (
    <div style={st.addBox}>
      {flash && mode === "search" && <div role="status" style={st.flash}>{flash}</div>}
      {mode === "search" && <FoodSearch recent={recent} onPick={pick} onMode={setMode} />}
      {mode === "amount" && picked && <AmountStep food={picked} onAdd={added} onBack={() => setMode("search")} />}
      {mode === "manual" && <ManualFood onAdd={added} onBack={() => setMode("search")} />}
      {mode === "claude" && <ClaudeEstimate onAdd={(items) => { onAdd(items); setFlash(`Added ${items.length} item${items.length === 1 ? "" : "s"} from Claude's estimate.`); setMode("search"); }} onBack={() => setMode("search")} />}
      {mode === "scan" && <BarcodeScan onFound={pick} onBack={() => setMode("search")} />}
      <button type="button" onClick={onDone} style={{ ...st.linkBtn, alignSelf: "flex-end" }}>Done adding</button>
    </div>
  );
}

function FoodSearch({ recent, onPick, onMode }) {
  const [q, setQ] = useState("");
  const [foods, setFoods] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [off, setOff] = useState({ state: "idle", list: [], q: "" });
  const [usda, setUsda] = useState({ list: [], q: "" });
  const [barcode, setBarcode] = useState("");
  const [barcodeMsg, setBarcodeMsg] = useState("");
  const [canClaude, setCanClaude] = useState(false);
  const online = onlineLookupsAllowed();
  const inputRef = useRef(null);

  useEffect(() => {
    let live = true;
    loadFoods().then((f) => live && setFoods(f)).catch(() => live && setLoadErr(true));
    if (!online) claudeEstimateAvailable().then((ok) => live && setCanClaude(ok));
    inputRef.current?.focus();
    return () => { live = false; };
  }, [online]);

  const local = useMemo(() => (foods && q.trim().length >= 2 ? searchFoods(foods, q) : []), [foods, q]);
  const recentHits = useMemo(() => {
    const w = q.trim().toLowerCase();
    return (w ? recent.filter((f) => f.name.toLowerCase().includes(w)) : recent).slice(0, w ? 5 : 8);
  }, [recent, q]);

  // USDA online (only on the website, when the Pages Function is set up).
  useEffect(() => {
    if (!online || usdaOnlineKnownOff() || q.trim().length < 3) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      searchUsdaOnline(q, { signal: ctl.signal }).then((list) => { if (list) setUsda({ list, q }); }).catch(() => {});
    }, 600);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, online]);

  const searchOff = async () => {
    setOff({ state: "busy", list: [], q });
    try {
      setOff({ state: "done", list: await searchOpenFoodFacts(q), q });
    } catch {
      setOff({ state: "error", list: [], q });
    }
  };

  const findBarcode = async (ev) => {
    ev.preventDefault();
    setBarcodeMsg("Looking up…");
    try {
      const f = await lookupBarcode(barcode);
      if (f) { setBarcodeMsg(""); onPick(f); } else setBarcodeMsg("No product found for that barcode. Try searching by name.");
    } catch {
      setBarcodeMsg("Couldn't reach Open Food Facts. Check your connection.");
    }
  };

  const ResultList = ({ items, label }) => items.length ? (
    <div style={st.resultGroup}>
      <span style={st.groupLabel}>{label}</span>
      <ul style={st.resultList}>
        {items.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onPick(f)} style={st.result}>
              <span style={st.resultName}>{f.name}</span>
              <span style={st.resultMeta}>{f.per100.kcal} kcal · P {fmtG(f.per100.protein)} g per 100 g{f.group ? ` · ${f.group}` : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  const usdaShown = usda.q === q ? usda.list.filter((f) => !local.some((l) => l.name === f.name)).slice(0, 10) : [];

  return (
    <div style={st.stack}>
      <label htmlFor="food-search" style={st.fieldLabel}>Search foods</label>
      <input
        id="food-search"
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. chicken breast, oats, banana"
        autoComplete="off"
        style={{ ...st.input, width: "100%" }}
      />
      {loadErr && <span style={st.error}>The food list didn't load. Check your connection and reopen this.</span>}
      {!foods && !loadErr && <span style={st.note}>Loading foods…</span>}

      <ResultList items={recentHits} label={q.trim() ? "Logged before" : "Recent"} />
      <ResultList items={local.slice(0, 15)} label="Foods (USDA)" />
      <ResultList items={usdaShown} label="More from USDA online" />
      {q.trim().length >= 2 && foods && !local.length && !recentHits.length && <span style={st.note}>No match in the built-in list.</span>}

      {online && q.trim().length >= 2 && (
        <div style={st.resultGroup}>
          {off.q !== q || off.state === "idle" ? (
            <button type="button" onClick={searchOff} style={st.secondaryBtn}>Search branded products for “{q.trim()}”</button>
          ) : off.state === "busy" ? (
            <span style={st.note}>Searching Open Food Facts…</span>
          ) : off.state === "error" ? (
            <span style={st.error}>Couldn't reach Open Food Facts. Try again in a minute.</span>
          ) : off.list.length ? (
            <>
              <ResultList items={off.list} label="Branded products (Open Food Facts)" />
              <span style={st.note}>Product data © Open Food Facts contributors, ODbL. Check the label if a value looks wrong.</span>
            </>
          ) : (
            <span style={st.note}>No branded products found.</span>
          )}
        </div>
      )}

      <div style={st.optionRow}>
        {online && cameraAllowed() && <button type="button" onClick={() => onMode("scan")} style={st.secondaryBtn}>Scan barcode</button>}
        {canClaude && <button type="button" onClick={() => onMode("claude")} style={st.secondaryBtn}>Describe a meal for Claude</button>}
        <button type="button" onClick={() => onMode("manual")} style={st.secondaryBtn}>Enter manually</button>
      </div>

      {online && (
        <form onSubmit={findBarcode} style={st.inline}>
          <label htmlFor="barcode-input" style={st.fieldLabel}>Or type a barcode</label>
          <div style={st.btnRow}>
            <input id="barcode-input" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="5000159484695" style={{ ...st.input, flex: 1, minWidth: 0 }} />
            <button type="submit" disabled={barcode.replace(/\D/g, "").length < 6} style={st.secondaryBtn}>Look up</button>
          </div>
          {barcodeMsg && <span style={st.note}>{barcodeMsg}</span>}
        </form>
      )}
    </div>
  );
}

function AmountStep({ food, onAdd, onBack }) {
  const units = useMemo(() => [{ g: 1, label: "g" }, ...(food.portions || [])], [food]);
  const [unit, setUnit] = useState(food.portions?.length && food.source !== "usda" ? 1 : 0);
  const [qty, setQty] = useState(food.lastGrams && unit === 0 ? String(food.lastGrams) : unit === 0 ? "100" : "1");
  const grams = (Number(qty) || 0) * units[unit].g;
  const vals = scale(food.per100, grams);

  const submit = (ev) => {
    ev.preventDefault();
    if (!(grams > 0)) return;
    onAdd({
      name: food.name,
      grams: Math.round(grams * 10) / 10,
      ...vals,
      per100: food.per100,
      source: food.source,
      ...(unit > 0 ? { portion: units[unit].label, qty: Number(qty) } : {}),
      ...(food.barcode ? { barcode: food.barcode } : {}),
      ...(food.estimate ? { estimate: true } : {}),
    });
  };

  return (
    <form onSubmit={submit} style={st.stack}>
      <div>
        <div style={st.pickedName}>{food.name}</div>
        <div style={st.note}>{SOURCE_LABEL[food.source] || ""} · {food.per100.kcal} kcal per 100 g</div>
      </div>
      <div style={st.btnRow}>
        <label style={{ ...st.fieldLabel, flex: "0 0 90px" }}>
          Amount
          <input type="number" inputMode="decimal" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus style={st.input} />
        </label>
        <label style={{ ...st.fieldLabel, flex: 1, minWidth: 0 }}>
          Unit
          <select value={unit} onChange={(e) => { const u = Number(e.target.value); setUnit(u); setQty(u === 0 ? "100" : "1"); }} style={st.input}>
            {units.map((u, i) => <option key={i} value={i}>{i === 0 ? "grams" : `${u.label} (${fmtG(u.g)} g)`}</option>)}
          </select>
        </label>
      </div>
      <div style={st.preview} aria-live="polite">
        <strong>{vals.kcal} kcal</strong> · Protein {fmtG(vals.protein)} g · Carbs {fmtG(vals.carbs)} g · Fat {fmtG(vals.fat)} g
        <span style={st.note}>{fmtG(grams)} g</span>
      </div>
      <div style={st.btnRow}>
        <button type="submit" disabled={!(grams > 0)} style={st.primaryBtn}>Add to day</button>
        <button type="button" onClick={onBack} style={st.secondaryBtn}>Back</button>
      </div>
    </form>
  );
}

// Edit a logged food: change the amount (nutrients rescale) or, for foods
// entered by hand, the numbers themselves. The name can always change.
function EditFood({ entry, onSave, onCancel }) {
  const hasPortion = entry.portion && entry.qty;
  const portionG = hasPortion ? entry.grams / entry.qty : null;
  const [name, setName] = useState(entry.name);
  const [unit, setUnit] = useState(hasPortion ? "portion" : "g");
  const [qty, setQty] = useState(String(hasPortion ? entry.qty : entry.grams || ""));
  const [nums, setNums] = useState({ kcal: String(entry.kcal ?? ""), protein: String(entry.protein ?? ""), carbs: String(entry.carbs ?? ""), fat: String(entry.fat ?? "") });
  const scalable = Boolean(entry.per100);
  const grams = unit === "portion" ? (Number(qty) || 0) * portionG : Number(qty) || 0;
  const vals = scalable ? scale(entry.per100, grams) : null;

  const save = (ev) => {
    ev.preventDefault();
    const base = { ...entry, name: name.trim() || entry.name };
    delete base.id;
    if (scalable) {
      if (!(grams > 0)) return;
      const next = { ...base, grams: Math.round(grams * 10) / 10, ...vals };
      if (unit === "portion") { next.qty = Number(qty); next.portion = entry.portion; } else { delete next.qty; delete next.portion; }
      onSave(next);
    } else {
      onSave({ ...base, kcal: Math.round(Number(nums.kcal) || 0), protein: Number(nums.protein) || 0, carbs: Number(nums.carbs) || 0, fat: Number(nums.fat) || 0 });
    }
  };

  return (
    <form onSubmit={save} style={{ ...st.addBox, marginTop: -2 }} aria-label={`Edit ${entry.name}`}>
      <label style={st.fieldLabel}>Name<input value={name} onChange={(e) => setName(e.target.value)} style={st.input} /></label>
      {scalable ? (
        <>
          <div style={st.btnRow}>
            <label style={{ ...st.fieldLabel, flex: "0 0 90px" }}>
              Amount
              <input type="number" inputMode="decimal" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus style={st.input} />
            </label>
            {hasPortion && (
              <label style={{ ...st.fieldLabel, flex: 1, minWidth: 0 }}>
                Unit
                <select value={unit} onChange={(e) => { const u = e.target.value; setUnit(u); setQty(u === "g" ? String(Math.round(grams * 10) / 10) : String(Math.round((grams / portionG) * 100) / 100)); }} style={st.input}>
                  <option value="g">grams</option>
                  <option value="portion">{entry.portion} ({fmtG(portionG)} g)</option>
                </select>
              </label>
            )}
            {!hasPortion && <span style={{ ...st.note, alignSelf: "center", marginTop: 14 }}>grams</span>}
          </div>
          <div style={st.preview} aria-live="polite">
            <strong>{vals.kcal} kcal</strong> · Protein {fmtG(vals.protein)} g · Carbs {fmtG(vals.carbs)} g · Fat {fmtG(vals.fat)} g
          </div>
        </>
      ) : (
        <div style={st.grid3}>
          {[["kcal", "Calories"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fat", "Fat (g)"]].map(([k, label]) => (
            <label key={k} style={st.fieldLabel}>{label}<input type="number" inputMode="decimal" step="any" min="0" value={nums[k]} onChange={(e) => setNums((n) => ({ ...n, [k]: e.target.value }))} style={st.input} /></label>
          ))}
        </div>
      )}
      <div style={st.btnRow}>
        <button type="submit" style={st.primaryBtn}>Save changes</button>
        <button type="button" onClick={onCancel} style={st.secondaryBtn}>Cancel</button>
      </div>
    </form>
  );
}

function ManualFood({ onAdd, onBack }) {
  const [v, setV] = useState({ name: "", grams: "", kcal: "", protein: "", carbs: "", fat: "" });
  const set = (k) => (e) => setV((cur) => ({ ...cur, [k]: e.target.value }));
  const ok = v.name.trim() && Number(v.kcal) >= 0 && v.kcal !== "";
  const submit = (ev) => {
    ev.preventDefault();
    if (!ok) return;
    const grams = Number(v.grams) || 0;
    const vals = { kcal: Math.round(Number(v.kcal) || 0), protein: Number(v.protein) || 0, carbs: Number(v.carbs) || 0, fat: Number(v.fat) || 0, fibre: 0, sugar: 0 };
    const per100 = grams > 0 ? Object.fromEntries(NUTRIENTS.map((k) => [k, Math.round((vals[k] / grams) * 1000) / 10])) : null;
    onAdd({ name: v.name.trim(), grams, ...vals, per100, source: "custom" });
  };
  return (
    <form onSubmit={submit} style={st.stack}>
      <span style={st.pickedName}>Enter food manually</span>
      <label style={st.fieldLabel}>Name<input value={v.name} onChange={set("name")} placeholder="Protein bar" style={st.input} /></label>
      <div style={st.grid3}>
        {[["kcal", "Calories"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fat", "Fat (g)"], ["grams", "Weight (g), optional"]].map(([k, label]) => (
          <label key={k} style={st.fieldLabel}>{label}<input type="number" inputMode="decimal" step="any" min="0" value={v[k]} onChange={set(k)} style={st.input} /></label>
        ))}
      </div>
      <div style={st.btnRow}>
        <button type="submit" disabled={!ok} style={st.primaryBtn}>Add to day</button>
        <button type="button" onClick={onBack} style={st.secondaryBtn}>Back</button>
      </div>
    </form>
  );
}

function ClaudeEstimate({ onAdd, onBack }) {
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState([]); // [{ file, url }]
  const [limits, setLimits] = useState(null);
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null); // { items, note }
  const [checked, setChecked] = useState({});
  const ctlRef = useRef(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => {
    claudePhotoLimits().then(setLimits);
    return () => { ctlRef.current?.abort(); photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)); };
  }, []);

  const addPhotos = (files) => {
    const ok = [...files].filter((f) => limits?.mediaTypes.includes(f.type) && f.size <= limits.maxInputBytes);
    setPhotos((cur) => [...cur, ...ok].slice(0, Math.max(1, Math.min(4, limits?.maxCount || 1))).map((f) => (f.url ? f : { file: f, url: URL.createObjectURL(f) })));
  };

  const run = async () => {
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setStatus({ kind: "busy", text: "Claude is estimating…" });
    try {
      const r = await estimateWithClaude({ text: text.trim(), photos: photos.map((p) => p.file) }, { signal: ctl.signal });
      if (!r.items.length) { setStatus({ kind: "error", text: "Claude couldn't estimate that. Add a bit more detail." }); return; }
      setResult(r);
      setChecked(Object.fromEntries(r.items.map((_, i) => [i, true])));
      setStatus(null);
    } catch (e) {
      if (e?.code === "cancelled") return;
      setStatus({ kind: "error", text: e?.code === "not_granted" ? "Claude wasn't allowed to help here." : e?.code === "rate_limited" ? "Claude is busy. Try again in a minute." : "Claude couldn't estimate that. Try again or enter it manually." });
    }
  };

  const updateGrams = (i, g) => setResult((r) => ({
    ...r,
    items: r.items.map((it, j) => (j !== i || !it.per100 ? it : { ...it, grams: Number(g) || 0, ...scale(it.per100, Number(g) || 0) })),
  }));

  if (result) {
    const chosen = result.items.filter((_, i) => checked[i]);
    return (
      <div style={st.stack}>
        <span style={st.pickedName}>Claude's estimate</span>
        <span style={st.note}>Estimates, not measured values. Adjust the weights if you know them.{result.note ? ` ${result.note}` : ""}</span>
        {result.items.map((it, i) => (
          <div key={i} style={st.estRow}>
            <input type="checkbox" checked={Boolean(checked[i])} onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))} aria-label={`Add ${it.name}`} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={st.rowName}>{it.name}</div>
              <div style={st.rowMeta}>{it.kcal} kcal · P {fmtG(it.protein)} · C {fmtG(it.carbs)} · F {fmtG(it.fat)}</div>
            </div>
            <label style={{ ...st.fieldLabel, width: 78 }}>
              Grams
              <input type="number" inputMode="decimal" value={it.grams} onChange={(e) => updateGrams(i, e.target.value)} disabled={!it.per100} style={{ ...st.input, padding: "4px 6px" }} />
            </label>
          </div>
        ))}
        <div style={st.btnRow}>
          <button type="button" disabled={!chosen.length} onClick={() => onAdd(chosen.map(({ per100, ...it }) => ({ ...it, per100, source: "claude", estimate: true })))} style={st.primaryBtn}>
            Add {chosen.length} item{chosen.length === 1 ? "" : "s"}
          </button>
          <button type="button" onClick={() => setResult(null)} style={st.secondaryBtn}>Change description</button>
        </div>
      </div>
    );
  }

  return (
    <div style={st.stack}>
      <label htmlFor="meal-text" style={st.fieldLabel}>Describe what you ate</label>
      <textarea id="meal-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. chicken tikka masala with pilau rice and a garlic naan, restaurant portion" style={{ ...st.input, width: "100%", resize: "vertical" }} />
      {limits && (
        <div style={st.btnRow}>
          <label style={st.fileBtn}>
            + Add a photo
            <input type="file" accept={limits.mediaTypes.join(",")} multiple onChange={(e) => { addPhotos(e.target.files || []); e.target.value = ""; }} style={st.hiddenInput} aria-label="Add a photo of your meal" />
          </label>
          {photos.map((p, i) => (
            <span key={p.url} style={st.thumb}>
              <img src={p.url} alt={`Meal photo ${i + 1}`} style={st.thumbImg} />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((cur) => cur.filter((x) => x.url !== p.url)); }} style={st.thumbX}>×</button>
            </span>
          ))}
        </div>
      )}
      {status && <span role={status.kind === "error" ? "alert" : "status"} style={status.kind === "error" ? st.error : st.note}>{status.text}</span>}
      <div style={st.btnRow}>
        <button type="button" disabled={(!text.trim() && !photos.length) || status?.kind === "busy"} onClick={run} style={st.primaryBtn}>Estimate with Claude</button>
        <button type="button" onClick={onBack} style={st.secondaryBtn}>Back</button>
      </div>
      <span style={st.note}>Uses your Claude usage. Claude asks you to allow it the first time.</span>
    </div>
  );
}

function BarcodeScan({ onFound, onBack }) {
  const videoRef = useRef(null);
  const [msg, setMsg] = useState("Starting camera…");
  useEffect(() => {
    let stop = null, live = true;
    startBarcodeScan(videoRef.current, async (code) => {
      if (!live) return;
      setMsg(`Found ${code}. Looking it up…`);
      try {
        const f = await lookupBarcode(code);
        if (!live) return;
        if (f) onFound(f); else setMsg(`No product found for ${code}. Try searching by name.`);
      } catch {
        if (live) setMsg("Couldn't reach Open Food Facts. Check your connection.");
      }
    })
      .then((s) => { stop = s; if (live) setMsg("Point the camera at the barcode."); else s(); })
      .catch(() => live && setMsg("The camera couldn't start. Allow camera access, or type the barcode instead."));
    return () => { live = false; stop?.(); };
  }, [onFound]);
  return (
    <div style={st.stack}>
      <video ref={videoRef} muted playsInline style={st.video} aria-label="Camera view for scanning a barcode" />
      <span role="status" style={st.note}>{msg}</span>
      <button type="button" onClick={onBack} style={st.secondaryBtn}>Back</button>
    </div>
  );
}

const st = {
  section: { background: raised, border: `1px solid ${line}`, borderLeft: `3px solid ${plum}`, borderRadius: 4, padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 10, marginTop: 16 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { fontFamily: condensed, fontWeight: 700, fontSize: 19, letterSpacing: "0.06em", color: plum },
  addBtn: { fontFamily: mono, fontSize: 12, border: `1px solid ${plum}`, borderRadius: 3, padding: "4px 10px" },
  totals: { display: "flex", flexDirection: "column", gap: 6 },
  meters: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 },
  meter: { display: "flex", flexDirection: "column", gap: 4 },
  meterTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 },
  meterLabel: { fontSize: 12, color: inkFaint },
  meterValue: { fontFamily: sans, fontWeight: 600, fontSize: 16, color: ink },
  meterOf: { fontWeight: 400, fontSize: 12, color: inkFaint },
  track: { height: 8, background: plumSoft, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", background: plum, borderRadius: 4 },
  meterNote: { fontFamily: mono, fontSize: 11, color: inkFaint },
  macroLine: { fontFamily: mono, fontSize: 11, color: inkFaint, display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" },
  linkBtn: { fontFamily: mono, fontSize: 11, color: plum, background: "none", border: "none", padding: 0, textDecoration: "underline" },
  targetForm: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" },
  rows: { display: "flex", flexDirection: "column", gap: 6 },
  empty: { fontSize: 13, color: inkFaint, fontStyle: "italic" },
  row: { display: "flex", alignItems: "center", gap: 8, background: `color-mix(in srgb, ${plumSoft} 33%, transparent)`, borderRadius: 3, padding: "7px 9px" },
  rowName: { fontSize: 14, color: ink, overflowWrap: "anywhere" },
  rowMeta: { fontFamily: mono, fontSize: 11, color: inkFaint, overflowWrap: "anywhere" },
  rowKcal: { fontFamily: mono, fontSize: 13, color: ink, flexShrink: 0 },
  editBtn: { background: "none", border: "none", color: inkFaint, fontSize: 15, lineHeight: 1, padding: "0 2px" },
  deleteBtn: { background: "none", border: "none", color: inkFaint, fontSize: 18, lineHeight: 1, padding: "0 2px" },
  addBox: { display: "flex", flexDirection: "column", gap: 10, background: paper, border: `1px solid ${line}`, borderRadius: 4, padding: 10 },
  stack: { display: "flex", flexDirection: "column", gap: 8 },
  fieldLabel: { fontFamily: mono, fontSize: 11, color: inkFaint, display: "flex", flexDirection: "column", gap: 3 },
  input: { fontFamily: sans, fontSize: 14, padding: "7px 8px", border: `1px solid ${line}`, borderRadius: 3, background: C.field, color: ink },
  resultGroup: { display: "flex", flexDirection: "column", gap: 4 },
  groupLabel: { fontFamily: mono, fontSize: 10, letterSpacing: "0.12em", color: inkFaint, textTransform: "uppercase" },
  resultList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 },
  result: { width: "100%", textAlign: "left", display: "flex", flexDirection: "column", gap: 1, background: raised, border: `1px solid ${line}`, borderRadius: 3, padding: "7px 9px" },
  resultName: { fontFamily: sans, fontSize: 13, color: ink },
  resultMeta: { fontFamily: mono, fontSize: 10, color: inkFaint },
  optionRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  inline: { display: "flex", flexDirection: "column", gap: 4 },
  btnRow: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "flex-end" },
  primaryBtn: { fontFamily: mono, fontSize: 12, color: C.onFill, background: plum, border: `1px solid ${plum}`, borderRadius: 3, padding: "7px 12px" },
  secondaryBtn: { fontFamily: mono, fontSize: 12, color: ink, background: "transparent", border: `1px solid ${line}`, borderRadius: 3, padding: "7px 10px", textAlign: "left" },
  pickedName: { fontFamily: sans, fontWeight: 600, fontSize: 15, color: ink },
  preview: { display: "flex", flexDirection: "column", gap: 2, fontSize: 13, color: ink, background: raised, borderRadius: 3, padding: "7px 9px" },
  grid3: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 },
  estRow: { display: "flex", gap: 8, alignItems: "center", background: raised, border: `1px solid ${line}`, borderRadius: 3, padding: "6px 8px" },
  fileBtn: { position: "relative", fontFamily: mono, fontSize: 12, color: ink, border: `1px solid ${ink}`, borderRadius: 3, padding: "6px 10px", cursor: "pointer" },
  hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" },
  thumb: { position: "relative", width: 52, height: 52, borderRadius: 3, overflow: "hidden", border: `1px solid ${line}` },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  thumbX: { position: "absolute", right: 1, top: 1, width: 18, height: 18, borderRadius: "50%", border: "none", background: ink, color: C.onFill, fontSize: 12, lineHeight: 1, padding: 0 },
  video: { width: "100%", maxHeight: 280, background: ink, borderRadius: 4, objectFit: "cover" },
  flash: { fontSize: 13, color: plum },
  note: { fontFamily: mono, fontSize: 11, color: inkFaint },
  error: { fontFamily: mono, fontSize: 11, color: C.rust },
};
