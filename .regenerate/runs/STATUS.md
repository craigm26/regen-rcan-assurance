# STATUS

- Project: rcan-assurance (brief: kit/briefs/rcan-assurance.md)
- Host: Anthropic cloud container (WORKSPACE <WORKSPACE>, SANDBOX_ROOT
  <SANDBOX_ROOT>), because Craig's laptop was running mcp-tape at the same time.
- Phase: 8, at the publish gate (waiting for Craig to type `publish`). Tags: spec-v1.0.0 … spec-v1.0.3.
- Released: impl/ts from r03 and impl/py from r04, both at spec-v1.0.2 (clean runs). main carries
  spec-v1.0.3 (two open items, one wording fix, one case); both releases pass its suite 469/469.
- Blind runs used: 4 of 6 (r01 not clean, r02 orphaned, r03 and r04 clean)
- CI: not run on GitHub yet. Simulated in a fresh clone of the bundle: purity ok, auditor
  self-test 17/17, ci-impl ts 468/468 and py 468/468 (Linux); py also checked on Python 3.11.17.
- Running processes: none
- Done: WRITEUP.md, README.md, kit/posts/rcan-assurance.md, kit/posts/rcan-upstream-note.md (not filed),
  publish-gate scan (history rewritten to drop container paths and the private repo name; all
  ledger IDs re-verified). A git bundle of the whole repo sits outside it for the push.
- Open for Craig: confirm the fixtures' license (CC BY 4.0 assumed); type `publish`; choose how
  the repo gets created (this session cannot create repos on his account).
