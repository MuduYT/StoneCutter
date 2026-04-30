# StoneCutter Update Log

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
