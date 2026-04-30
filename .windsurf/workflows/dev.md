---
description: Tauri dev server start and Windows setup checks
---

# Tauri Dev Start

## Before You Start

Make sure `cargo` works in the current shell:

```powershell
cargo --version
```

If that fails, add Rust for the current session:

```powershell
$env:PATH += ";C:\Users\viuser\.cargo\bin"
```

Then start the dev server:

```powershell
npm.cmd run tauri dev
```

## Notes

- First Rust build takes longer than later builds.
- If this workspace includes release or installer changes, run `npm.cmd test` and `npm.cmd run lint` before you consider the work done.
- Build installer artifacts only through the scripted workflow.

## Optional PowerShell Setup

If npm scripts are blocked by policy:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## Release Reminder

- Run the precheck before any release.
- Build releases only from a clean Git worktree.
- Push tags with the explicit push step after the release commit and tag are created.
