---
description: Codex project rules for StoneCutter development
source: .windsurf/workflows/rules.md
---

# StoneCutter Codex Rules

## Architecture

- Frontend (JS/React) is UI only.
- Backend (Rust/Tauri) owns logic, calculations, and persisted editing state.
- Important actions should go through Tauri commands.
- Do not put business logic in the frontend.
- Keyframes and effects are stored and managed in the backend.
- The frontend displays state and collects user input.

## Execution

- Finish one feature before starting the next one.
- Use the simplest working solution first.
- Prototype or fake implementations are acceptable when they create visible progress.
- Every change should have a visible or testable result.
- Keep related project files up to date when behavior changes, especially `CHANGELOG.md`, documentation, and agent rules.

## Early-Stage Constraints

- Do not start with complex video processing.
- Do not start with FFmpeg integration unless explicitly required.
- Do not start with GPU or shader optimization.

## Debugging

- When something fails, simplify instead of expanding scope.
- Test after each meaningful change.
- Fix breakages immediately rather than deferring them.
- If blocked, step back and reduce the problem size.

## Mindset

- Progress before perfection.
- Rough working code is better than no code.
- Make it work first, then clean it up.
