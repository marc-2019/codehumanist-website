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
# Hardened 2026-05-11 (task 2e459fda) — husky-aware installer + WARN
# on non-exec hook + chain-not-clobber + perms verification.
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

# Gate 5: MARC-APPROVED trailer enforcement — moved to commit-msg phase.
# `.git/COMMIT_EDITMSG` is empty at pre-commit time, so the check used to
# require a manual `cp` of the message before each commit. The trailer
# check now lives in marketing-truth-commit-msg.sh which git invokes with the
# commit-message file path as $1. See: split 2026-05-11.

# Gate 7: Brand-name dictionary — block portfolio brand violations.
# Reads .git-hooks/brand-name-dictionary.json (vendored by install.sh).
# Skipped gracefully if dictionary file or python3 unavailable so a
# parallel branch lacking the install doesn't fail spuriously.
#
# Introduced 2026-05-12 (CF task c7ff90b3) after the "Ingenious Limited"
# untracked-draft finding on codehumanist 404/500. The existing gates
# (truths.json co-stage + MARC-APPROVED trailer) structurally cannot
# detect brand-spelling violations inside the staged file content; this
# gate does that pattern sweep with context-aware allowlisting for
# historical recall entries.

BRAND_DICT="${REPO_ROOT}/.git-hooks/brand-name-dictionary.json"
if [[ -f "$BRAND_DICT" ]] && command -v python3 >/dev/null 2>&1; then
  # Pass the dictionary + customer-facing files to python3 via env vars
  # to avoid shell quoting issues. python3 prints offending matches one
  # per line in the format:
  #   FILE:LINE:SEVERITY:PATTERN -> REPLACEMENT :: REASON :: LINETEXT
  # Exit 0 = no blockers; exit 1 = at least one BLOCKER found; exit 2 =
  # internal error (treated as soft warn).
  # NOTE: `set -e` would abort on `X=$(cmd)` if cmd exits non-zero, so we
  # temporarily disable it around the capture and re-enable after.
  set +e
  BRAND_OUT=$(BRAND_DICT="$BRAND_DICT" BRAND_FILES="$CUSTOMER_FACING_FILES" python3 - <<'PY' 2>&1
import json, os, re, sys

dict_path = os.environ["BRAND_DICT"]
files = [f for f in os.environ.get("BRAND_FILES", "").splitlines() if f.strip()]

try:
    data = json.load(open(dict_path))
except Exception as e:
    print(f"WARN: failed to load brand dictionary: {e}", file=sys.stderr)
    sys.exit(2)

violations = data.get("violations", [])
nzbn_map = data.get("nzbn_to_legal_name", {})

# Pre-compile regexes once.
compiled = []
for v in violations:
    pat = v.get("pattern")
    if not pat:
        continue
    flags = 0 if v.get("case_sensitive", False) else re.IGNORECASE
    try:
        rx = re.compile(pat, flags)
    except re.error as e:
        print(f"WARN: bad regex {pat!r} in dict: {e}", file=sys.stderr)
        continue
    compiled.append((rx, v))

# NZBN pattern: 13-digit NZ business number.
nzbn_rx = re.compile(r'\b(\d{13})\b')

violation_count = 0

def line_in_allowlist_context(lines, lineno, allowlist, window=10):
    if not allowlist:
        return False
    lo = max(0, lineno - 1 - window)
    hi = min(len(lines), lineno + window)
    chunk = "\n".join(lines[lo:hi]).lower()
    return any(kw.lower() in chunk for kw in allowlist)

for fpath in files:
    if not os.path.isfile(fpath):
        continue
    try:
        with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except Exception as e:
        print(f"WARN: cannot read {fpath}: {e}", file=sys.stderr)
        continue

    whole_file = "\n".join(lines)
    for idx, line in enumerate(lines, start=1):
        for rx, v in compiled:
            if rx.search(line):
                allow = v.get("context_allowlist", [])
                if allow and line_in_allowlist_context(lines, idx, allow):
                    continue
                severity = v.get("severity", "BLOCKER")
                replacement = v.get("replacement", "(see dictionary)")
                reason = v.get("reason", "")
                snippet = line.strip()[:160]
                # All un-allowlisted matches fail the commit. Severity is
                # metadata for downstream reporting / triage but does not
                # change the gate verdict.
                print(f"{fpath}:{idx}:{severity}:{rx.pattern} -> {replacement} :: {reason} :: {snippet}")
                violation_count += 1

        # NZBN cross-check: any 13-digit number in the line that matches a
        # known NZBN must appear alongside the canonical legal name in the
        # file. Heuristic: if NZBN X is in this line and the canonical
        # legal-name for X is NOT anywhere in the file, flag BLOCKER.
        for m in nzbn_rx.finditer(line):
            nzbn = m.group(1)
            if nzbn in nzbn_map:
                expected = nzbn_map[nzbn]
                if expected not in whole_file:
                    print(f"{fpath}:{idx}:BLOCKER:NZBN {nzbn} -> {expected} :: NZBN present but canonical legal name '{expected}' not found in same file :: {line.strip()[:160]}")
                    violation_count += 1

if violation_count > 0:
    sys.exit(1)
sys.exit(0)
PY
)
  BRAND_RC=$?
  set -e

  if [[ $BRAND_RC -eq 1 ]]; then
    cat >&2 <<EOF

🛑  marketing-truth hook: brand-name dictionary violations found.

$(echo "$BRAND_OUT" | sed 's/^/    /')

    Action: fix the brand name(s) above. Common cases:
      - "Ingenious"     → "Instilligent"
      - "Boss Board"    → "BossBoard"
      - "TradeMate"     → "BossBoard"     (consolidated 2026-05-11)
      - "Our New Normal"→ "Instilligent"  (brand sunset 2026-05-02)
      - "Cortex Forge"  → "CortexForge"
      - Mismatched NZBN → ensure the canonical legal name appears in the same file

    "Our New Normal" / "ONN" are allowed inside historical recall_history
    entries (within ±10 lines of one of: recall_history, previous_overclaim,
    historical, sunset).

    Bypass: WAIVE_MARKETING_AUDIT="<reason>" git commit ...

    Source: ~/cf-research/marketing-truth-hook/brand-name-dictionary.json
    CF task: c7ff90b3 (introduced 2026-05-12 after the "Ingenious Limited"
    untracked-draft finding on codehumanist 404/500).
EOF
    exit 1
  elif [[ $BRAND_RC -eq 2 ]]; then
    echo "⚠️  marketing-truth hook: brand-dict gate hit an internal error — skipping (see stderr)"
    echo "$BRAND_OUT" >&2
  elif [[ -n "$BRAND_OUT" ]]; then
    # Non-fatal WARN lines emitted by the python gate (e.g. bad regex in
    # dict, file-read failure). Print as advisory; do not fail.
    echo "⚠️  marketing-truth brand-dict (advisory warnings):" >&2
    echo "$BRAND_OUT" | sed 's/^/    /' >&2
  fi
fi

# All pre-commit gates passed.
echo "✓ marketing-truth pre-commit: ${TRUTHS_FILE##*/} updated, $(echo "$CUSTOMER_FACING_FILES" | wc -l) customer-facing file(s) gated. (trailer check at commit-msg phase)"
exit 0
