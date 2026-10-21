# Quiet

A small, framework-free stylesheet that strips an interface down to its content:
no boxes, no borders, one colour, and explanations that appear only while they're
needed. It started as a theme in Training Ledger and now lives here on its own so
any project can use it.

Open `demo.html` in a browser to see it. The button at the top right switches
between the full Quiet look and the structure-only layer.

## Principles

1. **No boxes.** Cards, panels and sections keep their spacing but lose their
   background, border, rounded corners and shadow.
2. **One filled button per area.** The main action (`.q-primary`) stays filled.
   Every other button is just its label.
3. **Inputs are a single line.** Text boxes, selects and text areas become an
   underline, which darkens while you type.
4. **Text only while it's needed.** Explanations (`.q-hint`) and secondary
   controls (`.q-reveal`) fade in while you're in their area: on hover, or when
   something in it has focus. On touch screens the secondary controls always show.
5. **Navigation names only where you are.** In a `.q-nav` bar only the current
   item (`aria-current`) shows its label. The others show just their icon.
6. **One colour.** In the full layer: near-black on white, or light grey on
   near-black in dark mode, following the device setting. Secondary text is a
   single faint grey.
7. **Plain type.** In the full layer: the system font, no letter-spacing, and
   tabular figures so numbers line up.

Hidden text is never removed. It's faded (`opacity: 0`) or shrunk (`font-size: 0`)
so screen readers still read it.

## Two layers

| Class on `<html>` (or a wrapper) | What you get |
|---|---|
| `.quiet-structure` | Principles 1–5 only. Your project keeps its own colours and fonts. |
| `.quiet` | Everything, including Quiet's palette (light and dark) and typography. |

## Using it

```html
<link rel="stylesheet" href="quiet.css">
<html class="quiet">            <!-- or class="quiet-structure" -->
```

Then mark up the parts:

| Hook | Put it on | Effect |
|---|---|---|
| `.q-card` | a card, section or panel | no box; its hints show while it's hovered or focused |
| `.q-primary` | the one main button in an area | stays filled; other buttons lose their outline |
| `.q-hint` | an explanation, note or help line | hidden until its `.q-card` is in use |
| `.q-hint-inline` | an explanation inside a sentence | as `.q-hint`, and takes no space while hidden |
| `.q-reveal` | a secondary control, e.g. edit or tag | hidden until hover or focus; always shown on touch |
| `.q-nav` + `.q-nav-label` | a navigation bar and each item's text | only the current item (`aria-current`) shows its label |
| `.q-brand` | a logo or app name | hidden, but keeps its space |

### Palette variables

With `.quiet`, these are set on the root and can be used in your own CSS:

| Variable | Light | Dark | Use |
|---|---|---|---|
| `--q-ink` | `#111111` | `#EDEDED` | text, the one accent, filled buttons |
| `--q-faint` | `#8A8A8A` | `#7A7A7A` | secondary text |
| `--q-paper` | `#FFFFFF` | `#0E0E0E` | background |
| `--q-line` | `#ECECEC` | `#242424` | input underlines, row dividers |
| `--q-soft` | `#F6F6F6` | `#161616` | a pressed or selected item |

## Notes

- Quiet adds no spacing of its own, so keep your existing padding and gaps. It
  only takes away decoration.
- Focus outlines show for keyboard users (`:focus-visible`) and are hidden for
  mouse and touch.
- Fades are switched off when the device asks for reduced motion.
- Inline styles beat stylesheets. If a component sets its border or background
  inline, either move that to a class or add `!important` to the matching Quiet
  rule in your copy. Training Ledger applies the same rules with `!important`
  for this reason (`fitness-tracker/src/theme.js`).
