#!/usr/bin/env bash
#
# Marketing-truth commit-msg hook.
#
# Verifies a `MARC-APPROVED:` trailer is present in the commit message
# when customer-facing copy is staged in this commit.
#
# This logic used to live in marketing-truth-pre-commit.sh as Gate 5, but
# `.git/COMMIT_EDITMSG` is only populated at the commit-msg phase — at the
# pre-commit phase the file is empty, which forced manual workarounds
# (cp'ing the message into COMMIT_EDITMSG before each commit). Split out
# 2026-05-11 so the trailer check runs at the correct phase.
#
# Bypass for emergency/non-customer-facing edits:
#   WAIVE_MARKETING_AUDIT=<reason> git commit ...
#
# Source of truth: ~/cf-research/marketing-truth-hook/commit-msg-hook.sh
# Vendored copy lives at .git-hooks/marketing-truth-commit-msg.sh in each
# repo, called from .git/hooks/commit-msg or .husky/commit-msg.
#
# Introduced 2026-05-11 (split out from pre-commit Gate 5).
# Hardened 2026-05-11 (task 2e459fda) — husky-aware installer +
# chain-not-clobber existing commitlint/conventional-commits hooks.
# CF directive: customer-facing-copy-requires-product-claim-audit
# (cf_standing_directives, severity=critical, active).

set -e

# -----------------------------------------------------------------------------
# Patterns that trigger the hook.
# Must stay in sync with marketing-truth-pre-commit.sh.
# -----------------------------------------------------------------------------
CUSTOMER_FACING_PATTERNS=(
  '\.html$'
  'llms\.txt$'
  'robots\.txt$'
  'sitemap\.xml$'
  'modules\.json$'
  'manifest\.json$'
  '/public/.*\.json$'
  '/wwwroot/.*\.txt$'
  '^README\.md$'
  '^README$'
  'landing\.tsx$'
  '/landing/.*'
  '/marketing/.*'
  '/pages/.*\.html$'
  '/pages/.*\.tsx$'
  '/pages/.*\.jsx$'
  '/pages/.*\.cshtml$'
  '/Views/Home/.*\.cshtml$'
  '/Views/Shared/_Layout\.cshtml$'
  # Next.js App Router — root page/layout + any nested route page.tsx
  '/app/page\.tsx$'
  '/app/layout\.tsx$'
  '/app/.*/page\.tsx$'
)

# Files that should NOT trigger the hook even if they match above patterns.
EXCLUDE_PATTERNS=(
  'node_modules/'
  '/dist/'
  '/build/'
  '/\.next/'
  '\.test\.'
  '/test/'
  '/tests/'
  '/__tests__/'
  '/coverage/'
  '/playwright-report/'
  'CLAUDE\.md$'
)

# -----------------------------------------------------------------------------
# Bypass
# -----------------------------------------------------------------------------
if [[ -n "${WAIVE_MARKETING_AUDIT:-}" ]]; then
  # The pre-commit phase already logged the waiver — stay silent here to
  # avoid duplicate output.
  exit 0
fi

# -----------------------------------------------------------------------------
# Commit message file (passed by git as $1)
# -----------------------------------------------------------------------------
COMMIT_MSG_FILE="${1:-}"
if [[ -z "$COMMIT_MSG_FILE" || ! -f "$COMMIT_MSG_FILE" ]]; then
  # No message file — nothing to check. (Should not happen in normal git
  # invocation; protective so manual invocation doesn't blow up.)
  exit 0
fi

# Skip during merge / rebase / cherry-pick — message isn't user-authored.
case "${GIT_REFLOG_ACTION:-}" in
  ""|commit*) ;;
  *) exit 0 ;;
esac

# -----------------------------------------------------------------------------
# Files staged in this commit
# -----------------------------------------------------------------------------
STAGED=$(git diff --cached --name-only --diff-filter=ACMR)
if [[ -z "$STAGED" ]]; then
  exit 0
fi

# Build the regex strings.
INCLUDE_RE=$(IFS='|'; echo "${CUSTOMER_FACING_PATTERNS[*]}")
EXCLUDE_RE=$(IFS='|'; echo "${EXCLUDE_PATTERNS[*]}")

# Find customer-facing files.
CUSTOMER_FACING_FILES=$(echo "$STAGED" \
  | grep -E "$INCLUDE_RE" \
  | grep -vE "$EXCLUDE_RE" \
  || true)

if [[ -z "$CUSTOMER_FACING_FILES" ]]; then
  # No customer-facing change — no trailer required.
  exit 0
fi

# -----------------------------------------------------------------------------
# MARC-APPROVED trailer must be present.
# -----------------------------------------------------------------------------
if ! grep -qE '^MARC-APPROVED:' "$COMMIT_MSG_FILE"; then
  cat >&2 <<EOF

🛑  marketing-truth hook: customer-facing change requires
    'MARC-APPROVED:' trailer in commit message.

    Add a line like:
      MARC-APPROVED: 2026-04-30 portfolio-wide marketing-truth recall

    Customer-facing files in this commit:
$(echo "$CUSTOMER_FACING_FILES" | sed 's/^/      - /')

    Bypass: WAIVE_MARKETING_AUDIT="<reason>" git commit ...
EOF
  exit 1
fi

exit 0
