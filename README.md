# Repo Mapper

> Map any GitHub repo. Visualize your entire universe.

**Live app → [noahnemo-rgb.github.io/repo-mapper-live](https://noahnemo-rgb.github.io/repo-mapper-live/)**

Repo Mapper is a static GitHub Pages dashboard that gives you instant, interactive views of any public GitHub repository — and lets you visualize an entire constellation of repos from a YAML manifest.

---

## Features

### 🔍 Single Repo Mode
Drop any GitHub URL and get:
- Interactive file tree with search and filtering
- Dependency graph (D3 force-directed visualization)
- TODO / FIXME / HACK extractor across every file
- Key file auto-detection with scoring

### 🌌 Universe Mode
Load a `universe.yaml` manifest to render your entire repo constellation:
- D3 force-directed constellation map — nodes colored and sized by role and maturity
- Repo index table with maturity pills, parent hierarchy, and gap counts
- Raw manifest viewer with copy + download
- Upload your own manifest file

### 🏗 Scaffold Mode
Generate a full folder/file scaffold for every repo in a manifest — preview in-browser or download as `.zip`. Each file stub explains exactly what belongs there.

### 🚨 Gap Dashboard
Live-scan every repo in your universe against GitHub:
- Flags stale repos (no commits in 30+ days)
- Detects missing compliance stubs and empty required files
- Shows open issues count and last-commit age
- Filter to flagged-only for rapid triage

### 🌐 ONE Multiverse Mode
Top-level view of the entire ONE Multiverse hierarchy — universe cards with maturity chips, HASEOS governance badge, hierarchy breadcrumb, and structural gaps panel with severity coloring.

---

## Architecture

```
repo-mapper-live/
├── index.html          # Single-page shell + mode nav
├── app-static.js       # All logic — GitHub API, D3, manifests, modes
├── app.css             # Cosmos design system styles
├── one-universe.yaml   # Built-in ONE Universe manifest
└── multiverse.yaml     # Built-in ONE Multiverse manifest
```

**Fully static — no backend required.** All GitHub API calls go directly to `api.github.com` from the browser. AI summary features are available via the companion backend (see below).

---

## Rate Limits

Unauthenticated GitHub API requests are limited to **60/hour per IP**. For serious usage, connect the OAuth proxy (see [`/proxy`](./proxy/)) to authenticate as the signed-in user and raise the limit to **5,000/hour**.

---

## Universe Manifest Format

```yaml
universe:
  name: ONE Universe
  tagline: The reference implementation.

repos:
  - id: one-universe
    name: ONE Universe
    role: master
    repo: github.com/noahnemo-rgb/ONE-
    maturity: scaffolded
    description: Master brand repo.
    tags: [master, governance]
    known_gaps: []
```

Maturity levels: `placeholder` → `scaffolded` → `drafting` → `mvp-partial` → `mvp-near` → `production`

---

## Tech Stack

- Vanilla JS (ES modules) — no build step
- [D3 v7](https://d3js.org/) for constellation map and dependency graph
- [js-yaml v4](https://github.com/nodeca/js-yaml) for manifest parsing
- [JSZip v3](https://stuk.github.io/jszip/) for scaffold zip downloads
- GitHub REST API v3 (direct, no backend)
- Google Fonts: Cormorant Garamond · Inter · JetBrains Mono

---

## ONE Multiverse

Repo Mapper is a tool in the [ONE Multiverse](https://github.com/noahnemo-rgb/ONE-) ecosystem — a canonical hierarchy of universes, container layers, ecosystems, and MVPs governed by [HASEOS](https://github.com/noahnemo-rgb/haseos-spiral-swarm).

---

## License

MIT
