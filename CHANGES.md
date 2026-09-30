# Repo Mapper Static — Changelog

## 2026-09-29 — House tree on the Multiverse graph

- ONE Multiverse mind-map draws `HOUSE_TREE` (MAP.yaml), not the three-universe ring.
- Parent links: governance, universes, ecology, ecosystems. Oceanus stays unlabeled (dashed teal).
- Layer 4 is not invented. A click opens that branch in Universe mode.
- Universe-mode tree is unchanged.

## 2026-09-27 — Champagne tower

- Source of truth moved to `ONE-Multiverse/MAP.yaml`. One tree. One pour.
- Lamp fetches that file (embed is fallback only).
- Path add writes the in-memory tree. Download `MAP.yaml` and commit it in **ONE-Multiverse**.
- Product repos are not written. Oceanus stays unlabeled.

## 2026-09-27 — Multi-tier map bundle

- A path may name any universe in the house, not only ONE Universe.
- Compute walks Multiverse card → universe yaml → parents → leaf. Missing middle names and a missing child-universe card are created in session.
- **Download map bundle** emits `multiverse.yaml` + `one-universe.yaml` + any child `*.universe.yaml`. One HITL commit in this mapper repo keeps every tier.
- Still does not write ONE-Multiverse, Urban Mines, Oceanus, or any product repo.

## 2026-09-27 — Path add-element

- Add-element accepts a map path, e.g. `ONE-Multiverse/ONE-Universe/ONE-Ecology/ONE-Urban-Mines/Operations Manual`.
- Path is an address on this dashboard, not a GitHub folder and not a write into the ONE-Multiverse repo.
- Last segment is the new leaf. Existing parents are reused. Missing middle names are created in this session only.
- Role is inferred from the leaf name and its parent (manual → work-unit; under ecology → ecosystem). Override if needed.
- Repo URL is optional. Download YAML, then commit it in this mapper repo to keep the row. Vercel does not update from Add-element alone.

## 2026-09-27 — House slug + LoveFire ecosystem

- Exact house slug `noahnemo-rgb/ONE-` → `noahnemo-rgb/ONE-Multiverse` (LoveFire / Church slugs untouched).
- ONE LoveFire is not a universe. It is an ecosystem inside ONE Universe (`parent: one-ecology`): lineage of ONE Church and Yeshua ben Yosef's unchanged agape-love gestalt.

## 2026-09-27 — Oceanus unlabeled + add-element

- Oceanus stays inside ONE Universe geography (`parent: one-ecology`).
- Oceanus card wears no ONE mark and no HASEOS label. `governed_by` omitted. Appearance is not enrollment.
- Universe mode: Add-element form writes into this session’s map, punch-list, and graph. Download YAML to keep. Does not edit other repos.

## 2026-06-17 — ONE Multiverse Mode

### Summary
Added a standalone **ONE Multiverse** mode to the static GitHub Pages build. All changes are purely additive; no existing modes were modified.

---

### app-static.js

- **`ONE_MULTIVERSE_RAW`** — inline YAML template literal added after `ONE_UNIVERSE_RAW`, containing the full multiverse manifest (3 universes, 4 structural gaps, HASEOS governance block).
- **`MULTIVERSE_DATA`** — pre-parsed JS object constant (same data as `ONE_MULTIVERSE_RAW`) so multiverse mode requires no YAML parsing at runtime.
- **`CURRENT_MULTIVERSE`** — new state variable (`let CURRENT_MULTIVERSE = null`) added alongside existing state vars.
- **`setMode()`** — extended to handle `'multiverse'`: initialises `CURRENT_MULTIVERSE` from `MULTIVERSE_DATA` and calls `renderMultiverseView()`.
- **Hash routing** — `'multiverse'` added to valid modes array in the `load` event listener.
- **`renderMultiverseView(data)`** — new function that renders into `#multiverseView`:
  - Multiverse header (title, tagline, HASEOS governance badge)
  - Hierarchy breadcrumb (Multiverse → Child Universes → Container Layers → Ecosystems → MVPs/Products)
  - Universe cards grid (maturity chip, reference-impl badge, repo link, gap list)
  - Structural gaps panel (severity-coloured left-border rows: critical / major / minor)
- **`renderUniverse()`** — injects a `hierarchy-breadcrumb` element above the stats row with a clickable "ONE Multiverse →" back-link when a universe is rendered.

### index.html

- `<title>` updated from `Repo Mapper — MultiVerse` to `Repo Mapper — ONE Multiverse`.
- **`<button class="mode-pill" data-mode="multiverse">ONE Multiverse</button>`** added as the first pill in the nav (before Single Repo).
- **`<section class="view" data-view="multiverse" hidden>`** added as the first view section (before Single Repo), containing `<div id="multiverseView"></div>`.

### app.css

- Appended `/* ===== ONE MULTIVERSE MODE ===== */` block (~90 lines) covering:
  - `.multiverse-header`, `.multiverse-title`, `.multiverse-tagline`
  - `.haseos-badge`
  - `.hierarchy-breadcrumb`, `.crumb`, `.crumb--active`, `.crumb-sep`
  - `.universe-cards-grid`, `.universe-card`, `.universe-card--reference`
  - `.universe-card-header`, `.universe-card-name`, `.badge-reference`, `.maturity-chip`
  - `.universe-card-desc`, `.universe-card-repo`
  - `.gap-badge`, `.universe-gap-list`
  - `.section-label`, `.gap-count-badge`
  - `.structural-gaps-panel`, `.structural-gap`
  - Severity modifiers: `.gap-severity-critical/major/minor`
  - `.gap-severity-label`, `.gap-layer`, `.gap-desc`

### New files

- **`multiverse.yaml`** — the YAML source for the ONE Multiverse manifest (same content as `ONE_MULTIVERSE_RAW`).

---

### What was NOT changed

- `one-universe.yaml` — copied unchanged.
- All existing modes (Single Repo, Universe, Scaffold, Gap Dashboard) — untouched.
- No Express/Node.js backend dependencies introduced.
- No `/api/*` fetch calls added.
- Manifest pickers (universe/scaffold/gaps) are unchanged — multiverse is a fully standalone mode.
