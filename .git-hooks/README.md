# Marketing-truth pre-commit hook

This directory holds a vendored copy of the **marketing-truth pre-commit hook** that gates customer-facing copy changes against the per-repo `marketing-truths.json` registry.

Source of truth: `~/cf-research/marketing-truth-hook/` (Marc's machine).
CF standing directive: `customer-facing-copy-requires-product-claim-audit` (severity: critical, active in `cf_standing_directives`).
Introduced: 2026-04-30 — Stage 3 of the marketing-truth recall.

## What it does

When you stage customer-facing files (HTML, `llms.txt`, `robots.txt`, `sitemap.xml`, JSON-LD blocks, `modules.json`, `manifest.json`, README files, landing-page TSX/CSHTML, etc.), the hook requires:

1. `marketing-truths.json` exists at the repo root.
2. `marketing-truths.json` is updated in the same commit.
3. The commit message contains a `MARC-APPROVED:` trailer.
4. (Soft) Pattern linter sweep for high-risk product claims emits warnings — does not yet hard-block.

If any gate fails, the commit is rejected with clear remediation instructions.

## Bypass (for emergency or non-customer-facing edits)

```bash
WAIVE_MARKETING_AUDIT="<reason>" git commit ...
```

The bypass is logged to `~/.config/instilligent/waivers.log` and (in the cron-paired environment) emails Marc.

## Updating

The hook is vendored — re-run the installer from the source dir to update:

```bash
~/cf-research/marketing-truth-hook/install.sh /path/to/this/repo
```

Then commit any changes in `.git-hooks/`.

## Quick test

```bash
# Should block:
echo "<!-- test -->" >> llms.txt && git add llms.txt && git commit -m "test"

# Should pass:
echo "<!-- test -->" >> llms.txt && git add llms.txt
# ...also stage marketing-truths.json with a corresponding product_claims update...
git commit -m "test
MARC-APPROVED: 2026-04-30 testing hook"
```

## See also

- Schema: `~/cf-research/marketing-truth-hook/schema.json`
- Hook source: `~/cf-research/marketing-truth-hook/pre-commit-hook.sh`
- Linter source: `~/cf-research/marketing-truth-hook/marketing-truth-lint.sh`
- CF directive: `~/cf-research/cf-directives/2026-04-30-marketing-audit-required.md`
- 2026-04-30 master plan: `~/cf-research/marketing-audits/MASTER-PLAN-2026-04-30.md`
