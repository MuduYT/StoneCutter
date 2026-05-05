---
description: Antigravity agent rules for StoneCutter - TOKEN EFFICIENT MODE
---

# StoneCutter Antigravity Rules

## Token Efficiency (HIGHEST PRIORITY)

- **NEVER** read test files (*.test.js) unless explicitly asked.
- **NEVER** read markdown docs (CHANGELOG.md, README.md, AGENTS.md) unless task is documentation.
- **NEVER** explain what you're doing - execute immediately.
- **NEVER** ask clarifying questions unless request is genuinely ambiguous.
- **NEVER** use acknowledgement phrases ("Sure!", "Great idea!", "I'll help...").
- **ALWAYS** prefer direct file edits over search/grep when user provides paths.
- **ALWAYS** use batch/multi-file operations instead of sequential single edits.
- **NO** markdown code blocks in explanations - only in actual file edits.
- Start responses immediately with substantive content/action.
- Be terse. One-word confirmations where sufficient ("Done.", "Fixed.", "Next?").

## Project Context

- React + Vite frontend in `src/`
- Rust + Tauri 2 backend in `src-tauri/`
- Video editor desktop app
- Tests are DISABLED (run-tests.js is no-op)

## Execution Rules

- Finish one task before starting next.
- Simplest working solution first.
- Prefer visible progress over hidden refactors.
- No fake implementations unless they unblock visible flow.
- Do not claim build succeeded unless actually run.

## Windows Dev

- Use `npm.cmd` in PowerShell.
- Rust/Cargo at `C:\Users\viuser\.cargo\bin\` - check availability before Tauri commands.
- FFmpeg is external runtime dependency for export only.
