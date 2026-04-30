#!/usr/bin/env bash
#
# Marketing-truth pre-commit hook.
#
# Blocks commits that touch customer-facing copy unless:
#   1. marketing-truths.json is updated in the same commit, AND
#   2. The commit message has a `MARC-APPROVED:` trailer.
#
# Bypass for emergency/non-customer-facing edits:
#   WAIVE_MARKETING_AUDIT=<reason> git commit ...
#   The waive emits a warning and (in the CF cron-paired version)
#   emails Marc.
#
# Source of truth: ~/cf-research/marketing-truth-hook/pre-commit-hook.sh
# Vendored copies live at .git-hooks/marketing-truth-pre-commit.sh in
# each repo, called from .husky/pre-commit or .git/hooks/pre-commit.
#
# Introduced 2026-04-30 as Stage 3 of the marketing-truth recall.
# CF directive: customer-facing-copy-requires-product-claim-audit
# (cf_standing_directives, severity=critical, active).

set -e

# -----------------------------------------------------------------------------
# Patterns that trigger the hook.
# Customer-facing surfaces — match anywhere in the file path.
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
  echo "⚠️  marketing-truth hook bypassed: WAIVE_MARKETING_AUDIT=${WAIVE_MARKETING_AUDIT}"
  echo "    This bypass is logged to ~/.config/instilligent/waivers.log"
  echo "    and (in cron-paired environments) emails Marc."
  mkdir -p "${HOME}/.config/instilligent"
  printf '%s\t%s\t%s\t%s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    "$(git rev-parse --show-toplevel 2>/dev/null || echo '?')" \
    "$(git config user.email 2>/dev/null || echo '?')" \
    "${WAIVE_MARKETING_AUDIT}" \
    >> "${HOME}/.config/instilligent/waivers.log"
  exit 0
fi

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
  exit 0
fi

# -----------------------------------------------------------------------------
# Customer-facing change detected. Apply gates.
# -----------------------------------------------------------------------------

REPO_ROOT=$(git rev-parse --show-toplevel)
TRUTHS_FILE="${REPO_ROOT}/marketing-truths.json"

# Gate 1: marketing-truths.json must exist.
if [[ ! -f "$TRUTHS_FILE" ]]; then
  cat >&2 <<EOF

🛑  marketing-truth hook: customer-facing files staged but
    marketing-truths.json does not exist at the repo root.

    Files that triggered this:
$(echo "$CUSTOMER_FACING_FILES" | sed 's/^/      - /')

    Action: create marketing-truths.json (see schema at
    ~/cf-research/marketing-truth-hook/schema.json or any
    sibling repo for an example).

    Bypass: WAIVE_MARKETING_AUDIT="<reason>" git commit ...

    CF directive: customer-facing-copy-requires-product-claim-audit
    (cf_standing_directives, severity=critical, active).
EOF
  exit 1
fi

# Gate 2: marketing-truths.json must be staged in the same commit.
TRUTHS_STAGED=$(echo "$STAGED" | grep -E '^marketing-truths\.json$' || true)
if [[ -z "$TRUTHS_STAGED" ]]; then
  cat >&2 <<EOF

🛑  marketing-truth hook: customer-facing files staged but
    marketing-truths.json is NOT staged in the same commit.

    Files that triggered this:
$(echo "$CUSTOMER_FACING_FILES" | sed 's/^/      - /')

    Action: add or update product_claims entries in
    marketing-truths.json that correspond to the changed copy,
    then 'git add marketing-truths.json' before committing.

    Bypass: WAIVE_MARKETING_AUDIT="<reason>" git commit ...
EOF
  exit 1
fi

# Gate 3: marketing-truths.json must validate against the schema (if a
# validator is available). Best-effort; missing validator is a warning.
SCHEMA_FILE="${HOME}/cf-research/marketing-truth-hook/schema.json"
if [[ -f "$SCHEMA_FILE" ]]; then
  if command -v ajv >/dev/null 2>&1; then
    if ! ajv validate -s "$SCHEMA_FILE" -d "$TRUTHS_FILE" >/dev/null 2>&1; then
      echo >&2 ""
      echo >&2 "🛑  marketing-truth hook: marketing-truths.json fails schema validation."
      ajv validate -s "$SCHEMA_FILE" -d "$TRUTHS_FILE" 2>&1 | head -20 >&2
      echo >&2 ""
      echo >&2 "    Bypass: WAIVE_MARKETING_AUDIT=\"<reason>\" git commit ..."
      exit 1
    fi
  elif command -v python3 >/dev/null 2>&1 \
    && python3 -c "import jsonschema" 2>/dev/null; then
    if ! python3 -c "
import json, sys, jsonschema
schema = json.load(open('${SCHEMA_FILE}'))
data = json.load(open('${TRUTHS_FILE}'))
jsonschema.validate(data, schema)
" 2>/dev/null; then
      echo >&2 ""
      echo >&2 "🛑  marketing-truth hook: marketing-truths.json fails schema validation."
      python3 -c "
import json, jsonschema
schema = json.load(open('${SCHEMA_FILE}'))
data = json.load(open('${TRUTHS_FILE}'))
try:
    jsonschema.validate(data, schema)
except jsonschema.ValidationError as e:
    print(' ', e.message)
    print('  path:', list(e.absolute_path))
" >&2
      echo >&2 ""
      echo >&2 "    Bypass: WAIVE_MARKETING_AUDIT=\"<reason>\" git commit ..."
      exit 1
    fi
  else
    echo "⚠️  marketing-truth hook: no JSON-schema validator found (install ajv-cli or python jsonschema)"
    echo "    Skipping schema validation. Hook will still enforce other gates."
  fi
fi

# Gate 4: pattern-based linter on changed customer-facing files.
LINTER="${HOME}/cf-research/marketing-truth-hook/marketing-truth-lint.sh"
if [[ -x "$LINTER" ]]; then
  LINT_HITS=$(echo "$CUSTOMER_FACING_FILES" | xargs -r "$LINTER" 2>&1 || true)
  if [[ -n "$LINT_HITS" ]]; then
    cat >&2 <<EOF

⚠️  marketing-truth linter found high-risk patterns in customer-facing files:

${LINT_HITS}

    These patterns require explicit review (an entry in product_claims
    with verdict=IMPLEMENTED + file:line evidence). If you've already
    handled them in marketing-truths.json, this is informational.

    Hard-block on these requires WAIVE_MARKETING_LINT=<reason>
    in the future; for now this is a soft warning that does NOT fail
    the commit.

EOF
  fi
fi

# Gate 5: MARC-APPROVED trailer must be present in the commit message.
# Skip this check during merge / rebase / cherry-pick (commit message
# isn't user-authored in the normal flow).
COMMIT_MSG_FILE="${1:-.git/COMMIT_EDITMSG}"
if [[ -z "${GIT_REFLOG_ACTION:-}" ]] || [[ "${GIT_REFLOG_ACTION:-}" == "commit"* ]]; then
  if [[ -f "$COMMIT_MSG_FILE" ]]; then
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
  fi
fi

# All gates passed.
echo "✓ marketing-truth hook: ${TRUTHS_FILE##*/} updated, MARC-APPROVED trailer present, $(echo "$CUSTOMER_FACING_FILES" | wc -l) customer-facing file(s) gated."
exit 0
