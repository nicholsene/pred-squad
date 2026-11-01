# Instructions for coding agents (Codex, Claude)

Read **[PLAN.md](PLAN.md)** before doing anything. It holds the priorities, who owns what, Eric's decisions and the status log.

- Claim work in PLAN.md's Priorities table before starting; don't take a priority another agent owns.
- After finishing or stopping, add a short entry at the top of PLAN.md's Status log (date, who, what changed, what's verified, what's left).
- Put new plans, design notes and decisions in PLAN.md — not in new top-level markdown files.
- Runbooks: COUNTERBUILD.md (patch review), SCANNER_CORPUS.md (private photo corpus). Keep them current when you change those systems.
- Pull with rebase before work; run the relevant tests from `.github/workflows/test.yml` before pushing.
- Never commit private photos, labels, credentials or `.scan-private/`. No paid APIs or services without Eric's approval.
