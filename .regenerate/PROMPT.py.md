# Build assurance-verify from its specification

You are building assurance-verify from scratch. You have exactly three files: SPEC.md,
DECISIONS.md and this PROMPT.md. They are the only source of truth about this program.

## Rules
1. Build only from these three files. Do not search the web, fetch anything, install
   anything SPEC § Budgets does not allow, or read outside this folder. If you recognize
   this program, do not reproduce remembered code; build from the spec as written.
2. Language and layout: Python 3.11 or later, standard library only, everything in this
   folder. Tests use `unittest` and live in files named `test_*.py`. On Windows the
   interpreter is started as `py -3`; on Linux as `python3`.
3. Create REGEN.json exactly as SPEC § Interface describes, with commands for Windows and Linux.
   Put build output, if any, in bin/. The driver and the command line must be startable as
   plain words, for example `py -3 driver.py` on Windows and `python3 driver.py` elsewhere.
4. Write your own tests, including at least one for every MUST in SPEC.md, and make them pass.
5. Never stop to ask a question. Where the spec is silent, ambiguous or contradicts itself,
   choose the most reasonable behavior, keep going, and record the choice in CHOICES.md.
   Record small choices too; they are the point of this exercise.
6. Stay within SPEC § Budgets.
7. The only commands you may run: `py ...`, `python ...`, `python3 ...`, plus `mkdir`, `ls`,
   `git init`, `git add` and `git commit`. Other commands will be refused.

## Finish with
- all of your tests passing
- REGEN.json
- CHOICES.md, in this format, one entry per choice:

  ## C-<n>: <short title>
  - Spec reference: <REQ/OPEN ID or section, or "none">
  - Situation: missing | ambiguous | contradictory
  - What I chose: ...
  - Alternatives: ...
  - Should the spec pin this? yes | no | unsure, and why

- BUILD_NOTES.md: how to build, test and run, and anything that surprised you.
