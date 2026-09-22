# Independent cabin oracle: first verification

Command: `npx vitest run tests/ai/evals/feature05-eval.test.ts`

The first run after adding independent expected stays had 18 tests: 17 passed
and 1 failed. The full 69-case test failed on `concierge-capacity-03`, whose
prompt says "sleeps two take four guests". The old mock's broad English-number
regex selected two; the independent expected guest count is four. The new
`capacity-budget` and `available-only` checks rejected it. All 12 new corruption
and wrong-argument negative tests passed (they correctly detected violations).

The mock parser was narrowed to the number immediately preceding guests,
adults or people. The fixed expected stay and production tool were unchanged.
This note summarizes the actual console result; it is not a saved full JSON
report. The previous offline report is preserved in the adjacent
`2026-09-21-before-independent-oracle.json` and `.md` files.
