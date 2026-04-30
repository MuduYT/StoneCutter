# StoneCutter

StoneCutter is a Tauri 2 + React 19 desktop video editor prototype. The app currently supports project folders, `.stonecutter` project files, recent projects, media import, source-preview In/Out ranges, timeline drag/drop, snapping, trimming, multi-selection, image clips, audio-only clips, playback, and FFmpeg-based MP4 export.

## Development

Use `npm.cmd` on Windows PowerShell because `npm.ps1` can be blocked by execution policy.

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

`npm.cmd run build` may need to run outside the Codex sandbox on Windows because Vite/Rolldown can fail with `spawn EPERM` in sandboxed process spawning.

## Windows Installer

Prerequisites:

1. Install Rust with `rustup` and make sure `cargo` is in your PATH.
2. Install the Microsoft Visual C++ build tools if they are not already present.
3. Stay on Windows for the installer build. This project is configured for NSIS so it produces a `-setup.exe` installer.

Build command:

```powershell
npm.cmd run installer:win
```

The installer is written to `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.
If WebView2 is missing on the target machine, the installer uses Tauri's default bootstrapper flow.
The installer now uses the StoneCutter `icon.ico` asset and a short NSIS product description.

1-click script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

This script checks `npm.cmd` and `cargo`, installs Node dependencies if needed, runs tests and lint, and then builds the Windows installer.

## Release Versioning

Use this helper to bump the app version consistently across the repo:

```powershell
npm.cmd run release:bump -- 0.1.1
```

This updates `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and adds a release entry to `CHANGELOG.md`.

Shortcut commands:

```powershell
npm.cmd run release:patch
npm.cmd run release:minor
npm.cmd run release:major
npm.cmd run release:commit
npm.cmd run release:tag
npm.cmd run release:push-tags
```

These read the current version from `package.json`, increment it, and sync the other release files the same way.
`release:commit` stages the release files and creates a `chore(release): vX.Y.Z` commit.
`release:tag` creates an annotated Git tag for the current version in the form `vX.Y.Z`.
`release:push-tags` pushes the current branch and follow-tags to the configured remote.

Precheck:

```powershell
npm.cmd run release:precheck
```

This prints the current version across the release files, checks for required tools, and reports whether the Git worktree is clean before you build or bump a release.
`ffmpeg` is only reported for the runtime export path; it does not block the Windows installer build.

Full release flow:

```powershell
npm.cmd run release:all -- patch
```

Use `patch`, `minor`, or `major`. This runs precheck, bumps the version, re-runs tests and lint, and then builds the Windows installer.
It stops immediately if the precheck fails or if any later step fails.
If everything succeeds, it creates a release commit and an annotated Git tag named `vX.Y.Z`.
After that you can run `npm.cmd run release:push-tags` to publish the branch and tags.

## Architecture

Keep feature logic out of `App.jsx` when it can be expressed as pure data transformations. New editor features should usually start in `src/lib` with tests, then be wired into the UI.

- `src/lib/timeline.js`: core timeline rules such as ripple insert, overwrite resolution, gap handling, trim bounds, media type detection, and source range normalization.
- `src/lib/playback.js`: pure playback decisions such as clip lookup, next clip lookup, playback target selection, source-time mapping, and virtual image playback time.
- `src/lib/exportSegments.js`: conversion from timeline clips/media into FFmpeg export segments, including gaps, media types, track modes, and absolute path validation.
- `src/lib/project.js`: `.stonecutter` project schema, project-name sanitizing, project document creation, and hydration from disk.
- `src/lib/*.test.js`: Node `node:test` coverage for core editor behavior. Add tests here before or with behavior changes.

## Project Files

New projects create a project folder with a `ProjectName.stonecutter` JSON file and a `Media/` folder reserved for future managed media.
The current implementation references imported media by absolute file path, so moving or deleting source media can make a project unable to preview or export those assets.
Use `Ctrl+S` or the project save button to write the current timeline, media list, source ranges, UI state, settings, and playhead to disk.

## Timeline Playback

The main timeline has its own playback focus separate from the source monitor. Playback continues through empty gaps and past the last clip using a virtual timeline clock, so the playhead does not stop just because no clip is under it.
Scrubbing resumes at the exact position: inside a clip it starts that clip, inside empty space it keeps running as gap playback.

Useful shortcuts:

- `Space` / `K`: play or pause the active monitor.
- `L`: start timeline playback from the current playhead, including gaps.
- `J`: step back quickly.
- `Comma` / `Period`: frame-step backward or forward.
- `Home` / `End`: jump to timeline start or current content end.

## Export Notes

The Tauri export path uses FFmpeg from the system PATH. Browser-imported files only have object URLs or filenames and cannot be exported by FFmpeg; use the Tauri file dialog for exportable source paths.

Audio-only timeline clips export as black video with trimmed audio so the MP4 timeline remains continuous.
