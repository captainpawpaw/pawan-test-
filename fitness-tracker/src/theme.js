// Colour themes. Components use the C.* values, which are CSS variables, so
// switching theme only changes the variables on <html>. Each theme's extra
// decoration (page background, masthead, cards) is in THEME_CSS, scoped by
// html[data-theme].
//
// Roles: ink = main text; inkFaint = secondary text; paper = page and inset
// panels; raised = cards; field = text boxes, menus, tooltips; line = borders;
// grid = chart grid; rust = strength; teal = cardio; plum = food; blue = reps
// beside strength weight; onFill = text on an ink or accent fill;
// highlight = milestone badges.

const SANS = "'Inter', sans-serif";
const DISPLAY = "'Barlow Condensed', sans-serif";

// Quiet's colours are CSS variables themselves (set in THEME_CSS), so it can
// follow the phone's light or dark setting.
const QUIET_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const q = (k) => `var(--q-${k})`;

export const THEMES = {
  // Nothing but the numbers: no boxes, no borders, one colour. Explanations,
  // tab names and secondary buttons show only while you are using them.
  quiet: {
    label: "Quiet",
    swatch: "linear-gradient(135deg, #FFFFFF 50%, #111111 50%)",
    scheme: "light dark",
    vars: {
      ink: q("ink"), inkFaint: q("faint"), paper: q("paper"), raised: q("paper"), field: q("paper"),
      line: q("line"), grid: q("grid"),
      rust: q("ink"), rustSoft: q("soft"), teal: q("ink"), tealSoft: q("soft"),
      plum: q("ink"), plumSoft: q("soft"), blue: q("faint"),
      onFill: q("paper"), highlight: q("soft"), highlightInk: q("ink"),
      sans: QUIET_SANS, display: QUIET_SANS,
    },
  },
  classic: {
    label: "Classic",
    swatch: "#EDE8DE",
    vars: {
      ink: "#23211D", inkFaint: "#706B5E", paper: "#EDE8DE", raised: "#F5F1E8", field: "#FFFFFF",
      line: "#D9D2C2", grid: "#E4DDCF",
      rust: "#B5551F", rustSoft: "#E0C4AC", teal: "#1F6E64", tealSoft: "#C3DAD5",
      plum: "#7A3E62", plumSoft: "#E6D3DD", blue: "#3F6FA8",
      onFill: "#F5F1E8", highlight: "#E0C4AC", highlightInk: "#23211D",
      sans: SANS, display: DISPLAY,
    },
  },
  // A physical notebook: ruled lines, a double red margin, a blueprint header.
  ledger: {
    label: "Ledger",
    swatch: "#FDFDFC",
    vars: {
      ink: "#1A1A1A", inkFaint: "#5F6670", paper: "#FDFDFC", raised: "#FFFFFF", field: "#FFFFFF",
      line: "#DCDCDC", grid: "#E6E8EB",
      rust: "#D34836", rustSoft: "#F5D0CA", teal: "#1D3B66", tealSoft: "#CBD5E3",
      plum: "#8A6436", plumSoft: "#D4B895", blue: "#1D3B66",
      onFill: "#FFFFFF", highlight: "#CCFF00", highlightInk: "#1A1A1A",
      sans: "'Courier New', Courier, monospace", display: DISPLAY,
    },
  },
  // Deep black, embossed panels, crimson accents.
  krypton: {
    label: "Krypton",
    swatch: "#111111",
    dark: true,
    vars: {
      ink: "#F0F0F0", inkFaint: "#9A9A9A", paper: "#050505", raised: "#111111", field: "#1A1A1A",
      line: "#2D2D2D", grid: "#222222",
      // #D31A1A is the crimson; text-sized red needs this lighter shade on black.
      rust: "#EF3B3B", rustSoft: "#4A1414", teal: "#8FB3D9", tealSoft: "#1C2A3A",
      plum: "#D29BD0", plumSoft: "#3A2238", blue: "#8FB3D9",
      onFill: "#0B0B0B", highlight: "#D31A1A", highlightInk: "#FFFFFF",
      sans: "'Segoe UI', system-ui, sans-serif", display: DISPLAY,
    },
  },
  // Stark slate, black slabs, hard shadows.
  gotham: {
    label: "Gotham Swarm",
    swatch: "#8F969B",
    vars: {
      ink: "#050505", inkFaint: "#262A2E", paper: "#A9AFB4", raised: "#C1C6CB", field: "#E4E7EA",
      line: "#5F666B", grid: "#A9AFB4",
      rust: "#050505", rustSoft: "#8F969B", teal: "#2F4A63", tealSoft: "#9FB0BF",
      plum: "#5A3A28", plumSoft: "#B8A898", blue: "#2F4A63",
      onFill: "#F5F5F5", highlight: "#F2C230", highlightInk: "#050505",
      sans: "'Helvetica Neue', Helvetica, Arial, sans-serif", display: DISPLAY,
    },
  },
  // Frosted glass over a mountain-sunset sky.
  alpine: {
    label: "Alpine Sunset",
    swatch: "linear-gradient(135deg, #2351D4 0%, #9253C6 45%, #F089B6 100%)",
    dark: true,
    vars: {
      ink: "#FFFFFF", inkFaint: "rgba(255, 255, 255, 0.82)", paper: "rgba(255, 255, 255, 0.10)", raised: "rgba(44, 37, 89, 0.4)",
      field: "rgba(36, 28, 84, 0.85)", line: "rgba(255, 255, 255, 0.3)", grid: "rgba(255, 255, 255, 0.18)",
      rust: "#FFD166", rustSoft: "rgba(255, 209, 102, 0.35)", teal: "#8BE9FD", tealSoft: "rgba(139, 233, 253, 0.3)",
      plum: "#FFC2E2", plumSoft: "rgba(255, 194, 226, 0.35)", blue: "#8BE9FD",
      onFill: "#2C2559", highlight: "#FFFFFF", highlightInk: "#5B2A86",
      sans: SANS, display: DISPLAY,
    },
  },
};

export const THEME_NAMES = Object.keys(THEMES);
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const C = Object.fromEntries(Object.keys(THEMES.classic.vars).map((k) => [k, `var(--ft-${kebab(k)})`]));

const KEY = "fitness-tracker:theme";
export function savedTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES[t] ? t : "quiet";
  } catch {
    return "quiet";
  }
}

export function applyTheme(name) {
  const t = THEMES[name] ? name : "quiet";
  const root = document.documentElement;
  for (const [k, v] of Object.entries(THEMES[t].vars)) root.style.setProperty(`--ft-${kebab(k)}`, v);
  root.dataset.theme = t;
  root.style.colorScheme = THEMES[t].scheme || (THEMES[t].dark ? "dark" : "light");
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  return t;
}

// Card borders: the left edge keeps its accent colour, so only the other
// three sides are restyled.
const sides = (c) => `border-top-color: ${c} !important; border-right-color: ${c} !important; border-bottom-color: ${c} !important;`;

export const THEME_CSS = `
  body { background: var(--ft-paper); font-family: var(--ft-sans); }
  /* Logo colours: as designed on light grounds, brighter on dark ones. */
  :root { --ft-logo-blue: #1E6FD9; --ft-logo-orange: #F26B1D; --ft-logo-red: #E8371E; --ft-logo-yellow: #F7A91B; --ft-logo-cyan: #19B9DC; }
  html[data-theme="ledger"] .ft-masthead, html[data-theme="krypton"], html[data-theme="gotham"] .ft-masthead, html[data-theme="alpine"] {
    --ft-logo-blue: #5B9BF0; --ft-logo-orange: #FF8A3D; --ft-logo-red: #FF5A3C; --ft-logo-yellow: #FFC233; --ft-logo-cyan: #33D1F0;
  }
  html[data-theme="krypton"] .ft-page, html[data-theme="gotham"] .ft-page,
  html[data-theme="alpine"] .ft-page, html[data-theme="ledger"] .ft-page { background: transparent !important; }

  /* Ledger */
  html[data-theme="ledger"] body {
    background-color: #FDFDFC;
    background-image: repeating-linear-gradient(transparent, transparent 27px, #E6E8EB 28px);
  }
  html[data-theme="ledger"] .ft-page { border-left: 4px double #E07A7A; padding-left: 20px !important; }
  html[data-theme="ledger"] .ft-masthead { color: #FFFFFF; background: #1D3B66; border-radius: 4px; padding: 12px 14px 14px; }
  html[data-theme="ledger"] .ft-card { background: #FFFFFF !important; ${sides("#DCDCDC")} border-radius: 6px !important; }

  /* Krypton */
  html[data-theme="krypton"] { background: #050505; }
  html[data-theme="krypton"] body { background: radial-gradient(circle at center, #1A1A1A 0%, #050505 100%); min-height: 100vh; }
  html[data-theme="krypton"] .ft-masthead {
    background: #050505; border-bottom: 2px solid #D31A1A; box-shadow: 0 4px 15px rgba(211, 26, 26, 0.4);
    border-radius: 4px; padding: 12px 14px 14px;
  }
  html[data-theme="krypton"] .ft-card {
    background: #111111 !important; ${sides("#2D2D2D")} border-radius: 12px !important;
    box-shadow: inset 2px 2px 4px rgba(255, 255, 255, 0.05), 8px 8px 20px rgba(0, 0, 0, 0.9);
  }

  /* Gotham Swarm */
  html[data-theme="gotham"] body {
    background-color: #8F969B;
    background-image: radial-gradient(circle at center, transparent 40%, rgba(0, 0, 0, 0.6) 120%);
    min-height: 100vh;
  }
  html[data-theme="gotham"] { background: #5C6166; }
  html[data-theme="gotham"] .ft-masthead {
    background: #050505; clip-path: polygon(0 0, 100% 0, 95% 100%, 0% 100%);
    padding: 12px 30px 14px 14px;
  }
  html[data-theme="gotham"] .ft-card {
    background: #C1C6CB !important; border-top: none !important; border-right: none !important; border-bottom: none !important;
    border-radius: 0 !important; box-shadow: 8px 8px 0 #050505; text-transform: uppercase; font-weight: 700;
  }
  html[data-theme="gotham"] .ft-card input, html[data-theme="gotham"] .ft-card textarea,
  html[data-theme="gotham"] .ft-card select { text-transform: none; font-weight: 400; }

  /* Alpine Sunset */
  html[data-theme="alpine"] body {
    background: linear-gradient(135deg, #2351D4 0%, #9253C6 40%, #F089B6 100%);
    min-height: 100vh;
  }
  html[data-theme="alpine"] { background: #F089B6; }
  html[data-theme="alpine"] .ft-masthead {
    background: rgba(255, 255, 255, 0.2); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.3); padding: 12px 14px 14px;
  }
  html[data-theme="alpine"] .ft-card {
    background: rgba(44, 37, 89, 0.4) !important; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    ${sides("rgba(255, 255, 255, 0.2)")} border-radius: 16px !important; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  }
  html[data-theme="alpine"] option, html[data-theme="alpine"] optgroup { color: #1A1A1A; background: #FFFFFF; }

  /* Quiet */
  :root { --q-ink: #111111; --q-faint: #8A8A8A; --q-paper: #FFFFFF; --q-line: #ECECEC; --q-grid: #F2F2F2; --q-soft: #F6F6F6; }
  @media (prefers-color-scheme: dark) {
    :root { --q-ink: #EDEDED; --q-faint: #7A7A7A; --q-paper: #0E0E0E; --q-line: #242424; --q-grid: #1A1A1A; --q-soft: #161616; }
  }
  html[data-theme="quiet"] .ft-page * { letter-spacing: normal !important; font-family: var(--ft-sans) !important; font-variant-numeric: tabular-nums; }
  html[data-theme="quiet"] .ft-brand { visibility: hidden; }
  /* Clear of the calendar pull-tab on the left edge */
  html[data-theme="quiet"] .ft-page { padding-left: 32px !important; }
  html[data-theme="quiet"] .ft-card {
    background: transparent !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
    padding-left: 0 !important; padding-right: 0 !important;
  }
  html[data-theme="quiet"] .ft-page button { border-color: transparent !important; box-shadow: none !important; }
  html[data-theme="quiet"] .ft-page button:focus:not(:focus-visible) { outline: none; }
  html[data-theme="quiet"] .ft-submit { color: var(--ft-on-fill) !important; }
  html[data-theme="quiet"] .ft-page :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea) {
    border-width: 0 0 1px !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important;
  }
  html[data-theme="quiet"] .ft-page :is(input, select, textarea):focus { outline: none; border-bottom-color: var(--ft-ink) !important; }
  html[data-theme="quiet"] .ft-bottom-nav { border-top-color: transparent !important; box-shadow: none !important; }
  html[data-theme="quiet"] .ft-cal-tab { background: var(--ft-paper) !important; border-color: transparent !important; box-shadow: none !important; }
  html[data-theme="quiet"] .ft-cal-drawer { border-color: var(--ft-line) !important; }
  html[data-theme="quiet"] .ft-cal-label { display: none; }
  html[data-theme="quiet"] .ft-cal-tab { min-height: 44px; justify-content: center; }
  /* Text that appears only while it is needed */
  html[data-theme="quiet"] .ft-hint, html[data-theme="quiet"] .ft-reveal,
  html[data-theme="quiet"] .ft-bottom-nav .ft-nav-label { transition: opacity 0.15s; }
  html[data-theme="quiet"] .ft-hint, html[data-theme="quiet"] .ft-reveal { opacity: 0; }
  /* Inline explanations leave no gap, but screen readers still hear them */
  html[data-theme="quiet"] .ft-card:not(:hover):not(:focus-within) .ft-hint-inline { font-size: 0; }
  html[data-theme="quiet"] .ft-card:is(:hover, :focus-within) :is(.ft-hint, .ft-reveal) { opacity: 1; }
  html[data-theme="quiet"] .ft-bottom-nav button:not([aria-current]) .ft-nav-label { opacity: 0; }
  @media (hover: none) { html[data-theme="quiet"] .ft-reveal { opacity: 1; } }

  /* Dark mastheads: light text inside */
  html[data-theme="ledger"] .ft-masthead, html[data-theme="krypton"] .ft-masthead, html[data-theme="gotham"] .ft-masthead {
    --ft-ink: #F5F5F5; --ft-ink-faint: #C9D2DC; --ft-line: rgba(255, 255, 255, 0.45);
    --ft-rust: #FF9A8C; --ft-teal: #CCFF00; color: #F5F5F5;
  }
  html[data-theme="krypton"] .ft-masthead { --ft-ink-faint: #9A9A9A; --ft-teal: #EF3B3B; }
  html[data-theme="gotham"] .ft-masthead { --ft-ink-faint: #B8BEC3; --ft-teal: #F2C230; }
  html[data-theme="ledger"] .ft-masthead-title, html[data-theme="gotham"] .ft-masthead-title { text-transform: uppercase; letter-spacing: 0.04em !important; }

  /* Calendar sidebar and its pull tab */
  html[data-theme="ledger"] .ft-cal-drawer { background: #FFFFFF !important; border-right: 4px double #E07A7A !important; }
  html[data-theme="ledger"] .ft-cal-tab { background: #1D3B66 !important; color: #FFFFFF !important; border-color: #1D3B66 !important; }
  html[data-theme="krypton"] .ft-cal-drawer {
    background: #111111 !important; border-right: 1px solid #D31A1A !important;
    box-shadow: 8px 0 30px rgba(0, 0, 0, 0.9), 4px 0 15px rgba(211, 26, 26, 0.25) !important;
  }
  html[data-theme="krypton"] .ft-cal-tab { background: #111111 !important; border-color: #D31A1A !important; box-shadow: 4px 0 15px rgba(211, 26, 26, 0.4) !important; }
  html[data-theme="gotham"] .ft-cal-drawer { background: #C1C6CB !important; border-right: none !important; box-shadow: 8px 0 0 #050505 !important; }
  html[data-theme="gotham"] .ft-cal-tab { background: #050505 !important; color: #F5F5F5 !important; border-color: #050505 !important; border-radius: 0 !important; box-shadow: none !important; }
  html[data-theme="alpine"] .ft-cal-drawer, html[data-theme="alpine"] .ft-cal-tab {
    background: rgba(44, 37, 89, 0.85) !important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    border-color: rgba(255, 255, 255, 0.3) !important;
  }
`;
