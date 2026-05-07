# StoneCutter Agent Instructions

Agents (Codex, Cursor, and similar) working in this repository must follow the project rules in:

- `.codex/rules/stonecutter.codexrules.md` (canonical for Codex CLI and documentation)
- `.cursor/rules/stonecutter.mdc` (mirrors the same rules for Cursor; **always applied**, including keyword triggers `44`, `pp`, `rr`, etc.)

The rules are the Codex-formatted version of the original Windsurf workflow rules from `.windsurf/workflows/rules.md`. Keep the Codex file as the primary reference; when you change project-wide rules, update **both** `.codex/rules/stonecutter.codexrules.md` and `.cursor/rules/stonecutter.mdc` together (or only the Codex file first, then sync Cursor). Update the Windsurf rules separately when editor-specific behavior is needed.

When making implementation or behavior changes, keep supporting files current as part of the same task. This includes `CHANGELOG.md`, README/docs, and agent or editor rules when they are affected.
