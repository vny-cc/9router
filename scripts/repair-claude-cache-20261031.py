"""Repair only the 20 verified translated-Claude records; dry-run by default.

Run --apply only while 9router is stopped, with --backup pointing to a new file.
Preserve unrelated historical aggregates, request counts, and cache counters.
"""
import argparse
import json
import math
import sqlite3
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("database")
p.add_argument("--apply", action="store_true")
p.add_argument("--backup")
a = p.parse_args()
db = sqlite3.connect(f"file:{Path(a.database).resolve()}?mode={'rw' if a.apply else 'ro'}", uri=True)
db.row_factory = sqlite3.Row
marker = "claude-cache-repair-20261031-hermes"
if db.execute("SELECT 1 FROM _meta WHERE key=?", (marker,)).fetchone():
    print("Already repaired; no changes.")
    raise SystemExit(0)

rows = db.execute("""SELECT * FROM usageHistory
    WHERE provider='anthropic-compatible-b91f4dd0-e48f-4a03-8f9c-75a2f0ace32c'
      AND model='claude-opus-5-5'
      AND timestamp >= '2026-10-31T13:12:00Z'
      AND timestamp < '2026-10-31T13:19:00Z' ORDER BY id"""
).fetchall()
assert len(rows) == 20, "Unexpected request count; refusing repair"
daily = {}
updates = []
old_input = new_input = 0
old_cost = new_cost = 0.0

def subtract(counter, tokens, cost):
    assert counter["promptTokens"] >= tokens
    assert counter["cost"] + 1e-8 >= cost
    counter["promptTokens"] -= tokens
    counter["cost"] = max(0, counter["cost"] - cost)

for r in rows:
    t = json.loads(r["tokens"])
    read, write = t.get("cached_tokens", 0), t.get("cache_creation_input_tokens", 0)
    duplicate = read + write
    corrected = r["promptTokens"] - duplicate
    uncached = corrected - read - write
    assert uncached >= 0
    expected_old = ((r["promptTokens"] - read - write) * 4 + read * .2 + write * 5 + r["completionTokens"] * 20) / 1e6
    assert math.isclose(r["cost"], expected_old, abs_tol=1e-10), "Unexpected pricing"
    cost = (uncached * 4 + read * .2 + write * 5 + r["completionTokens"] * 20) / 1e6
    delta_cost = r["cost"] - cost
    t.update(prompt_tokens=corrected, total_tokens=corrected + r["completionTokens"])
    meta = json.loads(r["meta"] or "{}")
    meta[marker] = {"originalPromptTokens": r["promptTokens"], "originalCost": r["cost"]}
    updates.append((corrected, cost, json.dumps(t), json.dumps(meta), r["id"]))
    date = r["timestamp"][:10]  # Deployment uses UTC for daily buckets.
    if date not in daily:
        daily[date] = json.loads(db.execute("SELECT data FROM usageDaily WHERE dateKey=?", (date,)).fetchone()[0])
    day = daily[date]
    subtract(day, duplicate, delta_cost)
    groups = {
        "byProvider": r["provider"],
        "byModel": f'{r["model"]}|{r["provider"]}',
        "byAccount": r["connectionId"],
        "byApiKey": f'{r["apiKey"] or "local-no-key"}|{r["model"]}|{r["provider"]}',
        "byEndpoint": f'{r["endpoint"] or "Unknown"}|{r["model"]}|{r["provider"]}',
    }
    for group, key in groups.items():
        if key:
            subtract(day[group][key], duplicate, delta_cost)
    old_input += r["promptTokens"]
    new_input += corrected
    old_cost += r["cost"]
    new_cost += cost

summary = dict(requests=len(rows), old_input=old_input, new_input=new_input,
               old_cost=old_cost, new_cost=new_cost)
assert new_input == 11912023
if a.apply:
    assert a.backup and not Path(a.backup).exists(), "A new backup path is required"
    backup = sqlite3.connect(a.backup)
    db.backup(backup)
    assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    backup.close()
    with db:
        db.executemany("UPDATE usageHistory SET promptTokens=?,cost=?,tokens=?,meta=? WHERE id=?", updates)
        for date, day in daily.items():
            db.execute("UPDATE usageDaily SET data=? WHERE dateKey=?", (json.dumps(day), date))
        db.execute("INSERT INTO _meta(key,value) VALUES(?,?)", (marker, json.dumps(summary)))
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
print(json.dumps({"applied": a.apply, **summary}))
