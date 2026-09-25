# Filling ONE Universe tiers — one repo at a time

The dashboard does not save hierarchy. Analyze inspects. The map is YAML + JS embed.

## Loop
1. Sign in with GitHub (once per tab).
2. Single Repo → paste owner/repo → Analyze.
3. Decide: parent, role, maturity, known_gaps. A 404 repo is a gap, never scaffolded.
4. Add one block to one-universe.yaml AND the same block inside ONE_UNIVERSE_RAW in app-static.js.
5. If it is a whole universe, also add a card to multiverse.yaml + MULTIVERSE_DATA.
6. Commit, push, hard-refresh the Vercel preview. Do not Promote to Production until HITL says wild.

Lesson: patches/README.md

## Already live GitHub slugs (inspect these first)
- noahnemo-rgb/ONE-LoveFire
- noahnemo-rgb/ONE-Multiverse
- noahnemo-rgb/ONE-repo-mapper-live
- noahnemo-rgb/ONE-idea-forge-ai
- noahnemo-rgb/Oceanus
- noahnemo-rgb/haseos-spiral-swarm
- noahnemo-rgb/HASEOS-IDAO
- noahnemo-rgb/ONE-Ewaste-Emporia
- noahnemo-rgb/ONE-SeedFeast
- noahnemo-rgb/ONE-Syntax-IDE

## Named on the map, repo missing or different slug
- one-church / ONE-Church — gap
- one-ecology, haos, dsm, haia — check before promoting maturity
- Manifest slugs like one-universe vs ONE-Multiverse — fix names when you touch that row

Never stamp Oceanus as ONE-branded membership.
