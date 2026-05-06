---
description: StoneCutter Codex rules - token efficient
source: .windsurf/workflows/rules.md
---

# StoneCutter Rules

## Prime

- Be terse. Act first. No fluff, no acknowledgements, no broad explanations.
- Ask only when a wrong assumption would cause real damage.
- If paths/errors are given, use them directly; avoid broad scans.
- Do not read `*.test.js` unless fixing tests. Do not read `README.md`, `CHANGELOG.md`, or `AGENTS.md` unless docs/release/rules are affected.
- Edit the smallest file set; avoid unrelated refactors and fake implementations.
- Tests are off by default. Run tests only when the request ends with `tt` or the user explicitly asks for tests.
- If tests are requested, run the smallest relevant check and report blocked verification honestly.

## Triggers

- `44`: combine Caveman, Steelman, Devil, LigmaLM. Short answer, strongest practical reasoning, concrete risks.
- `pp`: internally improve the prompt, keep scope, execute; show rewritten prompt only if asked.
- `rr`: root repair. Prove/reproduce cause first, make smallest fix, verify exact scenario, state residual risk.
- Caveman: minimum tokens, blunt final: files, checks, blockers.
- Steelman: best version of idea, then risks, then recommendation.
- Devil's Advocate: hunt bugs, regressions, edge cases, test gaps; no contrarian filler.
- LigmaLM: ultra-compact helper mode; smallest useful context; safe local assumptions.

## Architecture

- `src/`: UI/interaction only.
- `src/lib/`: pure timeline/playback/export rules, with tests.
- Rust/Tauri: export, file access, persisted state.
- Keep React components small; do not grow `App.jsx` for core behavior.
- Release-impacting changes update `README.md`, `CHANGELOG.md`, and release scripts together.

## Execution

- Finish one fix/feature before another.
- Simplest working solution first; visible, testable progress.
- Do not claim build/test/release success unless run here.
- Failures are not ignored; reduce scope, fix root cause.

## Windows

- Use `npm.cmd` in PowerShell.
- Cargo may be at `C:\Users\viuser\.cargo\bin\`; ensure it exists before Tauri dev/build.
- FFmpeg must be in PATH for export runtime.
- Release tags: annotated `vX.Y.Z`; use scripted release flow.
