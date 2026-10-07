# STATUS

- Project: rcan-assurance (brief: kit/briefs/rcan-assurance.md)
- Host: Anthropic cloud container (WORKSPACE <WORKSPACE>, SANDBOX_ROOT
  <SANDBOX_ROOT>), because Craig's laptop was running mcp-tape at the same time.
- Phase: 6 (promote) done; Phase 7 (writeups) next. Tags: spec-v1.0.0 … spec-v1.0.3.
- Released: impl/ts from r03 and impl/py from r04, both at spec-v1.0.2 (clean runs). main carries
  spec-v1.0.3 (two open items, one wording fix, one case); both releases pass its suite 469/469.
- Blind runs used: 4 of 6 (r01 not clean, r02 orphaned, r03 and r04 clean)
- CI: not run yet (repo not on GitHub). ci-impl.mjs passes locally for ts and py on Linux;
  py also checked on Python 3.11.17 (28/28 own tests).
- Running processes: none
- Next: WRITEUP.md, README.md, kit/posts/rcan-assurance.md, then the publish gate (Craig types publish).
