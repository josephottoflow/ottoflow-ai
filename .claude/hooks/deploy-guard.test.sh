#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy-guard.test.sh — dry-run test suite for deploy-guard.sh (V2).
#
# Drives the guard with STUBBED git/gh and synthetic stdin payloads. Nothing
# real is executed: no git push, no gh, no vercel/railway/supabase, no render,
# no SQL. Asserts the PreToolUse decision (allow|ask|deny) for each case.
#
# Usage:  bash .claude/hooks/deploy-guard.test.sh
# Exit 0 = all passed, 1 = at least one failed.
# ---------------------------------------------------------------------------
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/deploy-guard.sh"
STUB="$(mktemp -d)"; trap 'rm -rf "$STUB"' EXIT

# git stub: answers rev-parse (branch) + remote get-url (origin) from env.
cat > "$STUB/git" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "rev-parse --abbrev-ref") echo "${FAKE_BRANCH:-feature/x}";;
  "remote get-url")         echo "${FAKE_ORIGIN:-https://github.com/josephottoflow/ottoflow-ai.git}";;
  *) exit 0;;
esac
EOF
chmod +x "$STUB/git"

mk_gh() { # $1 = login to report ("" => unauthenticated, exit 1)
  if [ "$1" = "__NONE__" ]; then rm -f "$STUB/gh"; return; fi
  cat > "$STUB/gh" <<EOF
#!/usr/bin/env bash
[ -z "$1" ] && exit 1
echo "$1"
EOF
  chmod +x "$STUB/gh"
}

PASS=0; FAIL=0
RESULTS=""

decision_of() { # reads stdout on stdin
  local out; out="$(cat)"
  if   printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then echo deny
  elif printf '%s' "$out" | grep -q '"permissionDecision":"ask"';  then echo ask
  else echo allow; fi
}

run() { # name  expected  branch  gh_login  command
  local name="$1" expected="$2" branch="$3" ghlogin="$4" cmd="$5"
  mk_gh "$ghlogin"
  local payload; payload="$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "\"$(printf '%s' "$cmd" | sed 's/"/\\"/g')\"")"
  local got
  got="$(printf '%s' "$payload" | FAKE_BRANCH="$branch" FAKE_ORIGIN="https://github.com/josephottoflow/ottoflow-ai.git" PATH="$STUB:$PATH" bash "$GUARD" 2>/dev/null | decision_of)"
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS+1)); RESULTS+="  PASS  [$expected]  $name\n"
  else
    FAIL=$((FAIL+1)); RESULTS+="  FAIL  exp=$expected got=$got  $name\n"
  fi
}

# ── Cases (requirement 8 + extras) ───────────────────────────────────────────
run "valid deploy (git push, non-prod, identity match)" allow "feature/x" "josephottoflow" "git push origin feature/x"
run "wrong GitHub account (git push)"                    ask   "feature/x" "intruder"        "git push origin feature/x"
run "missing/unauth gh (git push)"                       ask   "feature/x" "__NONE__"        "git push origin feature/x"
run "production branch (main) even when identity matches" ask  "main"      "josephottoflow"  "git push origin main"
run "railway up (non-prod, identity match)"              allow "feature/x" "josephottoflow"  "railway up"
run "railway production environment"                     ask   "feature/x" "josephottoflow"  "railway up --environment production"
run "railway run"                                        allow "feature/x" "josephottoflow"  "railway run npm start"
run "vercel deploy (preview, identity match)"           allow "feature/x" "josephottoflow"  "vercel deploy"
run "vercel deploy --prod (production)"                  ask   "feature/x" "josephottoflow"  "vercel deploy --prod"
run "gh pr merge on main"                                ask   "main"      "josephottoflow"  "gh pr merge 42 --squash"
run "seedance render (cost)"                             ask   "feature/x" "josephottoflow"  "npm run render:seedance"
run "runway render via provider flag (cost)"            ask   "feature/x" "josephottoflow"  "tsx scripts/render.ts --provider runway"
run "supabase db push (prod migration)"                 ask   "feature/x" "josephottoflow"  "supabase db push"
run "DROP DATABASE (destructive)"                        deny  "feature/x" "josephottoflow"  "psql -c \"DROP DATABASE prod\""
run "TRUNCATE (destructive)"                             deny  "feature/x" "josephottoflow"  "psql -c \"TRUNCATE users\""
run "DELETE without WHERE (destructive)"                 deny  "feature/x" "josephottoflow"  "psql -c \"DELETE FROM users\""
run "DELETE WITH WHERE (safe → not guarded)"            allow "feature/x" "josephottoflow"  "psql -c \"DELETE FROM users WHERE id=1\""
run "non-guarded command (ls)"                           allow "feature/x" "josephottoflow"  "ls -la"

echo "================ deploy-guard V2 test report ================"
printf "%b" "$RESULTS"
echo "------------------------------------------------------------"
echo "TOTAL: $((PASS+FAIL))   PASS: $PASS   FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
