# sjhc-connector — metrics upgrade (v2.1.0)

The connector is a Cloudflare Worker (`sjhc-connector`) built with esbuild; the repo does not hold its
TypeScript source, so this folder holds what was changed and how to reproduce it.

- `metrics_tools.js` — `registerMetricsTools(server, dbc, env)`: the report/lead/account/dump/mileage/settings tools, each a thin wrapper over a 0046/0047 RPC.
- `patch_bundle.py` — the exact string edits applied to the deployed `index.js` (widened enums, new params on existing tools, module splice, `registerMetricsTools` call, `mark_lead_responded` on every outbound text). Run it against a fresh download of the bundle; it prints `fails: 0` when every anchor matched.

Deploy (Cloudflare API, keeps every secret binding):

1. `GET /accounts/{acct}/workers/scripts/sjhc-connector/content/v2` → save as `index.js`; `GET .../settings` → note bindings.
2. `python3 patch_bundle.py` → `index.patched.js`; `node --check index.patched.js`.
3. `PUT /accounts/{acct}/workers/scripts/sjhc-connector` multipart: `index.js` = the patched file, `metadata` = `{"main_module":"index.js","compatibility_date":"2026-07-01","compatibility_flags":["nodejs_compat"],"keep_bindings":["secret_text"],"bindings":[{"type":"plain_text","name":"OWNER_USER_ID","text":"…"},{"type":"plain_text","name":"SUPABASE_URL","text":"…"}]}`.
4. Hit the Worker root; the tool list should show 90 tools and version 2.1.0.

Only deploy after migrations 0041–0047 have run — the new tools call functions and columns those create.
