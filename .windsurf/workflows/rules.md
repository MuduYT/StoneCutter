---
description: Core project rules for StoneCutter development - TOKEN EFFICIENT MODE
---

# StoneCutter Rules

## Token Efficiency (HIGHEST PRIORITY)

- **NEVER** read test files (*.test.js) unless explicitly asked.
- **NEVER** read markdown docs (CHANGELOG, README, AGENTS) unless task is documentation.
- **NEVER** explain actions - execute immediately.
- **NEVER** use acknowledgement phrases ("Sure!", "Great idea!").
- **ALWAYS** prefer direct edits over search when paths are provided.
- **ALWAYS** batch edits instead of sequential changes.
- **NO** code blocks in explanations - only in actual edits.
- Start with substantive content immediately.

## Architecture

- Frontend in `src/` is UI and interaction logic only.
- Pure timeline, playback, and export rules belong in `src/lib/` first, with tests.
- Rust/Tauri owns export, file access, and persisted state.
- Keep React components small; do not grow `App.jsx` for new core behavior.
- If a change affects release flow, update `README.md`, `CHANGELOG.md`, and the release scripts together.

## Working Style

- Finish one feature or fix before starting the next one.
- Use the simplest working solution first.
- Prefer visible, testable progress over hidden refactors.
- Do not introduce fake implementations unless they unblock a visible editor flow.
- Do not claim a build, installer, or release succeeded unless it was actually run in this workspace.

## Quality Gates

- Run the relevant tests before marking work done.
- For release or installer changes, verify `npm.cmd test`, `npm.cmd run lint`, and the affected release script.
- Keep the Git worktree clean before creating a release tag or installer artifact.
- Do not silently ignore broken scripts, failed commands, or exit-code issues.

## Debugging

- When something fails, reduce scope before adding complexity.
- Fix breakages immediately instead of stacking temporary workarounds.
- Prefer small pure functions that are easy to test.

## Windows Setup

- Use `npm.cmd` in PowerShell.
- Ensure Rust/Cargo is available from `C:\Users\viuser\.cargo\bin\` if the IDE terminal does not inherit PATH.
- Before Tauri dev/build, make sure `cargo --version` works in the current shell.
- FFmpeg is only needed for the export path and should be treated as an external runtime dependency.

## Git and Release Safety

- Never use destructive Git commands unless the user explicitly asks for them.
- Keep release commits, version bumps, tags, and installer outputs aligned.
- Use the annotated `vX.Y.Z` tag format for releases.
- Push releases only through the explicit push step, not as part of an accidental build.
