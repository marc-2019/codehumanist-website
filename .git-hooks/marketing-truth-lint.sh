#!/usr/bin/env bash
#
# Marketing-truth linter — pattern sweep for high-risk product claims.
#
# Called by the pre-commit hook on customer-facing files. Standalone
# usage:
#
#   marketing-truth-lint.sh path/to/file.html [path/to/llms.txt ...]
#
# Output: file:line: pattern matched line content
# Exit: 0 if no hits, 0 + non-empty stdout if hits (advisory only).
#       Hard-block is the hook's job.
#
# Patterns are deliberately broad — false-positive-tolerant. The hook
# requires the human to either (a) add the claim to product_claims with
# evidence, or (b) waive with WAIVE_MARKETING_LINT.
#
# Introduced 2026-04-30 as part of Stage 3 marketing-truth prevention.

set -e

if [[ $# -eq 0 ]]; then
  exit 0
fi

# Categories of high-risk patterns.
# Each pattern is grep -E (extended regex), case-insensitive.
declare -A PATTERNS=(
  # Automation / tracking / monitoring claims (the most common
  # over-claim pattern in the 2026-04-30 audit).
  ['automation:auto']='\b(automated|automatically|monitors?|tracking|tracks)\s+(your|all|any|every|incident|complian|risk|transaction|sanction|breach|expir|certif|emission|temperature|inventory|payment)'
  ['automation:real-time']='\breal-?time\b'
  ['automation:notify']='\b(notif(y|ies|ication)|alert)s?\s+(you|on|when)\b'

  # Customer count claims that aren't easily verifiable.
  ['count:hundreds']='\b(hundreds|thousands|tens? of (thousands|hundreds))\b\s+of'
  ['count:trusted']='\btrusted by\s+\d'
  ['count:N-customers']='\b\d+(\.\d+)?[kKmM]?\+?\s+(customer|user|client|tradies|subscriber|business)'

  # Status-pill claims.
  ['status:live-strong']='\bgo(es|ing)? live\b|\b(now |is )(live|available|launched|shipped)\b'
  ['status:available-now']='available now\b'

  # Partner / certification claims (CF directive: never claim without
  # signed agreement).
  ['partner:anthropic']='\b(anthropic|claude)\s+(partner|certified|certified architect|cca)'
  ['partner:microsoft']='\bmicrosoft\s+(partner|certified|gold partner)'
  ['partner:aws']='\bamazon\s+(partner|certified)|\baws\s+(partner|certified|advanced tier|premier)'
  ['partner:iso-soc']='\b(iso\s?27001|soc\s?2|nzism|fedramp|hipaa)\s+(certified|compliant|attested)'

  # Regulator-sensitive vocabulary (compliance/financial/health).
  ['regulator:aml']='\b(transaction monitoring|sanctions screening|sar|str|enhanced due diligence|edd|pep screening)\b'
  ['regulator:hipc']='\bhealth information privacy code\b'
  ['regulator:nzism']='\bnzism\b'

  # Verification / verification-as-platform claims (ProofOnce-class).
  ['verify:platform']='\b(document|identity)\s+verification\s+platform\b'

  # Promise verbs for security/privacy that need audit.
  ['security:never']='\b(never|cannot|will not)\s+(modif|chang|writ|access|read|store|share|sell)'
  ['security:read-only-absolute']='\bis read-?only\b'

  # AI-ingestion-specific risk: implying AI agents will hallucinate
  # the product as more capable than it is.
  ['ai:replace']='\breplaces?\s+(your|the|all)\s+(accountant|lawyer|consultant|auditor|hr team)'
)

# Run the sweep.
HITS=0
for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    continue
  fi
  for category in "${!PATTERNS[@]}"; do
    pattern="${PATTERNS[$category]}"
    matches=$(grep -niE "$pattern" "$file" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      while IFS= read -r line; do
        printf '  %s:%s [%s]\n' "$file" "$(echo "$line" | cut -d: -f1)" "$category"
        printf '    %s\n' "$(echo "$line" | cut -d: -f2- | sed 's/^[[:space:]]*//' | head -c 160)"
      done <<< "$matches"
      HITS=$((HITS + 1))
    fi
  done
done

exit 0
