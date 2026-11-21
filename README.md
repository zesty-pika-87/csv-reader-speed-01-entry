# Fast CSV reader — exact csv-reader 1.0.0 semantics

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/zesty-pika-87/csv-reader-speed-01-entry/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/zesty-pika-87/csv-reader-speed-01-entry/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers every
case exactly as csv-reader does — same `{columns, rows, errors}`, same broken-row
policy (BOM, CRLF, stray CR, quoted fields, `""` escapes, quote junk,
unterminated quotes, short/long rows) — in much less CPU time.

## How it is fast

The reference walks the text one character at a time, building every field a
character at a time. This reader instead:

- jumps from one delimiter to the next with `indexOf` / a single delimiter
  regex and slices whole fields at once;
- splits a whole quote-free record with `String.split(',')`;
- jumps between quotes with `indexOf('"')` in quoted fields, collecting `""`
  segments only when they exist;
- keeps the rare broken-row paths (stray CR, quote junk, unterminated quotes,
  newlines inside quotes) on separate slow paths that reproduce the reference
  exactly, error order included.

## Layout

- `solve.js` — the parser; `run(input)` returns `{columns, rows, errors}`.
- `main.ts` — the house driver: reads `/input/cases.json`, answers each case
  with `run`, writes `/output/answers.json`.

## License

MIT — see [LICENSE](LICENSE).
