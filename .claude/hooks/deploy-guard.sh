#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# deploy-guard.sh  (V2) — Claude Code PreToolUse guard for outward-facing,
# deploy, migration, render-cost, and destructive-DB commands.
#
# Wired from .claude/settings.json (PreToolUse / matcher "Bash"). Reads the
# tool-call JSON on stdin, self-filters, and emits a PreToolUse decision.
#
# DECISION PRECEDENCE (first match wins):
#   1. Destructive SQL (DROP DATABASE/SCHEMA, TRUNCATE, DELETE w/o WHERE) → DENY
#   2. Paid-render cost (Seedance/Runway/Luma/`npm run render`)           → ASK
#   3. Supabase / prisma production migration                            → ASK
#   4. Deploy commands (git push, gh pr create|merge, gh release,
#      vercel deploy, railway up|deploy|run):
#        - gh missing / unauth / identity mismatch                       → ASK
#        - identity OK but PRODUCTION (branch main|master|production, or
#          a production environment flag)                                → ASK
#        - otherwise                                                     → ALLOW
#   Anything not matched above is allowed instantly (exit 0, no log).
#
# Generic across repos: expected owner is DERIVED from `git remote origin`,
# never hard-coded, with a small override map (ContractorOS/Kelvin →
# ongsiote-web) and a DEPLOY_GUARD_EXPECTED_OWNER env override.
#
# Dependency-free (no jq). Fail-safe: anything unverifiable → ASK, never a
# silent allow. Every decision is appended to .claude/logs/deploy-guard.log.
# ---------------------------------------------------------------------------
set -uo pipefail

payload="$(cat)"

jstr() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\t' '  ')"; }
lc()   { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
has()  { printf '%s' "$payload" | grep -Eiq "$1"; }

# ── Detection regexes ────────────────────────────────────────────────────────
DEPLOY_RE='(\bgit\b[^|;&"]*\bpush\b)|(\bgh\b[^|;&"]*\bpr\b[^|;&"]*\b(create|merge)\b)|(\bgh\b[^|;&"]*\brelease\b)|(\bvercel\b[^|;&"]*\bdeploy\b)|(\brailway\b[^|;&"]*\b(up|deploy|run)\b)'
MIGRATE_RE='(\bsupabase\b[^|;&"]*\bdb\b[^|;&"]*\b(push|reset)\b)|(\bsupabase\b[^|;&"]*\bmigration\b[^|;&"]*\bup\b)|(\bprisma\b[^|;&"]*\bmigrate\b[^|;&"]*\bdeploy\b)'
COST_RE='((seedance|runway|luma)[^|;&"]*(render|generate|task|--provider|video))|((render|generate)[^|;&"]*(seedance|runway|luma))|(\bnpm\b[^|;&"]*\brun\b[^|;&"]*\brender\b)|(\brender:(cinematic|seedance|runway|luma)\b)'
# DB-execution context = an actual database client binary. Deliberately NOT a
# bare `-c`/`--command`/`<<` (those match git/bash/heredocs and would hard-deny
# innocuous commands whose text merely mentions SQL keywords, e.g. a commit
# message). Destructive deny only fires when a real DB client is invoked.
DBCTX_RE='(\bpsql\b|\bmysql\b|\bmariadb\b|\bsqlite3\b|\bcockroach\b|\bmongosh?\b|supabase[[:space:]]+db\b|prisma[[:space:]]+db[[:space:]]+execute\b|\bpg_query\b)'

# ── Early exit: only proceed for guarded commands ────────────────────────────
guarded=0
has "$DEPLOY_RE"  && guarded=1
has "$MIGRATE_RE" && guarded=1
has "$COST_RE"    && guarded=1
# destructive SQL (keyword + db execution context)
sqlu="$(printf '%s' "$payload" | tr '\n' ' ' | tr '[:lower:]' '[:upper:]')"
destructive=""
if printf '%s' "$payload" | grep -Eiq "$DBCTX_RE"; then
  if printf '%s' "$sqlu" | grep -Eq 'DROP[[:space:]]+DATABASE';      then destructive="DROP DATABASE"; fi
  if printf '%s' "$sqlu" | grep -Eq 'DROP[[:space:]]+SCHEMA';        then destructive="DROP SCHEMA"; fi
  if printf '%s' "$sqlu" | grep -Eq '\bTRUNCATE\b';                  then destructive="TRUNCATE"; fi
  if printf '%s' "$sqlu" | grep -Eq 'DELETE[[:space:]]+FROM' && ! printf '%s' "$sqlu" | grep -Eq '\bWHERE\b'; then destructive="DELETE without WHERE"; fi
fi
[ -n "$destructive" ] && guarded=1
[ "$guarded" -eq 0 ] && exit 0

# ── Gather context ───────────────────────────────────────────────────────────
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
origin="$(git remote get-url origin 2>/dev/null || echo '')"
slug="$(printf '%s' "$origin" | sed -E 's#^[a-z]+://[^/]+/##; s#^git@[^:]+:##; s#\.git$##')"
owner="${slug%%/*}"; repo="${slug##*/}"

expected_owner="$owner"
case "$(lc "$owner")/$(lc "$repo")" in
  */contractoros|kelvin/*|*/kelvin) expected_owner="ongsiote-web" ;;
esac
[ -n "${DEPLOY_GUARD_EXPECTED_OWNER:-}" ] && expected_owner="$DEPLOY_GUARD_EXPECTED_OWNER"

# GitHub identity (fail-safe)
gh_user=""; gh_err=""
if command -v gh >/dev/null 2>&1; then
  gh_user="$(gh api user --jq .login 2>/dev/null || true)"
  [ -z "$gh_user" ] && gh_err="gh installed but 'gh api user' returned nothing (not authenticated?)"
else
  gh_err="gh CLI not found on PATH"
fi

# Environment awareness
is_prod_branch=0
case "$(lc "$branch")" in main|master|production) is_prod_branch=1 ;; esac
env_label="preview/non-production"
is_prod_env=0
if has '\bvercel\b[^|;&"]*\b(--prod|--production|deploy[^|;&"]*--prod)\b' || { has '\bvercel\b' && has '\-\-prod\b'; }; then
  env_label="vercel:production"; is_prod_env=1
elif has '\brailway\b' && has '(--environment[[:space:]]+production|\-e[[:space:]]+production|RAILWAY_ENVIRONMENT=production)'; then
  env_label="railway:production"; is_prod_env=1
elif has "$MIGRATE_RE"; then
  env_label="supabase/db:linked-or-production"
elif [ "$is_prod_branch" -eq 1 ]; then
  env_label="production (by branch)"
fi
[ "$is_prod_branch" -eq 1 ] && [ "$env_label" = "preview/non-production" ] && env_label="production (by branch)"

# Single-line command for logging/printing (best-effort, no jq). Handles
# escaped quotes inside the command value by protecting \" with a sentinel,
# cutting at the first REAL closing quote, then restoring.
cmd_log="$(printf '%s' "$payload" | tr '\n' ' ')"
cmd_log="${cmd_log#*\"command\"}"; cmd_log="${cmd_log#*:}"
cmd_log="$(printf '%s' "$cmd_log" | sed -E 's/^[[:space:]]*"//; s/\\"/\x01/g')"
cmd_log="${cmd_log%%\"*}"
cmd_log="$(printf '%s' "$cmd_log" | sed 's/\x01/"/g' | cut -c1-200)"
[ -z "$cmd_log" ] && cmd_log="$(printf '%s' "$payload" | tr '\n' ' ' | cut -c1-200)"

detected="Repository: ${owner:-?}/${repo:-?} | Branch: ${branch} | Environment: ${env_label} | GitHub User: ${gh_user:-<unknown>}"
printf 'deploy-guard: %s\n' "$detected" 1>&2

# ── Audit logging ────────────────────────────────────────────────────────────
audit() {
  local decision="$1"
  local ts logdir
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  logdir="${CLAUDE_PROJECT_DIR:-.}/.claude/logs"
  mkdir -p "$logdir" 2>/dev/null
  printf '%s\t%s\tuser=%s\trepo=%s/%s\tbranch=%s\tenv=%s\tcmd=%s\n' \
    "$ts" "$decision" "${gh_user:-<unknown>}" "${owner:-?}" "${repo:-?}" "$branch" "$env_label" "$cmd_log" \
    >> "$logdir/deploy-guard.log" 2>/dev/null
}

emit() { # decision reason
  local decision="$1" reason="$2"
  audit "$decision"
  local full="${reason} [${detected}]"
  case "$decision" in
    deny|ask)
      printf '{"systemMessage":%s,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":%s}}\n' \
        "$(jstr "$full")" "$decision" "$(jstr "$full")" ;;
    allow)
      printf '{"systemMessage":%s}\n' "$(jstr "$full")" ;;
  esac
  exit 0
}

# ── 1. Destructive SQL → DENY (hard block, regardless of identity) ───────────
[ -n "$destructive" ] && emit "deny" "🛑 BLOCKED destructive database operation (${destructive}). This is denied automatically."

# ── 2. Paid render → ASK (cost confirmation) ─────────────────────────────────
if has "$COST_RE"; then
  emit "ask" "💸 This action may consume paid API credits (Seedance/Runway/Luma render). Do you approve spending credits?"
fi

# ── 3. Production migration → ASK ────────────────────────────────────────────
if has "$MIGRATE_RE"; then
  emit "ask" "🗄️ Production database migration detected. Confirm you intend to apply this migration to ${env_label}."
fi

# ── 4. Deploy commands → identity + production gating ────────────────────────
if has "$DEPLOY_RE"; then
  if [ -z "$origin" ] || [ -z "$owner" ] || [ -z "$repo" ]; then
    emit "ask" "🚫 No usable git remote 'origin' — cannot confirm which repository this is."
  fi
  if [ -z "$gh_user" ]; then
    emit "ask" "🚫 Cannot verify GitHub identity (${gh_err})."
  fi
  if [ "$(lc "$gh_user")" != "$(lc "$expected_owner")" ]; then
    emit "ask" "🚫 GitHub user '${gh_user}' does NOT match expected owner '${expected_owner}'."
  fi
  if [ "$is_prod_branch" -eq 1 ] || [ "$is_prod_env" -eq 1 ]; then
    emit "ask" "⚠️ Identity verified, but this targets PRODUCTION (${env_label}). Confirm before deploying to production."
  fi
  emit "allow" "✅ deploy-guard verified — identity matches and target is non-production."
fi

# ── Fallback (guarded but uncategorized) → ASK (fail-safe) ───────────────────
emit "ask" "Guarded command could not be fully classified — confirm manually."
