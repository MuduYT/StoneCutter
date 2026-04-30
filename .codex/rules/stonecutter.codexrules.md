---
description: Codex project rules for StoneCutter development
source: .windsurf/workflows/rules.md
---

# StoneCutter Codex Rules

## Architecture

- Frontend in `src/` is UI and interaction logic only.
- Pure timeline, playback, and export rules belong in `src/lib/` first, with tests.
- Rust/Tauri owns export, file access, and persisted state.
- Keep React components small; do not grow `App.jsx` for new core behavior.
- If a change affects release flow, update `README.md`, `CHANGELOG.md`, and the release scripts together.

## Execution

- Finish one feature or fix before starting the next one.
- Use the simplest working solution first.
- Prefer visible, testable progress over hidden refactors.
- Do not introduce fake implementations unless they unblock a visible editor flow.
- Do not claim a build, installer, or release succeeded unless it was actually run in this workspace.
- Keep related project files up to date when behavior changes, especially `CHANGELOG.md`, documentation, and release rules.

## Quality Gates

- Run the relevant tests before marking work done.
- For release or installer changes, verify `npm.cmd test`, `npm.cmd run lint`, and the affected release script.
- Keep the Git worktree clean before creating a release tag or installer artifact.
- Do not silently ignore broken scripts, failed commands, or exit-code issues.

## Debugging

- When something fails, reduce scope before adding complexity.
- Fix breakages immediately instead of stacking temporary workarounds.
- Prefer small pure functions that are easy to test.

## Windows Dev Environment

- Use `npm.cmd` in PowerShell.
- Rust/Cargo is installed at `C:\Users\viuser\.cargo\bin\` but may not be in PATH for IDE terminals.
- Before running `npm.cmd run tauri dev` or any installer build, ensure cargo is available in the current shell.
- PowerShell execution policy may need `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`.
- First Tauri build takes longer than later builds.
- FFmpeg is only needed for the export path and must be present in system PATH at runtime.
- Release tags use the annotated `vX.Y.Z` format.
- Release builds must use the scripted workflow, not manual copying of artifacts.
