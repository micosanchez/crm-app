"""Splice rental_tools.js into a freshly downloaded sjhc-connector bundle (v2.1.0 -> v2.2.0).

    python3 patch_rentals.py            # reads index.js, writes index.patched.js, prints fails: 0
"""
import pathlib
S = pathlib.Path(__file__).parent
src = (S / 'index.js').read_text()
fails = []

def rep(old, new, count=1, label=None):
    global src
    n = src.count(old)
    if n != count:
        fails.append(f"{label or old[:60]!r}: expected {count}, found {n}")
        return
    src = src.replace(old, new)

rentals = (S / 'rental_tools.js').read_text()
rep('// src/server.ts\nfunction buildServer(env) {', rentals + '\n// src/server.ts\nfunction buildServer(env) {', label='module insert')
rep('  registerMetricsTools(server, dbc, env);\n  return server;', '  registerMetricsTools(server, dbc, env);\n  registerRentalTools(server, dbc, env);\n  return server;', label='register call')
rep('{ name: "SJHC Connector", version: "2.1.0" }', '{ name: "SJHC Connector", version: "2.2.0" }', label='version')

# revenue_summary: rentals are their own division, shown next to junk revenue.
rep('      const tipsTotal = rows.reduce((s, i) => s + Number(i.tip), 0);\n      return ok({\n        from,\n        to,\n        collected: r2(collected),',
    '      const tipsTotal = rows.reduce((s, i) => s + Number(i.tip), 0);\n      const { data: rentalRev } = await dbc.rpc("rental_revenue", { p_from: from, p_to: to });\n      return ok({\n        from,\n        to,\n        collected: r2(collected),\n        rental_revenue: r2(Number(rentalRev ?? 0)),\n        collected_including_rentals: r2(collected + Number(rentalRev ?? 0)),', label='revenue_summary rentals')

(S / 'index.patched.js').write_text(src)
print('fails:', len(fails)); [print(' -', f) for f in fails]
