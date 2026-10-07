# Build notes

- Build: nothing (`build` is empty in REGEN.json).
- Test: `python3 -m unittest -q` (Windows: `py -3 -m unittest -q`), run from this folder.
- Driver: `python3 driver.py` reads JSON lines on stdin and writes one response line per request.
- CLI: `python3 cli.py verify <chain-file> [<envelope-file>] [--json] [--head <hash>]`.
- Layout: `lib.py` (canonical JSON, hashes, validation, chain, audit, replay), `driver.py`, `cli.py`, `test_all.py`.
- Source is about 480 non-blank lines against the budget of 500. `test_all.py` has a check for this.

## Things that surprised me

- Python's `json` accepts `NaN` and `Infinity` by default, and turns integers into `int`. The parser passes
  `parse_constant` and `parse_int=float` to fix both. A float conversion of a long digit string is correctly rounded.
- `repr(float)` already gives the shortest round-trip digits, so the ECMAScript number rule only needs
  re-laying out those digits.
- Python's `json` joins valid `😀` pairs into one character and leaves lone surrogates in the string,
  which is what lets `invalid_string` be detected when writing.
- Sorting names by UTF-16 code units needs `surrogatepass` when encoding, so that a bad name is still sortable
  and reaches the error check.
- The shell was restricted to `py`/`python`/`python3`, `mkdir`, `ls` and `git`. Shell pipes were not available.
