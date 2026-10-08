# STATUS

- Project: rcan-assurance (brief: kit/briefs/rcan-assurance.md)
- Host: Anthropic cloud container (WORKSPACE <WORKSPACE>, SANDBOX_ROOT
  <SANDBOX_ROOT>), because Craig's laptop was running mcp-tape at the same time.
- Phase: done. Published 2026-10-08 (UTC) at https://github.com/craigm26/regen-rcan-assurance.
- Released: impl/ts from r03 and impl/py from r04, both at spec-v1.0.2 (clean runs). main carries
  spec-v1.0.3 (two open items, one wording fix, one case); both releases pass its suite 469/469.
- Blind runs used: 4 of 6 (r01 not clean, r02 orphaned, r03 and r04 clean)
- CI: run 37712961722 on main (40d62b5), ubuntu-latest: purity ok (r03, r04 @ spec-v1.0.2),
  auditor self-test 17/17, ts 9 own tests and 468/468, py 28 own tests and 468/468.
- Running processes: none
- Done: WRITEUP.md, README.md, kit/posts/rcan-assurance.md, kit/posts/rcan-upstream-note.md (filed as rcan-spec#223),
  publish-gate scan (history rewritten to drop container paths and the private repo name; all
  ledger IDs re-verified), publication record in PROVENANCE.md.
- Decided by Craig (2026-10-07): fixtures treated as CC BY 4.0 and attributed; `publish`.
- Upstream: filed 2026-10-08 (UTC) as RobotRegistryFoundation/rcan-spec#223, with PRs
  rcan-spec#224 (draft) and #225, rcan-ts#55 and #56, rcan-py#66 (draft) and #67; none merged.
  Each pair merged locally passes this suite: 438/438, 431/431, 277/277 (ledger upstream.1,
  upstream.1-ts, upstream.1-port; PROVENANCE).
