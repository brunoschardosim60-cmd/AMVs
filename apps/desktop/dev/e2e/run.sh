#!/bin/bash
# uso: run.sh script.py [args]  — sobe ponte e vite, roda o teste, derruba tudo
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../.."
node dev/bridge.mjs > /tmp/bridge.log 2>&1 &
B=$!
npx vite --config vite.harness.config.ts > /tmp/vite.log 2>&1 &
V=$!
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:1430/dev/harness.html && break; sleep 1; done
cd "$HERE" && python3 "$@"
RC=$?
kill $B $V 2>/dev/null; pkill -f "vite --config vite.harness" 2>/dev/null
exit $RC
