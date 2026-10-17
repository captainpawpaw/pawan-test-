import React, { useEffect, useMemo, useRef, useState } from "react";
import { C } from "./theme";
import {
  NUTRIENTS, MACRO_LABEL, MACRO_UNIT, scale, sumFood, loadFoods, searchFoods,
  onlineLookupsAllowed, searchOpenFoodFacts, lookupBarcode, searchUsdaOnline, usdaOnlineKnownOff,
  cameraAllowed, startBarcodeScan, claudeEstimateAvailable, claudePhotoLimits, estimateWithClaude,
} from "./food";
import { withSpoons } from "./spoons.js";
import { readLabelOnDevice, readLabelWithClaude, claudeLabelAvailable, thumbnail } from "./labelReader";
import { missingLabel } from "./labelParse.js";

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

const SOURCE_LABEL = { mine: "My foods", cofid: "UK CoFID", usda: "USDA", "usda-online": "USDA online", off: "Open Food Facts", claude: "Claude estimate", custom: "Your entry" };
const fmtG = (n) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;

// entries: this day's food; recent: foods logged before (newest first);
// onAdd(list) adds one or more entries to the day.
// A day's food in four parts. Entries carry slot: breakfast | lunch | dinner | snacks.
export const SLOTS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snacks", "Snacks"]];
const SLOT_IDS = new Set(SLOTS.map(([id]) => id));

export default function FoodLog({ entries, recent, onAdd, onDelete, onEdit, targets, onSaveTargets, saveError, myFoods = [], onSaveMyFood, onRemoveMyFood, meals = [], onSaveMeal, onRemoveMeal }) {
  const [addingSlot, setAddingSlot] = useState(null);
  // Parts stay folded to one line unless in use: one open at a time, and
  // a part folds again when you're done adding to it.
  const [openSlot, setOpenSlot] = useState(null);
  const setOpen = (slot, open) => setOpenSlot((cur) => (open ? slot : cur === slot ? null : cur));
  const finishAdding = (slot) => { setAddingSlot(null); setOpen(slot, false); };
  const [savingMealSlot, setSavingMealSlot] = useState(null);
  const [mealMsg, setMealMsg] = useState({ slot: null, text: "" });
  const [editingId, setEditingId] = useState(null);
  const totals = useMemo(() => sumFood(entries), [entries]);
  const list = entries || [];
  // Foods logged before the day was split into meals.
  const unsorted = list.filter((e) => !SLOT_IDS.has(e.slot));

  const row = (e) => (
    <React.Fragment key={e.id}>
      <div style={{ ...st.row, ...(editingId === e.id ? { outline: `2px solid ${plum}`, outlineOffset: -2 } : {}) }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={st.rowName}>{e.name}</div>
          <div style={st.rowMeta}>
            {e.qty && e.portion ? `${fmtG(e.qty)} × ${e.portion} · ` : ""}{e.grams > 0 ? `${fmtG(e.grams)} g · ` : ""}P {fmtG(e.protein)} · C {fmtG(e.carbs)} · F {fmtG(e.fat)}
            {e.estimate ? " · ≈ estimate" : ""}{e.meal ? ` · ${e.meal}` : ""}
          </div>
        </div>
        <span style={st.rowKcal}>{Math.round(e.kcal)} kcal</span>
        {onEdit && (
          <button aria-label={`Edit ${e.name}`} onClick={() => setEditingId(editingId === e.id ? null : e.id)} style={st.editBtn}>✎</button>
        )}
        <button aria-label={`Delete ${e.name}`} onClick={() => { if (editingId === e.id) setEditingId(null); onDelete(e.id); }} style={st.deleteBtn}>×</button>
      </div>
      {editingId === e.id && (
        <EditFood entry={e} onSave={(next) => { onEdit(e.id, next); setEditingId(null); if (next.slot && next.slot !== e.slot) setOpen(next.slot, true); }} onCancel={() => setEditingId(null)} />
      )}
    </React.Fragment>
  );

  return (
    <div className="ft-card" style={st.section}>
      <div style={st.head}>
        <span style={st.title}>FOOD</span>
      </div>

      <Totals totals={totals} targets={targets} onSaveTargets={onSaveTargets} />
      {saveError && <div role="alert" style={st.error}>Not saved — try again</div>}

      {SLOTS.map(([slot, label]) => {
        const items = list.filter((e) => e.slot === slot);
        const sub = sumFood(items);
        const adding = addingSlot === slot;
        const open = adding || (openSlot === slot && items.length > 0);
        return (
          <section key={slot} aria-label={label} style={st.slot}>
            <div style={st.slotHead}>
              <button
                type="button"
                onClick={() => { if (!items.length) return; if (adding) finishAdding(slot); else setOpen(slot, openSlot !== slot); }}
                aria-expanded={items.length ? open : undefined}
                aria-controls={`food-${slot}`}
                disabled={!items.length}
                style={st.slotToggle}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={st.slotTitle}>{label}</span>
                    {items.length > 0 && (
                      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" style={{ ...st.chev, transform: open ? "rotate(90deg)" : "none" }}>
                        <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {items.length > 0 && <span style={st.slotSum}>{`${items.length} item${items.length === 1 ? "" : "s"} · ${sub.kcal} kcal · P ${fmtG(sub.protein)} g`}</span>}
                </span>
              </button>
              <button
                onClick={() => { if (adding) finishAdding(slot); else { setAddingSlot(slot); setOpen(slot, true); } }}
                aria-expanded={adding}
                aria-label={adding ? `Close adding to ${label}` : `+ Add to ${label}`}
                style={{ ...st.addBtn, color: adding ? C.onFill : plum, background: adding ? plum : "transparent" }}
              >
                {adding ? "Close" : "+ Add"}
              </button>
            </div>
            {adding && (
              <AddFood
                slotLabel={label}
                recent={recent}
                onAdd={(foods) => onAdd(foods.map((f) => ({ ...f, slot })))}
                onDone={() => finishAdding(slot)}
                myFoods={myFoods} onSaveMyFood={onSaveMyFood} onRemoveMyFood={onRemoveMyFood}
                meals={meals} onRemoveMeal={onRemoveMeal}
              />
            )}
            {open && items.length > 0 && <div id={`food-${slot}`} style={st.rows}>{items.map(row)}</div>}
            {open && onSaveMeal && items.length > 0 && savingMealSlot !== slot && (
              <div style={st.btnRow}>
                <button type="button" onClick={() => { setSavingMealSlot(slot); setMealMsg({ slot: null, text: "" }); }} style={st.linkBtn}>Save {label.toLowerCase()} as a meal</button>
                {mealMsg.slot === slot && <span role="status" style={st.flash}>{mealMsg.text}</span>}
              </div>
            )}
            {savingMealSlot === slot && (
              <SaveMeal
                entries={items}
                defaultName={label}
                onSave={async (name, chosen) => {
                  const saved = await onSaveMeal(name, chosen);
                  if (saved) { setSavingMealSlot(null); setMealMsg({ slot, text: `Saved ${saved.name} (${saved.items.length} food${saved.items.length === 1 ? "" : "s"}). Add it from + Add next time.` }); }
                  return Boolean(saved);
                }}
                onCancel={() => setSavingMealSlot(null)}
              />
            )}
          </section>
        );
      })}

      {unsorted.length > 0 && (
        <section aria-label="Not sorted" style={st.slot}>
          <div style={st.slotHead}>
            <span style={st.slotTitle}>Not sorted</span>
            <span style={st.slotSum}>{sumFood(unsorted).kcal} kcal</span>
          </div>
          <span style={st.note}>Logged before meals were split up. Tap ✎ to move one to a meal.</span>
          <div style={st.rows}>{unsorted.map(row)}</div>
        </section>
      )}
      {!list.length && <div style={st.empty}>No food logged for this day.</div>}
    </div>
  );
}

/* ---------- meals ---------- */
const mealTotals = (items) => sumFood(items);

function SaveMeal({ entries, defaultName = "", onSave, onCancel }) {
  const [name, setName] = useState(defaultName);
  const [picked, setPicked] = useState(() => Object.fromEntries(entries.map((e) => [e.id, true])));
  const [err, setErr] = useState("");
  const chosen = entries.filter((e) => picked[e.id]);
  const t = mealTotals(chosen);
  const submit = async (ev) => {
    ev.preventDefault();
    if (!name.trim() || !chosen.length) return;
    if (!(await onSave(name, chosen))) setErr("Couldn't save it. Try again.");
  };
  return (
    <form onSubmit={submit} style={st.addBox} aria-label="Save as meal">
      <span style={st.pickedName}>Save as meal</span>
      <label style={st.fieldLabel}>Meal name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Breakfast" autoFocus style={st.input} /></label>
      <div role="group" aria-label="Foods in the meal" style={st.stack}>
        {entries.map((e) => (
          <label key={e.id} style={st.estRow}>
            <input type="checkbox" checked={Boolean(picked[e.id])} onChange={(ev) => setPicked((p) => ({ ...p, [e.id]: ev.target.checked }))} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={st.rowName}>{e.name}</span>
              <span style={{ ...st.rowMeta, display: "block" }}>{e.qty && e.portion ? `${fmtG(e.qty)} × ${e.portion}` : `${fmtG(e.grams)} g`} · {Math.round(e.kcal)} kcal</span>
            </span>
          </label>
        ))}
      </div>
      <span style={st.note}>{chosen.length} food{chosen.length === 1 ? "" : "s"} · {t.kcal} kcal · P {fmtG(t.protein)} g · C {fmtG(t.carbs)} g · F {fmtG(t.fat)} g</span>
      {err && <span role="alert" style={st.error}>{err}</span>}
      <div style={st.btnRow}>
        <button type="submit" disabled={!name.trim() || !chosen.length} style={st.primaryBtn}>Save meal</button>
        <button type="button" onClick={onCancel} style={st.secondaryBtn}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------- totals and targets ---------- */
// Counts down: the big number is what's left of the target, and the bar
// empties as you eat. Without a target it shows the total eaten.
function Meter({ label, value, target, unit }) {
  const left = target ? Math.round((target - value) * 10) / 10 : null;
  const over = left != null && left < 0;
  const pct = target ? Math.max(0, Math.min(100, (left / target) * 100)) : 0;
  return (
    <div style={st.meter}>
      <div style={st.meterTop}>
        <span style={st.meterLabel}>{label}</span>
        <span style={{ ...st.meterValue, ...(over ? { color: C.rust } : {}) }}>
          {target ? <>{fmtG(Math.abs(left))}<span style={st.meterOf}> {unit} {over ? "over" : "left"}</span></> : <>{fmtG(value)}<span style={st.meterOf}> {unit}</span></>}
        </span>
      </div>
      {target ? (
        <>
          <div style={st.track} role="meter" aria-label={`${label} left`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.max(0, left)} aria-valuetext={over ? `${fmtG(-left)} ${unit} over target` : `${fmtG(left)} ${unit} left of ${fmtG(target)}`}>
            <div style={{ ...st.fill, width: `${pct}%` }} />
          </div>
          <span style={st.meterNote}>{fmtG(value)} eaten of {fmtG(target)} {unit}</span>
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
// A saved food, ready to pick: "Name (Brand)", with spoons.
export function myFoodToPick(f) {
  return withSpoons({ id: f.id, name: f.brand ? `${f.name} (${f.brand})` : f.name, group: "My foods", source: "mine", per100: f.per100, portions: f.portions || [], barcode: f.barcode, thumb: f.thumb, lower: `${f.name} ${f.brand || ""}`.toLowerCase() });
}

function AddFood({ slotLabel, recent, onAdd, onDone, myFoods, onSaveMyFood, onRemoveMyFood, meals, onRemoveMeal }) {
  const [mode, setMode] = useState("search"); // search | amount | claude | manual | scan | label
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
      {mode === "search" && (
        <FoodSearch
          recent={recent} onPick={pick} onMode={setMode} myFoods={myFoods} onRemoveMyFood={onRemoveMyFood}
          meals={meals} onRemoveMeal={onRemoveMeal}
          onAddMeal={(m) => { onAdd(m.items.map((it) => ({ ...it, meal: m.name }))); setFlash(`Added ${m.name}: ${m.items.length} food${m.items.length === 1 ? "" : "s"}.`); }}
        />
      )}
      {mode === "label" && (
        <LabelCapture
          onSave={onSaveMyFood}
          onSaved={(saved, addNow) => {
            if (addNow) pick(myFoodToPick(saved));
            else { setFlash(`Saved ${saved.name} to My foods.`); setMode("search"); }
          }}
          onBack={() => setMode("search")}
        />
      )}
      {mode === "amount" && picked && <AmountStep food={picked} onAdd={added} onBack={() => setMode("search")} />}
      {mode === "manual" && <ManualFood onAdd={added} onBack={() => setMode("search")} />}
      {mode === "claude" && <ClaudeEstimate onAdd={(items) => { onAdd(items); setFlash(`Added ${items.length} item${items.length === 1 ? "" : "s"} from Claude's estimate.`); setMode("search"); }} onBack={() => setMode("search")} />}
      {mode === "scan" && <BarcodeScan onFound={pick} onBack={() => setMode("search")} myFoods={myFoods} />}
      <button type="button" onClick={onDone} style={{ ...st.linkBtn, alignSelf: "flex-end" }}>Done adding</button>
      <span style={st.note}>UK foods: McCance and Widdowson’s CoFID 2021. Contains public sector information licensed under the Open Government Licence v3.0.</span>
    </div>
  );
}

// A barcode you've saved a food under comes back as that food.
function mineByBarcode(myFoods, code) {
  const c = String(code).replace(/\D/g, "");
  const f = (myFoods || []).find((m) => m.barcode && m.barcode.replace(/\D/g, "") === c);
  return f ? myFoodToPick(f) : null;
}

function FoodSearch({ recent, onPick, onMode, myFoods = [], onRemoveMyFood, meals = [], onRemoveMeal, onAddMeal }) {
  const [q, setQ] = useState("");
  const [foods, setFoods] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [off, setOff] = useState({ state: "idle", list: [], q: "" });
  const [usda, setUsda] = useState({ list: [], q: "" });
  const [barcode, setBarcode] = useState("");
  const [barcodeMsg, setBarcodeMsg] = useState("");
  const [canClaude, setCanClaude] = useState(false);
  // My foods and Recent fold to one line until opened; a search shows their matches.
  const [openGroups, setOpenGroups] = useState({});
  const searching = q.trim().length > 0;
  const groupOpen = (key) => searching || Boolean(openGroups[key]);
  const toggleGroup = (key) => setOpenGroups((g) => ({ ...g, [key]: !g[key] }));
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
  const mealHits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const text = (m) => `${m.name} ${m.items.map((it) => it.name).join(" ")}`.toLowerCase();
    return (words.length ? meals.filter((m) => words.every((w) => text(m).includes(w))) : meals).slice(0, 6);
  }, [meals, q]);
  const myHits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = myFoods.map(myFoodToPick);
    return (words.length ? list.filter((f) => words.every((w) => f.lower.includes(w))) : list).slice(0, words.length ? 8 : 6);
  }, [myFoods, q]);
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
    const mine = mineByBarcode(myFoods, barcode);
    if (mine) { setBarcodeMsg(""); onPick(mine); return; }
    setBarcodeMsg("Looking up…");
    try {
      const f = await lookupBarcode(barcode);
      if (f) { setBarcodeMsg(""); onPick(f); } else setBarcodeMsg("No product found for that barcode. Try searching by name.");
    } catch {
      setBarcodeMsg("Couldn't reach Open Food Facts. Check your connection.");
    }
  };

  // A group's heading; with `fold` it's a button that opens and closes the group.
  const GroupHead = ({ label, count, fold }) => fold && !searching ? (
    <button type="button" aria-expanded={groupOpen(fold)} onClick={() => toggleGroup(fold)} style={st.groupToggle}>
      <span>{label}</span>
      <span style={st.groupCount}>{count}</span>
      <span aria-hidden="true" style={{ ...st.groupChev, transform: groupOpen(fold) ? "rotate(90deg)" : "none" }}>›</span>
    </button>
  ) : <span style={st.groupLabel}>{label}</span>;

  const ResultList = ({ items, label, fold }) => items.length ? (
    <div style={st.resultGroup}>
      <GroupHead label={label} count={items.length} fold={fold} />
      {(!fold || groupOpen(fold)) && <ul style={st.resultList}>
        {items.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onPick(f)} style={st.result}>
              <span style={st.resultName}>{f.name}</span>
              <span style={st.resultMeta}>{f.per100.kcal} kcal · P {fmtG(f.per100.protein)} g per 100 g{f.group ? ` · ${f.group}` : ""}{f.source === "cofid" ? " · UK" : f.source === "usda" ? " · US" : ""}</span>
            </button>
          </li>
        ))}
      </ul>}
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

      <div style={st.optionRow}>
        <button type="button" onClick={() => onMode("label")} style={st.secondaryBtn}>Photograph a label</button>
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

      {online && (
        // Always here, above the suggestions: search Open Food Facts for branded products.
        <div style={st.resultGroup}>
          <button type="button" disabled={q.trim().length < 2 || (off.q === q && off.state === "busy")} onClick={searchOff} style={{ ...st.secondaryBtn, width: "100%", textAlign: "center" }}>
            {q.trim().length >= 2 ? <>Search branded products for “{q.trim()}”</> : "Search branded products (type a name above)"}
          </button>
          {off.q === q && off.state === "busy" ? (
            <span style={st.note}>Searching Open Food Facts…</span>
          ) : off.q === q && off.state === "error" ? (
            <span style={st.error}>Couldn't reach Open Food Facts. Try again in a minute.</span>
          ) : off.q === q && off.state === "done" ? (
            off.list.length ? (
              <>
                <ResultList items={off.list} label="Branded products (Open Food Facts)" />
                <span style={st.note}>Product data © Open Food Facts contributors, ODbL. Check the label if a value looks wrong.</span>
              </>
            ) : (
              <span style={st.note}>No branded products found.</span>
            )
          ) : null}
        </div>
      )}

      {mealHits.length > 0 && onAddMeal && (
        <div style={st.resultGroup}>
          <span style={st.groupLabel}>Meals · one tap adds them all</span>
          <ul style={st.resultList}>
            {mealHits.map((m) => {
              const t = mealTotals(m.items);
              return (
                <li key={m.id} style={st.mineRow}>
                  <button type="button" onClick={() => onAddMeal(m)} aria-label={`Add meal ${m.name}`} style={{ ...st.result, flex: 1, minWidth: 0 }}>
                    <span style={st.resultName}>{m.name}</span>
                    <span style={st.resultMeta}>{m.items.map((it) => it.name.replace(/\s*\(.*\)$/, "").split(",")[0]).join(" + ")}</span>
                    <span style={st.resultMeta}>{t.kcal} kcal · P {fmtG(t.protein)} g · {m.items.length} food{m.items.length === 1 ? "" : "s"}</span>
                  </button>
                  {onRemoveMeal && (
                    <button type="button" aria-label={`Remove meal ${m.name}`} onClick={() => { if (window.confirm(`Remove the meal ${m.name}? Days you've already logged keep their foods.`)) onRemoveMeal(m.id); }} style={st.deleteBtn}>×</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {myHits.length > 0 && (
        <div style={st.resultGroup}>
          <GroupHead label="My foods" count={myHits.length} fold="mine" />
          {groupOpen("mine") && <ul style={st.resultList}>
            {myHits.map((f) => (
              <li key={f.id} style={st.mineRow}>
                <button type="button" onClick={() => onPick(f)} style={{ ...st.result, flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  {f.thumb ? <img src={f.thumb} alt="" style={st.mineThumb} /> : <span aria-hidden="true" style={st.mineThumb} />}
                  <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                    <span style={st.resultName}>{f.name}</span>
                    <span style={st.resultMeta}>{f.portions[0]?.values ? `${f.portions[0].values.kcal} kcal · P ${fmtG(f.portions[0].values.protein)} g per ${f.portions[0].label.replace(/^1\s+/, "")}` : `${f.per100.kcal} kcal · P ${fmtG(f.per100.protein)} g per 100 g`}</span>
                  </span>
                </button>
                {onRemoveMyFood && (
                  <button type="button" aria-label={`Remove ${f.name} from My foods`} onClick={() => { if (window.confirm(`Remove ${f.name} from My foods? Days you've already logged keep it.`)) onRemoveMyFood(f.id); }} style={st.deleteBtn}>×</button>
                )}
              </li>
            ))}
          </ul>}
        </div>
      )}
      <ResultList items={recentHits} label={q.trim() ? "Logged before" : "Recent"} fold="recent" />
      <ResultList items={local.slice(0, 15)} label="Foods (UK CoFID and USDA)" />
      <ResultList items={usdaShown} label="More from USDA online" />
      {q.trim().length >= 2 && foods && !local.length && !recentHits.length && <span style={st.note}>No match in the built-in list.</span>}

    </div>
  );
}

function servingTimes(values, qty) {
  return Object.fromEntries(NUTRIENTS.map((k) => [k, k === "kcal" ? Math.round((values[k] || 0) * qty) : Math.round((values[k] || 0) * qty * 10) / 10]));
}

function AmountStep({ food, onAdd, onBack }) {
  const units = useMemo(() => [{ g: 1, label: "g" }, ...(food.portions || [])], [food]);
  const [unit, setUnit] = useState(food.portions?.length && food.source !== "usda" && food.source !== "cofid" ? 1 : 0);
  const [qty, setQty] = useState(food.lastGrams && unit === 0 ? String(food.lastGrams) : unit === 0 ? "100" : "1");
  const grams = (Number(qty) || 0) * units[unit].g;
  // A saved serving carries the label's own numbers: use them as printed.
  const vals = units[unit].values ? servingTimes(units[unit].values, Number(qty) || 0) : scale(food.per100, grams);

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
        <div style={st.note}>{SOURCE_LABEL[food.source] || ""} · {food.portions?.[0]?.values ? `${food.portions[0].values.kcal} kcal per ${food.portions[0].label.replace(/^1\s+/, "")} · ` : ""}{food.per100.kcal} kcal per 100 g</div>
      </div>
      <div style={st.btnRow}>
        <label style={{ ...st.fieldLabel, flex: "0 0 90px" }}>
          Amount
          <input type="number" inputMode="decimal" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus style={{ ...st.input, width: "100%", boxSizing: "border-box" }} />
        </label>
        <label style={{ ...st.fieldLabel, flex: 1, minWidth: 0 }}>
          Unit
          <select value={unit} onChange={(e) => { const u = Number(e.target.value); setUnit(u); setQty(u === 0 ? "100" : "1"); }} style={{ ...st.input, width: "100%", boxSizing: "border-box" }}>
            {units.map((u, i) => <option key={i} value={i}>{i === 0 ? "grams" : `${u.label} (${u.approx ? "≈ " : ""}${fmtG(u.g)} g)`}</option>)}
          </select>
        </label>
      </div>
      {units[unit].approx && (
        <div style={st.note}>
          Spoon weight is an estimate{units[unit].how === "similar" ? ", from a similar food’s measured weight" : ", from a typical density for this kind of food"}. Level spoon: 1 tbsp = 15 ml, 1 tsp = 5 ml.
        </div>
      )}
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
  const [slot, setSlot] = useState(SLOT_IDS.has(entry.slot) ? entry.slot : "");
  const [unit, setUnit] = useState(hasPortion ? "portion" : "g");
  const [qty, setQty] = useState(String(hasPortion ? entry.qty : entry.grams || ""));
  const [nums, setNums] = useState({ kcal: String(entry.kcal ?? ""), protein: String(entry.protein ?? ""), carbs: String(entry.carbs ?? ""), fat: String(entry.fat ?? "") });
  const scalable = Boolean(entry.per100);
  const grams = unit === "portion" ? (Number(qty) || 0) * portionG : Number(qty) || 0;
  const vals = scalable ? scale(entry.per100, grams) : null;

  const save = (ev) => {
    ev.preventDefault();
    const base = { ...entry, name: name.trim() || entry.name };
    if (slot) base.slot = slot;
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
      <div style={st.labelGrid}>
        <label style={st.fieldLabel}>Name<input value={name} onChange={(e) => setName(e.target.value)} style={st.input} /></label>
        <label style={st.fieldLabel}>
          Meal
          <select aria-label="Meal" value={slot} onChange={(e) => setSlot(e.target.value)} style={st.input}>
            {!slot && <option value="">Choose…</option>}
            {SLOTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>
      {scalable ? (
        <>
          <div style={st.btnRow}>
            <label style={{ ...st.fieldLabel, flex: "0 0 90px" }}>
              Amount
              <input type="number" inputMode="decimal" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus style={{ ...st.input, width: "100%", boxSizing: "border-box" }} />
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

/* ---------- a food from photos of its label ---------- */
const LABEL_FIELDS = [["kcal", "Calories (kcal)"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fat", "Fat (g)"], ["fibre", "Fibre (g)"], ["sugar", "Sugar (g)"]];

function LabelCapture({ onSave, onSaved, onBack }) {
  const [photos, setPhotos] = useState([]); // [{ file, url }]
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(null); // review step
  const [useClaude, setUseClaude] = useState(false);
  const [saving, setSaving] = useState(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const ctlRef = useRef(null);

  useEffect(() => {
    let live = true;
    if (!onlineLookupsAllowed()) claudeLabelAvailable().then((ok) => live && setUseClaude(ok));
    return () => { live = false; ctlRef.current?.abort(); photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)); };
  }, []);

  const addPhotos = (files) => {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    setPhotos((cur) => [...cur, ...imgs.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 4));
  };

  const toForm = (r) => ({
    name: r.name || "",
    brand: r.brand || "",
    servingG: r.servingG ? String(r.servingG) : "",
    servingGDerived: Boolean(r.servingGDerived),
    servingLabel: r.servingLabel || "1 serving",
    barcode: r.barcode || "",
    // Two columns, as on the label: per serving (first) and per 100 g.
    ...Object.fromEntries(LABEL_FIELDS.map(([k]) => [`s_${k}`, r.perServing?.[k] != null ? String(r.perServing[k]) : ""])),
    ...Object.fromEntries(LABEL_FIELDS.map(([k]) => [k, r.per100?.[k] != null ? String(r.per100[k]) : ""])),
    missing: r.missing || [],
    sources: r.sources || [],
    note: r.note || "",
    kcalEstimated: Boolean(r.kcalEstimated),
  });

  const read = async () => {
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    const files = photos.map((p) => p.file);
    try {
      if (useClaude) {
        setStatus({ kind: "busy", text: "Claude is reading the label…" });
        setForm(toForm(await readLabelWithClaude(files, { signal: ctl.signal })));
      } else {
        setStatus({ kind: "busy", text: "Reading the label…" });
        const r = await readLabelOnDevice(files, {
          onProgress: (p) => {
            if (ctl.signal.aborted) return;
            const text = p.step === "barcode" ? "Looking for a barcode…"
              : p.step === "load" ? "Getting the label reader ready (the first time takes a little longer)…"
              : p.step === "lookup" ? "Found a barcode. Checking Open Food Facts…"
              : `Reading photo ${p.photo} of ${p.of}… ${Math.round((p.progress || 0) * 100)}%`;
            setStatus({ kind: "busy", text });
          },
        });
        if (ctl.signal.aborted) return;
        setForm(toForm(r));
      }
      setStatus(null);
    } catch (e) {
      if (e?.code === "cancelled" || ctl.signal.aborted) return;
      setStatus({ kind: "error", text: e?.code === "not_granted" ? "Claude wasn't allowed to help here. Fill the numbers in below." : "Couldn't read the label. Fill the numbers in below, or try a sharper, closer photo." });
      setForm(toForm({ missing: NUTRIENTS }));
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (v) => (v === "" || v == null ? null : Number(v));
  // Both columns filled out from each other where the serving weight allows.
  const columns = (f) => {
    const g = num(f.servingG) > 0 ? num(f.servingG) : null;
    const serving = {}, per100 = {};
    for (const [k] of LABEL_FIELDS) {
      const sv = num(f[`s_${k}`]), pv = num(f[k]);
      const round = (v) => (k === "kcal" ? Math.round(v) : Math.round(v * 10) / 10);
      serving[k] = sv != null ? sv : pv != null && g ? round((pv * g) / 100) : null;
      per100[k] = pv != null ? pv : sv != null && g ? round((sv / g) * 100) : null;
    }
    return { g, serving, per100 };
  };
  const cols = form ? columns(form) : null;
  const hasServing = form && LABEL_FIELDS.some(([k]) => form[`s_${k}`] !== "");
  const needsGrams = form && hasServing && !cols.g;
  const valid = form && form.name.trim() && (cols.per100.kcal != null || cols.serving.kcal != null) && !needsGrams;

  const save = async (addNow) => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const { g, serving, per100 } = columns(form);
      const zero = (o) => Object.fromEntries(LABEL_FIELDS.map(([k]) => [k, Math.max(0, o[k] || 0)]));
      const thumb = photos[0] ? await thumbnail(photos[0].file).catch(() => null) : null;
      const label = form.servingLabel.trim() || "1 serving";
      const saved = await onSave({
        name: form.name.trim().slice(0, 80),
        brand: form.brand.trim().slice(0, 60),
        per100: zero(per100),
        // The serving, with the label's own numbers, comes first when adding.
        portions: g ? [{ g, label: label.slice(0, 40), values: zero(serving) }] : [],
        barcode: form.barcode.replace(/\D/g, "") || null,
        thumb,
        from: form.sources.join(",") || "manual",
      });
      if (saved) onSaved(saved, addNow);
      else setStatus({ kind: "error", text: "Couldn't save it. Try again." });
    } finally {
      setSaving(false);
    }
  };

  if (form) {
    const missing = form.missing.filter((k) => form[k] === "" && form[`s_${k}`] === "");
    const servingTitle = (form.servingLabel.trim() || "1 serving").replace(/^1\s+/, "");
    return (
      <form onSubmit={(e) => { e.preventDefault(); save(true); }} style={st.stack} aria-label="Check the label details">
        <span style={st.pickedName}>Check the details</span>
        <span style={st.note}>
          {form.sources.includes("claude") ? "Read by Claude from your photos." : form.sources.includes("label") ? "Read from your photos." : ""}
          {form.sources.includes("off") ? " Name and gaps filled from Open Food Facts (barcode " + form.barcode + ")." : ""}
          {" "}Check them against the label before saving.{form.note ? ` ${form.note}` : ""}
        </span>
        {status && <span role={status.kind === "error" ? "alert" : "status"} style={status.kind === "error" ? st.error : st.note}>{status.text}</span>}
        {missing.length > 0 && <span role="status" style={st.error}>Not found on the label: {missingLabel(missing)}. Fill these in, or leave blank for 0.</span>}
        {form.kcalEstimated && <span style={st.note}>Calories worked out from protein, carbs and fat.</span>}
        <label style={st.fieldLabel}>Name<input value={form.name} onChange={set("name")} placeholder="e.g. Crunchy granola" style={st.input} required /></label>
        <label style={st.fieldLabel}>Brand (optional)<input value={form.brand} onChange={set("brand")} placeholder="e.g. Jordans" style={st.input} /></label>
        <div style={st.labelGrid}>
          <label style={st.fieldLabel}>Serving<input value={form.servingLabel} onChange={set("servingLabel")} placeholder="1 slice" style={{ ...st.input, width: "100%", boxSizing: "border-box" }} /></label>
          <label style={st.fieldLabel}>
            Serving weight (g)
            <input type="number" inputMode="decimal" step="any" min="0" value={form.servingG} onChange={(e) => setForm((f) => ({ ...f, servingG: e.target.value, servingGDerived: false }))} placeholder="48" style={{ ...st.input, width: "100%", boxSizing: "border-box", ...(needsGrams ? { borderColor: C.rust } : {}) }} />
          </label>
        </div>
        {form.servingGDerived && form.servingG && <span style={st.note}>The label doesn’t print the serving’s weight; about {form.servingG} g, worked out from its two columns.</span>}
        {needsGrams && <span role="status" style={st.error}>Add the serving’s weight in grams, so other amounts can be worked out.</span>}
        <div role="table" aria-label="Nutrition" style={st.nutTable}>
          <div role="row" style={st.nutRow}>
            <span role="columnheader" style={st.nutHead}>Typical values</span>
            <span role="columnheader" style={{ ...st.nutHead, color: plum }}>Per {servingTitle}</span>
            <span role="columnheader" style={st.nutHead}>Per 100 g</span>
          </div>
          {LABEL_FIELDS.map(([k, label]) => {
            const flag = form.missing.includes(k) && form[k] === "" && form[`s_${k}`] === "" ? { borderColor: C.rust } : {};
            return (
              <div role="row" key={k} style={st.nutRow}>
                <span role="rowheader" style={st.nutName}>{label}</span>
                <input aria-label={`${label} per ${servingTitle}`} type="number" inputMode="decimal" step="any" min="0" value={form[`s_${k}`]} onChange={set(`s_${k}`)} placeholder={cols.serving[k] != null ? String(cols.serving[k]) : ""} style={{ ...st.input, width: "100%", boxSizing: "border-box", ...flag }} />
                <input aria-label={`${label} per 100 g`} type="number" inputMode="decimal" step="any" min="0" value={form[k]} onChange={set(k)} placeholder={cols.per100[k] != null ? String(cols.per100[k]) : ""} style={{ ...st.input, width: "100%", boxSizing: "border-box", ...flag }} />
              </div>
            );
          })}
        </div>
        <span style={st.note}>Grey numbers are worked out from the other column. When you add it, the serving comes first, with these exact numbers.</span>
        <label style={st.fieldLabel}>Barcode (optional)<input inputMode="numeric" value={form.barcode} onChange={set("barcode")} style={{ ...st.input, width: "100%", boxSizing: "border-box" }} /></label>
        <div style={st.btnRow}>
          <button type="submit" disabled={!valid || saving} style={st.primaryBtn}>Save and add to today</button>
          <button type="button" disabled={!valid || saving} onClick={() => save(false)} style={st.secondaryBtn}>Save to My foods</button>
          <button type="button" onClick={() => { setForm(null); setStatus(null); }} style={st.secondaryBtn}>Back to photos</button>
        </div>
        <span style={st.note}>Saved foods appear under My foods when you search, and on every device you sync.</span>
      </form>
    );
  }

  return (
    <div style={st.stack}>
      <span style={st.pickedName}>Photograph a label</span>
      <span style={st.note}>Take or choose photos of the pack: the front (for its name) and the nutrition label, close up and flat. Include the barcode if you can.</span>
      <div style={st.btnRow}>
        <label style={st.fileBtn}>
          Take a photo
          <input type="file" accept="image/*" capture="environment" onChange={(e) => { addPhotos(e.target.files || []); e.target.value = ""; }} style={st.hiddenInput} aria-label="Take a photo of the pack or label" />
        </label>
        <label style={st.fileBtn}>
          Choose photos
          <input type="file" accept="image/*" multiple onChange={(e) => { addPhotos(e.target.files || []); e.target.value = ""; }} style={st.hiddenInput} aria-label="Choose photos of the pack and label" />
        </label>
      </div>
      {photos.length > 0 && (
        <div style={st.btnRow}>
          {photos.map((p, i) => (
            <span key={p.url} style={st.thumb}>
              <img src={p.url} alt={`Pack photo ${i + 1}`} style={st.thumbImg} />
              <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => { URL.revokeObjectURL(p.url); setPhotos((cur) => cur.filter((x) => x.url !== p.url)); }} style={st.thumbX}>×</button>
            </span>
          ))}
        </div>
      )}
      {status && <span role={status.kind === "error" ? "alert" : "status"} aria-live="polite" style={status.kind === "error" ? st.error : st.note}>{status.text}</span>}
      <div style={st.btnRow}>
        <button type="button" disabled={!photos.length || status?.kind === "busy"} onClick={read} style={st.primaryBtn}>Read label</button>
        <button type="button" onClick={() => setForm(toForm({ missing: [] }))} style={st.secondaryBtn}>Type it in instead</button>
        <button type="button" onClick={onBack} style={st.secondaryBtn}>Back</button>
      </div>
      <span style={st.note}>{useClaude ? "Claude reads the photos (uses your Claude usage)." : "Read on this device; photos aren't uploaded. A barcode is looked up on Open Food Facts."}</span>
    </div>
  );
}

function BarcodeScan({ onFound, onBack, myFoods }) {
  const mineRef = useRef(myFoods);
  mineRef.current = myFoods;
  const videoRef = useRef(null);
  const [msg, setMsg] = useState("Starting camera…");
  useEffect(() => {
    let stop = null, live = true;
    startBarcodeScan(videoRef.current, async (code) => {
      if (!live) return;
      const mine = mineByBarcode(mineRef.current, code);
      if (mine) { onFound(mine); return; }
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
  groupToggle: { display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 40, padding: "6px 2px", fontFamily: mono, fontSize: 10, letterSpacing: "0.12em", color: inkFaint, textTransform: "uppercase", background: "transparent", border: "none", borderBottom: `1px solid ${line}`, textAlign: "left" },
  groupCount: { flex: 1, letterSpacing: 0, color: inkFaint, opacity: 0.8 },
  groupChev: { fontSize: 16, lineHeight: 1, transition: "transform 0.15s" },
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
  labelGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 },
  nutTable: { display: "flex", flexDirection: "column", gap: 4 },
  slot: { display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${line}`, paddingTop: 10 },
  slotHead: { display: "flex", alignItems: "center", gap: 8 },
  slotToggle: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, minHeight: 36, padding: 0, background: "none", border: "none", color: ink, textAlign: "left", cursor: "pointer" },
  chev: { flex: "none", color: inkFaint, transition: "transform 0.15s ease" },
  slotTitle: { fontFamily: condensed, fontWeight: 700, fontSize: 16, letterSpacing: "0.05em", textTransform: "uppercase", color: ink },
  slotSum: { fontFamily: mono, fontSize: 11, color: inkFaint },
  nutRow: { display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 6, alignItems: "center" },
  nutHead: { fontFamily: mono, fontSize: 11, fontWeight: 600, color: inkFaint },
  nutName: { fontFamily: mono, fontSize: 11, color: ink },
  mineRow: { display: "flex", alignItems: "center", gap: 4 },
  mineThumb: { width: 34, height: 34, flex: "none", borderRadius: 3, objectFit: "cover", background: plumSoft },
  note: { fontFamily: mono, fontSize: 11, color: inkFaint },
  error: { fontFamily: mono, fontSize: 11, color: C.rust },
};
