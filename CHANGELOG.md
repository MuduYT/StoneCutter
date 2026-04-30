# StoneCutter Update Log

## 2026-04-30 - Timeline Smooth Playback

### Bug Fixes
- Timeline-Playback stoppt am Ende des letzten Clips nicht mehr automatisch, sondern laeuft als leere Timeline weiter.
- Clip-Enden mit anschliessender Luecke wechseln jetzt sauber in eine virtuelle Timeline-Uhr statt stehenzubleiben.
- Scrubbing in leere Timeline-Bereiche setzt keinen alten Clip mehr als Playback-Ziel fort.
- Resume nach Scrubbing startet je nach Position korrekt Clip-Playback oder Gap-Playback.
- `L` startet die Timeline jetzt auch aus Luecken oder Bild-Clips heraus, statt nur das aktuelle `<video>`-Element anzuspielen.

### UX Changes
- Aktive leere Playback-Bereiche werden in der Timeline visuell als Gap/Tail hervorgehoben.
- Timeline-Fokus hebt den Ruler sichtbarer hervor, damit klar ist, welche Playback-Zone aktiv ist.

### Technical Changes
- Playback-Transitions fuer Clip-Ende, Gap-Start und Timeline-Ende liegen testbar in `src/lib/playback.js`.
- Timeline-Leerbereiche inklusive Tail nach dem letzten Clip liegen testbar in `src/lib/timeline.js`.

## 2026-04-30 - Release 0.1.1

### Release
- Version bump auf 0.1.1.
- Windows-Installer nutzt jetzt das StoneCutter-Icon und eine kurze NSIS-Beschreibung.
- `npm.cmd run release:all -- patch|minor|major` erstellt nach erfolgreichem Build ein annotiertes Git-Tag `vX.Y.Z`.

## 2026-04-30 - Project System

### Features
- Startscreen mit "Willkommen zu StoneCutter", "Neues Projekt", "Projekt oeffnen" und zuletzt benutzten Projekten.
- Neue Projekte erzeugen einen Projektordner mit `ProjectName.stonecutter` und vorbereitetem `Media/`-Ordner.
- Projektdateien speichern Medienliste, Timeline-Clips, Source In/Out, Video-Dauern, Playhead, Settings und UI-Zustand.
- Projektdateien koennen geoeffnet und ueber `Ctrl+S` oder den Projekt-Speicherbutton gespeichert werden.

### Technical Changes
- `src/lib/project.js` kapselt Projekt-Schema, Sanitizing, Dokument-Erzeugung und Hydration.
- Tauri-Commands fuer Projektordner-Erstellung, Projekt-Speichern und Projekt-Laden hinzugefuegt.
- Rust-Dependency-Versionen in `Cargo.toml` repariert und das Release-Bump-Skript gegen Dependency-Version-Ueberschreibung gehaertet.

## 2026-04-30 - Source Monitor Preview Cleanup

### UX Changes
- Source In/Out erscheint nur noch nach explizitem Klick auf ein Video in der Mediathek.
- Timeline-Klicks, Clip-Auswahl und Bilder blenden Source In/Out aus.
- Die Vorschau hat jetzt eine kompakte Player-Leiste im Stil eines Source-Monitors ohne zentrales Play-Overlay.
- In/Out wird direkt in der kleinen Vorschau-Timeline gesetzt statt ueber zwei separate Range-Regler.
- In/Out kann jetzt per Button auf die aktuelle Vorschau-Playhead-Position gesetzt werden.

### Bug Fixes
- Source-Preview und Haupttimeline haben getrennte Playback-Modi, damit Play im Source-Monitor nicht mehr versehentlich die Haupttimeline startet.
- Die Haupttimeline spielt leere Sequenzbereiche und Gaps jetzt mit einer virtuellen Timeline-Uhr ab, statt direkt zum naechsten Clip zu springen oder stehenzubleiben.
- Die Source-Preview-Timeline ist als Seek-Leiste bedienbar; In/Out werden ueber eigene Handles gesetzt.
- Pfeiltasten, Komma/Punkt und J/K/L steuern bei aktivem Source-Monitor die Vorschau statt der Haupttimeline.
- Projekt-Statusmeldungen blenden nach 1s ueber 0.5s aus und verschwinden automatisch.
- Mediathek/Source-Monitor und Haupttimeline haben jetzt explizite Fokus-Zustaende mit eigener Keyboard- und Playback-Route.
- Source-Monitor-Helfer fuer Sichtbarkeit, Clamping, Preview-Seek und Tastatursteuerung liegen testbar in `src/lib/sourceMonitor.js`.

## 2026-04-30 - Timeline Architecture Hardening

### Technical Changes
- **Timeline-Regeln extrahiert**: Ripple-Insert, Overwrite-Aufloesung, Gap-Handling, Trim-Grenzen und Medien-Typ-Erkennung liegen jetzt in `src/lib/timeline.js` statt direkt in `App.jsx`.
- **Source-Range-Normalisierung testbar**: In/Out-Clamping fuer Source-Preview und Mindest-Cliplaenge ist als reine Funktion gekapselt.
- **Unit-Test-Basis hinzugefuegt**: `npm.cmd test` prueft die wichtigsten Timeline-Regeln mit `node:test` ohne zusaetzliche Dependencies.
- **Export-Segment-Pipeline extrahiert**: Gap-Erzeugung, absolute Pfadvalidierung, Medien-Typen und `track_mode` fuer FFmpeg liegen jetzt in `src/lib/exportSegments.js` und sind getestet.
- **Playback-Entscheidungen extrahiert**: Clip-Suche, Next-Clip-Suche, Playback-Ziel und virtuelle Bild-Playback-Zeit liegen jetzt in `src/lib/playback.js` und sind getestet.
- **Testabdeckung erweitert**: `npm.cmd test` deckt jetzt 18 Kernfaelle fuer Timeline, Export und Playback ab.
- **README ersetzt Template**: Projekt-Setup, Architektur-Regeln, Testskripte und Export-Hinweise sind jetzt dokumentiert.
- **Windows-Installer-Workflow**: Tauri ist jetzt auf NSIS umgestellt und `npm.cmd run installer:win` erzeugt einen `-setup.exe` Installer fuer Windows.
- **1-Klick-Installer-Skript**: `scripts/build-installer.ps1` fuehrt Vorchecks, Tests, Lint und den Windows-Installer-Build nacheinander aus.
- **Release-Bump-Skript**: `scripts/bump-version.ps1` aktualisiert App-, Cargo- und Tauri-Versionen konsistent und fuegt einen Changelog-Release-Header hinzu.
- **Release-Kurzbefehle**: `npm.cmd run release:patch|minor|major` erhoeht die Versionsnummer automatisch ohne manuelle Eingabe.
- **Release-Precheck**: `npm.cmd run release:precheck` prueft Versionsgleichheit, Tools und Git-Sauberkeit vor einem Release.
- **Release-Autopilot**: `npm.cmd run release:all -- patch|minor|major` fuehrt Precheck, Bump, Tests, Lint und Installer-Build in einem Ablauf aus.
- **Release-Commit**: `npm.cmd run release:commit` erstellt nach dem Bump einen sauberen Release-Commit vor dem Tagging.
- **Release-Tagging**: `npm.cmd run release:tag` erstellt ein annotiertes Git-Tag fuer die aktuelle Version.
- **Release-Push**: `npm.cmd run release:push-tags` pusht Branch und Follow-Tags zum Remote.
- **Release-Autopilot gehartet**: Der Autopilot stoppt jetzt sauber bei Fehlern und findet Rust-Tools auch ueber den Standard-`~/.cargo/bin`-Pfad.

## 2026-04-30 - Source Preview In/Out Dragging

### Features
- **Source-Preview mit In/Out-Auswahl**: Ausgewaehlte Medien zeigen in der Vorschau einen Start-/Ende-Trim mit visualisiertem Range-Fenster.
- **Timeline-Drop mit Source-Laenge**: Drag aus Mediathek oder Vorschau erzeugt Clips mit der aktuell definierten Source-Laenge statt immer ab 0 bis zur vollen Dauer.
- **DaVinci-style Drag-Symbole**: In der Vorschau gibt es getrennte Drag-Aktionen fuer "Video + Audio" und "Nur Audio"; Audio-only wird als eigene Timeline-Audiospur visualisiert.
- **Audio-only Export**: Audio-only Clips werden beim Export mit schwarzem Video und getrimmtem Audio ausgegeben, damit der MP4-Export konsistent bleibt.

## 2026-04-30 - Bug Review: Playback & Multi-Selection Fixes

### Bug Fixes
- **Bild-Clips unbegrenzt verlängerbar**: Beim rechten Trimmen sind Bilder nicht mehr auf ihre Standard-Bildlänge begrenzt. Videos bleiben weiterhin auf ihre echte Quelldauer limitiert.
- **Playback startet wieder ohne aktives `<video>`**: `handlePlay` sucht jetzt zuerst den Timeline-Zielclip und bricht nicht mehr ab, wenn aktuell ein Bild oder kein Video-Element gerendert ist.
- **Bild-Clips blockieren Timeline-Playback nicht mehr**: Still-Images nutzen jetzt eine virtuelle Playback-Uhr, damit der Playhead über Bild-Clips läuft und danach zum nächsten Clip wechseln kann.
- **Seek auf Bild-Clips hinterlässt keinen alten Video-Seek mehr**: `pendingSeekRef`/`pendingPlayRef` werden beim Wechsel auf Bild-Clips geleert, damit spätere Videos nicht an falsche Positionen springen.
- **Playback: falscher Video-Source bei sameClip**: `handlePlay` prüfte nur ob `target.id === playingClipIdRef.current`, aber nicht ob `activeId` zur Clip-Quelle passt. Hat der User nach dem letzten Play ein anderes Video in der Sidebar angeklickt, wurde `v.play()` auf dem falschen Source aufgerufen. Fix: `sameClip && target.videoId === activeId`.
- **Playback: currentTime außerhalb Clip-Bereich**: Im `sameClip`-Pfad wurde nicht geprüft ob `v.currentTime < clip.inPoint`. War das der Fall, konnte der rAF-Loop `ct >= inPoint` nie erfüllen → Timeline bewegte sich nicht. Fix: zusätzlicher `else if (ct < inPoint - 0.05)` → seek zu `videoTime`.
- **seekToTime: Seek friert ein bei gleichem Video-Source**: Wenn `clip.id !== activeClipId` aber `clip.videoId === activeId` (gleiche Quelle), wurde `setActiveId(sameValue)` aufgerufen → React-Bail-out → `handleLoadedMetadata` feuert nicht → `pendingSeekRef` wird nie konsumiert → Video bleibt an falscher Position. Fix: bei gleicher Source direkt `v.currentTime = videoTime` setzen statt über `pendingSeekRef`.
- **Multi-Selektion: beide Clips verschieben sich bei Drag**: Nach einer Marquee- oder Shift-Selektion blieben beide Clips in `selectedClipIds`. Klickte der User dann (ohne Drag) einen Clip an, blieb die Multi-Selektion bestehen. Beim nächsten Drag bewegten sich beide. Fix: In `onUp` bei `type=move && !moved` → `selectedClipIds` auf den geklickten Clip reduzieren.

## 2026-04-30 - Playback Engine: Decouple clip tracking from user selection

### Bug Fixes
- **Playback Auto-Selection**: Der Playback-Engine hat während der Wiedergabe `setActiveClipId` aufgerufen, was bei jedem Clip-Übergang die Benutzer-Selektion ungewollt änderte und React-Re-Renders auslöste.
- **Stutter zwischen Clips**: Das `setActiveClipId` im rAF-Loop verursachte unnötige State-Updates und damit sichtbares Stottern beim Übergang zwischen Clips.

### Technical Changes
- Neuer `playingClipIdRef` (Ref, kein State) ersetzt `activeClipId` als internes Tracking im Playback-Engine.
- rAF-Loop liest/schreibt nur noch `playingClipIdRef.current` — kein `setState` beim Clip-Übergang.
- `handlePlay()` setzt `playingClipIdRef.current` statt `activeClipId`; `activeClipId` in den Deps entfernt.
- `seekToTime()` aktualisiert `playingClipIdRef.current` bei Clip-Treffern für korrektes Play-after-Seek.
- `handleDoubleClickMedia()` setzt `playingClipIdRef.current = null` (kein Clip-Tracking bei Raw-Preview).
- `handleClipDoubleClick()` setzt `playingClipIdRef.current = clip.id` (rAF-Loop kennt den richtigen Clip).

## 2026-04-30 - Codex Project Rules

- Added Codex project rules under `.codex/rules/stonecutter.codexrules.md`.
- Added `AGENTS.md` so Codex agents can find and follow the project rules.
- Added maintenance rule: keep related files such as `CHANGELOG.md`, README/docs, and agent rules up to date when changes affect them.

## Version 1.0.0 - Complete Video Editor

### 🎬 Major Features

#### Filmora-Style Snapping System
- **Snap Toggle (N key)**: Ein/Ausschalten des Snapping-Systems
- **Snap ON (aktiviert)**:
  - Automatische Ausrichtung an Clip-Edges und Playhead
  - Ripple-Insert: Clips werden bei Bedarf verschoben um Platz zu schaffen
  - Constrain Mode: Clips passen sich in vorhandene Lücken ein
  - Gap Detection: Clips können zwischen andere Clips gezogen werden
- **Snap OFF (deaktiviert)**:
  - Filmora-style Overwrite: Überschneidende Clips werden gekürzt/geschnitten
  - Freie Platzierung ohne automatische Ausrichtung
  - `resolveOverlaps` schneidet Konflikte sauber auf

#### Multi-Clip Editing
- **Multi-Selection**:
  - Marquee-Selektion via Maus-Rechteck
  - Shift+Click für additive Selektion
  - Ctrl/Cmd+Click für toggle Selektion
- **Group Operations**:
  - Multi-Clip Drag mit Ripple-Insert Unterstützung
  - Multi-Clip Trim (alle selektierten Clips gleichzeitig trimmen)
  - Multi-Clip Delete (Del oder Ctrl+Del für Ripple)
  - Copy/Cut/Paste für Clip-Gruppen

#### Import Drag Preview
- **Ghost Clip**: Live-Vorschau während Drag vom Import-Sidebar
- **Timeline-Layout Simulation**: Zeigt exaktes Ergebnis vor dem Drop
- **Mode-Indikator**:
  - Grün = Insert (Ripple)
  - Gelb = Constrain (Gap)
  - Rot = Overwrite (Cut)
- **Drag Tooltip**: Zeit und Dauer am Cursor angezeigt
- **Auto-Scroll**: Timeline scrollt automatisch am Viewport-Rand

#### Advanced Clipboard
- **Ctrl+C**: Kopiert selektierte Clips mit relativen Positionen
- **Ctrl+X**: Schneidet Clips aus und speichert in Clipboard
- **Ctrl+V**: Fügt Clips ein mit:
  - Snap ON: Ripple-Insert an optimaler Position
  - Snap OFF: Overwrite-Modus mit Konflikt-Auflösung

#### Drag Modifiers
- **Shift+Drag**: Temporär Snap deaktivieren (Premiere-Style)
- **Alt+Drag**: Dupliziert selektierte Clips und zieht die Kopien
- **Z-Index Elevation**: Gezogene Clips schweben über anderen Elementen

#### Keyboard Shortcuts
- **Space**: Play/Pause
- **S**: Am Playhead teilen (Split)
- **N**: Snap Ein/Aus
- **Ctrl+D**: Duplizieren
- **Ctrl+C/X/V**: Copy/Cut/Paste
- **Del**: Löschen
- **Ctrl+Del**: Ripple-Löschen (Lücke schließen)
- **Arrow Left/Right**: Clip-Bewegung framegenau (Shift = 1 Sekunde)
- **J/K/L**: Play/Pause Steuerung
- **Comma/Period**: Frame-Step
- **Home/End**: Zu Timeline-Start/Ende springen
- **Escape**: Selektion aufheben

### 🎨 UI/UX Improvements

#### Visual Feedback
- **Snap Indicator Line**: Vertikale Linie zeigt Snap-Punkte an
- **Ghost Clip**: Semi-transparente Vorschau beim Drag
- **Insert Indicator**: Grüner Pfeil zeigt Insert-Position
- **Drag Tooltip**: Zeit/Dauer-Info am Cursor
- **Cursor Cues**: `grab`/`grabbing`/`ew-resize` für interaktive Elemente
- **Selected Gap**: Klickbare Lücken zwischen Clips mit Highlight
- **Marquee Box**: Visuelles Selektions-Rechteck

#### Status Bar
- Zeigt alle Keyboard-Shortcuts an
- Snap-Status (Ein/Aus)
- Zoom-Level (px/s)

#### Logo Display
- Logo 5x größer in der oberen rechten Ecke
- Pfad: `media/Logo/StoneCutter-Logo.png`

### 🐛 Bug Fixes

- **Arrow Key Repeat**: `!e.repeat` Check verhindert massige State-Updates bei gehaltenen Tasten
- **Paste Logic**: Ctrl+V verwendet jetzt korrekt `detectInsertPoint` bei Snap-ON
- **Paste Overwrite**: Ctrl+V bei Snap-OFF löst Konflikte mit `resolveOverlaps`
- **Alt-Drag History**: Undo korrigiert zu Zustand vor Duplizierung
- **Stale Selection**: Selektion wird korrekt nach Split/Delete aktualisiert
- **Marquee Additive**: Shift/Ctrl Modifier werden beim Marquee-Drag berücksichtigt

### 🔧 Technical Improvements

#### Performance
- **displayClips Memo**: Simuliertes Layout während Import-Drag ohne State-Änderung
- **draggingIds Memo**: Effizientes Tracking von aktiven Drag-Clips
- **Optimized Multi-Move**: Cache für selektierte Clips Map

#### Code Quality
- **videoDurations Cache**: Video-Dauern werden beim Import gecached
- **probeAndCacheDurations**: Lazy Duration-Probing für Import-Drag
- **historyBefore Ref**: Separate Snapshot für Alt-Drag Undo
- **effSnap Variable**: Temporärer Snap-Override für Shift-Drag

### 📦 Dependencies

- **Tauri**:
  - `tauri-plugin-dialog` für Datei-Dialoge
  - Asset-Protocol für lokale Video-Serving
- **React**: Hooks für State-Management (useRef, useState, useCallback, useMemo)

### 📝 File Changes

```
src/App.jsx:        +3300 lines (new features, bug fixes)
src/App.css:        +150 lines (ghost clip, tooltip, cursor styles)
src-tauri/Cargo.toml:  + tauri-plugin-dialog
src-tauri/src/lib.rs:  + dialog plugin registration
src-tauri/capabilities/default.json:  + permissions
src-tauri/tauri.conf.json:  + asset protocol
media/Logo/StoneCutter-Logo.png:  + new file
```

---

**Total**: 8 files changed, 3300 insertions(+), 88 deletions(-)
