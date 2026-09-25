# How a mapper patch lands

1. Write the claim in the source repo.
2. HITL collar: does the GitHub repo exist, is the schema right, does this enroll anyone.
3. Merge into the correct YAML.
   - Multiverse Mode reads `multiverse:` + `universes:` + `structural_gaps:`.
   - Universe Mode reads `universe:` + `repos:`.
   These are not interchangeable.
4. Mirror the same facts into `app-static.js` (the Pages app embeds YAML as JS; extra files are not auto-loaded).
5. Push. Then unpark the source repo STATUS.

A 404 repo is a `structural_gap` / `placeholder`, never `scaffolded` with empty gaps.
