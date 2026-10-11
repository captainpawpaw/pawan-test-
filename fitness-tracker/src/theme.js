// Colour themes. Components use the C.* values, which are CSS variables, so
// switching theme only changes the variables on <html>.

export const THEMES = {
  classic: {
    label: "Classic",
    vars: {
      ink: "#23211D",
      inkFaint: "#706B5E",
      paper: "#EDE8DE",
      raised: "#F5F1E8",
      field: "#FFFFFF", // text boxes, menus, tooltips
      line: "#D9D2C2",
      grid: "#E4DDCF",
      rust: "#B5551F", // strength
      rustSoft: "#E0C4AC",
      teal: "#1F6E64", // cardio
      tealSoft: "#C3DAD5",
      plum: "#7A3E62", // food
      plumSoft: "#E6D3DD",
      blue: "#3F6FA8", // reps, beside strength weight
      highlight: "#E0C4AC", // milestone badges
      highlightInk: "#23211D",
    },
  },
  // Vintage ledger paper, Swiss red and black, a blueprint masthead, maple
  // for food and neon for milestones.
  ledger: {
    label: "Ledger",
    vars: {
      ink: "#1A1A1A",
      inkFaint: "#6B7280",
      paper: "#FDFBF7",
      raised: "#FFFFFF",
      field: "#FFFFFF",
      line: "#CDD6DC",
      grid: "#E0E7EB",
      rust: "#E23D28",
      rustSoft: "#F7D3CD",
      teal: "#1F456E",
      tealSoft: "#CBD7E4",
      plum: "#8A6436", // maple, darkened so text on paper stays readable
      plumSoft: "#D4B895",
      blue: "#1F456E",
      highlight: "#CCFF00",
      highlightInk: "#1A1A1A",
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
    return THEMES[t] ? t : "classic";
  } catch {
    return "classic";
  }
}

export function applyTheme(name) {
  const t = THEMES[name] ? name : "classic";
  const root = document.documentElement;
  for (const [k, v] of Object.entries(THEMES[t].vars)) root.style.setProperty(`--ft-${kebab(k)}`, v);
  root.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  return t;
}

// Theme-specific decoration, scoped by html[data-theme].
export const THEME_CSS = `
  body { background: var(--ft-paper); }
  html[data-theme="ledger"] body {
    background-color: var(--ft-paper);
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, #E0E7EB 31px 32px);
  }
  html[data-theme="ledger"] .ft-page {
    background-color: transparent !important;
    background-image: linear-gradient(90deg, transparent 0 7px, #E23D28 7px 8px, transparent 8px 10px, #E23D28 10px 11px, transparent 11px);
  }
  html[data-theme="ledger"] .ft-masthead {
    --ft-ink: #FFFFFF;
    --ft-ink-faint: #C9D8EA;
    --ft-line: rgba(255, 255, 255, 0.45);
    --ft-rust: #FFB3A8;
    --ft-teal: #CCFF00;
    color: #FFFFFF;
    background-color: #1F456E;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.15) 1px, transparent 1px);
    background-size: 20px 20px;
    border-radius: 6px;
    padding: 12px 14px 14px;
  }
  html[data-theme="ledger"] .ft-masthead-title { text-transform: uppercase; letter-spacing: 0.04em !important; }
`;
