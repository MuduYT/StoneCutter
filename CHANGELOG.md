# StoneCutter Update Log

## 2026-05-04 - Timeline Playback Start & Clip Interaction Polish

### Fixes
- Timeline-Playback wartet beim Start und bei Sync-Seeks auf `seeked`, bevor Video- und Audio-Layer abgespielt werden. Eine kurze rAF-Grace-Phase verhindert schwarze Startframes und Audio-Drops direkt am Clip-Anfang.
- Linked V+A-Clips bleiben horizontal und beim Trimmen synchron, koennen aber vertikal getrennt auf passende Spuren bewegt werden.
- Native blaue Textauswahl in Ruler, Tracks und Clip-Drag-Flows wird unterdrueckt.
- Audio-Waveforms skalieren ihre Balken jetzt sichtbar mit der Clip-Lautstaerke.
- Clip-Erkennung am Playhead nutzt die Timeline-Transition-Toleranz am Clip-Start und haelt Clips bis zum exakten Ende aktiv.
- Vite-Skripte nutzen den nativen Config-Loader, damit `npm run dev`, `build` und `preview` auf dem Windows-Setup nicht durch `spawn EPERM` blockieren.

### UI
- Fade-Overlays nutzen wieder subtile dunkle Verlaeufe.
- Fade-Handles wurden als kleine violette Filmora-artige Dreiecke am oberen Cliprand neu gestaltet.

## 2026-05-03 - Export-Paritaet: Overlays, Audio-Mix & Media-Bin Organisation

### Features
- MP4-Export plant jetzt eine echte Timeline-Komposition statt eines linearen Clip-Concats: Video- und Bildclips werden mit FFmpeg `overlay` nach Spur-Reihenfolge auf eine schwarze Canvas gerendert.
- Export mischt mehrere aktive Audio-Clips mit `amix` und respektiert Audio-Track Mute/Solo sowie `clipMuted`.
- Per-Clip Volume, Audio-Fades, Video-Fades/Opacity, Position, Scale, Rotation, Flip, Brightness, Contrast und Saturation werden in den Exportplan uebernommen.
- Linked V+A-Clips werden fuer den Export als getrennte Video- und Audio-Layer behandelt, sodass gemutete Audiospuren das Video nicht mehr faelschlich mit Quell-Audio exportieren.
- Mediathek erweitert um Suche, Typfilter (Video/Audio/Bild) und Sortierung nach Importzeit, Name, Dauer oder Typ.

### Technical Changes
- `src/lib/exportSegments.js` erzeugt timeline-aware Composition-Segmente mit Startzeit, Dauer, Track-/Audio-State, Clip-Fades und Transform-/Color-Werten.
- `src-tauri/src/lib.rs` baut einen `filter_complex` mit schwarzer Canvas, Video/Image-Overlays, optionalem `amix`, Clip-Volume und Fade-Filtern.
- Neue pure Helper in `src/lib/mediaBin.js` plus Tests fuer Suche, Filter, Sortierung und stabile Reihenfolge.
- Projektdateien speichern und hydratisieren jetzt `importedAt` fuer Medien, damit die Mediathek dauerhaft nach Importzeit sortieren kann.

### Known Limitations
- Master-Preview-Volume/Mute sind weiterhin keine Export-Einstellungen.
- Inspector-Speed, Pan und Temperature sind noch nicht exportiert.
- Quellen ohne Audiospur koennen weiterhin den vorhandenen No-Audio-Fallback ausloesen.

## 2026-05-03 - DaVinci Fade Handles, Drag-to-Scrub Inspector & Linked Clip View

### Features
- **DaVinci Resolve-style fade handles**: Every clip in the timeline now shows small white rectangular handles in its top-left (fade-in) and top-right (fade-out) corners when hovered or selected. Dragging the fade-in handle right increases the fade-in duration; dragging the fade-out handle left increases fade-out — identical to the DaVinci Resolve workflow. Handles update the fade envelope live as you drag.
- **Drag-to-scrub Inspector fields**: All Inspector number fields (Pos X, Pos Y, Rotation, Volume, Fade In, Fade Out) now use a custom `InspectorDragger` component. Dragging the label or value display left/right scrubs the value continuously. Mouse-wheel over any row increments/decrements by one step. Clicking the value display enters a text-input mode for precise keyboard entry (Enter to commit, Escape to cancel).
- **Linked clip Inspector view**: When a linked V+A pair is selected, the Inspector shows a unified view — the Video Transform section reads from the video clip and the Audio section reads from the audio clip. Changes to each section update the correct clip independently. A `V+A` badge appears in the Inspector header to indicate a linked selection.
- **Redesigned Inspector panel**: Width increased to 300 px. Scrollable body with styled scrollbar. Gradient header, section dividers, subtitle rows for Fade sub-sections, and a progress bar under each scrub field showing the current value position within the allowed range.
- **Diagonal fade overlays**: Fade region overlays now use a diagonal (`to bottom-right` / `to bottom-left`) gradient matching DaVinci’s visual style instead of the previous flat horizontal gradient.

### Technical Changes
- New `InspectorDragger` function component defined before `App`; uses `useState` from existing named import.
- `fadeDragRef` added alongside `volumeLineDragRef`; a dedicated `useEffect` handles `mousemove`/`mouseup` globally for fade dragging.
- `has-inspector` CSS class now also applied to the root `.app` div, allowing `.app.has-inspector .logo-area` to shift the logo 310 px left (with 200 ms ease transition) when inspector is open.
- Inspector JSX replaced with an IIFE that resolves the linked group, finds the video and audio halves, and renders each section via `InspectorDragger`.
- `idf-row`, `idf-label`, `idf-scrub`, `idf-value`, `idf-input`, `idf-progress`, `idf-progress-fill` CSS classes added for the scrub-field UI.
- `fade-handle-in`, `fade-handle-out` CSS classes added; handles sit at the transition point of the fade region and move as the fade duration changes.

## 2026-05-03 - Inspector Panel, Fade Controls, Volume Line & Transform System

### Features
- **Inspector Panel** (top-right): When a clip is selected the inspector panel appears showing per-clip properties. Video clips show Position X/Y sliders (−960–960 / −540–540), Rotation (−180–180°), Fade In/Out (seconds). All clips show an Audio section with Volume (0–200%) and audio Fade In/Out.
- **Per-clip data model extended**: Every clip now carries `volume` (0–2, default 1), `fadeIn` (seconds), `fadeOut` (seconds), `positionX`, `positionY`, and `rotation` fields. All are optional with safe defaults so existing projects load without migration.
- **Filmora-style volume line on audio clips**: A draggable yellow horizontal line inside every audio clip in the timeline shows and controls the clip's volume. Dragging up increases volume (top = 200%), dragging down decreases it (bottom = 0%). The line position updates live as the clip volume changes.
- **Fade overlays on all clips**: A dark gradient overlay is rendered at the left edge (fade-in) and right edge (fade-out) of every clip proportional to the configured fade duration, giving instant visual feedback of the fade region.
- **Real-time transform in preview**: The timeline composite preview applies each video clip's `positionX`, `positionY`, and `rotation` via CSS `transform: translate() rotate()` so changes in the inspector are reflected immediately in the preview player.
- **Per-clip volume & fade envelope on audio playback**: The timeline audio bus now computes an effective volume per clip from `volume × globalVolume × fadeGain`, where `fadeGain` ramps from 0→1 over the fadeIn period and 1→0 over the fadeOut period. The envelope is recalculated every animation frame.
- **Video opacity fade in preview**: Video layers in the composite preview have their `opacity` driven by the same fade-in/out envelope so fade-out actually darkens the video frame in real time.
- **Non-overlapping layout**: The logo/toolbar area smoothly slides left (200ms ease) when the inspector opens, preventing overlap. The player area (`main-content`) shrinks its right boundary accordingly.

### Technical Changes
- `volumeLineDragRef` added to `App` refs; a dedicated `useEffect` listens for `mousemove`/`mouseup` to update `clip.volume` during volume-line drags.
- `has-inspector` class applied to both the root `.app` div and `<main>` when `activeClipId` is set.
- `.app.has-inspector .logo-area` CSS shifts the logo 280px left with a smooth transition.
- `.main-content.has-inspector` shrinks right boundary by 280px so the player does not extend under the inspector.
- Inspector uses `setClips` with `prev.map(…)` pattern — no history push, changes are live and undoable via the existing undo stack.

## 2026-05-03 - Timeline Overlay Preview & Audio Mix

### Features
- Timeline-Fokus zeigt jetzt eine echte Mehrspur-Vorschau: aktive Video- und Bildclips am Playhead werden nach Video-Spurreihenfolge uebereinander gerendert, sodass PNG- oder Video-Overlays ueber darunterliegenden Clips sichtbar sind.
- Die Videospur-Reihenfolge ist fuer die Preview gedreht: obere Videospuren rendern jetzt sichtbar ueber unteren Videospuren.
- Clips koennen jetzt DaVinci-Resolve-artig vertikal zwischen kompatiblen Spuren gezogen werden: Video/Bild bleibt auf Videospuren, Audio bleibt auf Audiospuren, locked Tracks werden nicht als Ziel verwendet, gelinkte V+A-Partner und Multi-Selektionen folgen relativ innerhalb ihres Spurtyps mit.
- Beim Ziehen ueber die oberste oder unterste passende Spur hinaus zeigt die Timeline eine Auto-Spur-Zone an und legt die neue Video- oder Audio-Spur erst beim Drop zusammen mit dem Clip-Move an.
- Gelinkte V+A-Clips koennen jetzt vertikal getrennt bewegt werden: Der geklickte Video- oder Audio-Teil wechselt seine Spur separat, waehrend Links/Rechts-Drags den Partner zeitlich synchron halten. Ist die Partner-Spur am Ziel belegt, wird der Partner automatisch auf eine freie passende Spur darueber bzw. darunter gelegt oder eine neue passende Spur geplant.
- Folgefehler beim Multi-Clip-Move behoben: Ripple-Insert verschiebt jetzt nur noch Clips auf der betroffenen Zielspur statt unbeabsichtigt alle Spuren rechts vom Insert-Punkt.
- Die Timeline-Wiedergabe mixt alle aktiven Audio-Clips auf nicht stummgeschalteten Audio-Spuren parallel, inklusive Soundeffekten, Voiceover und Hintergrundmusik. Solo-Spuren bleiben fuer die Preview wirksam.
- Timeline-Play nutzt jetzt eine virtuelle Timeline-Uhr als zentrale Playback-Quelle; Video-Layer und Audioelemente synchronisieren sich daran statt an einem einzelnen aktiven `<video>`.
- Die Timeline-Toolbar startet nun immer die Timeline-Wiedergabe, auch wenn im Source-Monitor noch ein Medium ausgewaehlt ist.

### Technical Changes
- Neue Playback-Helfer in `src/lib/playback.js`: `findClipsAtTime`, `getTimelineVisualClips`, `getTimelineAudibleClips`, `getTopVisibleTimelineClip`.
- Neue Track-Helfer in `src/lib/trackStore.js`: `getTrackTypeIndex`, `shiftTrackIdByType`, `getCompatibleTrackMoveTarget`, `getCollisionFreeTrackForClip`, `planTrackMove`, `applyTrackMovePlan`, `createAutoTrackForMove`.
- `src/App.jsx` rendert fuer Timeline-Fokus einen Composite-Preview-Stack plus versteckten Audio-Bus und synchronisiert alle Medienelemente mit dem Playhead.
- Tests erweitert auf 78 Faelle inklusive Layer-Reihenfolge, Audio-Mute/Solo-Filterung, Resolve-artiger Track-Verschiebung, Link-Partner-Platzierung und Auto-Track-Planung.

### Known Limitations
- Export unterstuetzt weiterhin kein echtes Video-Stacking oder `amix` ueber mehrere unabhaengige Spuren; ueberlappende Clips unterschiedlicher Quellen werden beim Export weiter abgelehnt.

## 2026-05-03 - Project Media Save & Audio Import

### Bug Fixes
- Projektspeichern verwaltet importierte Medien jetzt im Projektordner: Tauri kopiert referenzierte Mediathek-Dateien nach `Media/` und speichert relative `Media/...`-Pfade, waehrend der urspruengliche Quellpfad als `originalPath` erhalten bleibt.
- Beim Oeffnen eines Projekts werden relative Medienpfade wieder relativ zum Projektordner aufgeloest, sodass verschobene Projektordner ihre Medien weiter finden.
- Mediathek-Drag nutzt jetzt immer das volle Medium ab Anfang; nur die expliziten Source-Buttons ("Video + Audio", "Nur Audio") verwenden die gesetzte Source-In/Out-Auswahl. Dadurch werden Clips beim Drop nicht mehr ungewollt am Anfang gekuerzt.
- Drops auf bestehende Spuren treffen jetzt die sichtbare Spur statt durch die Sticky-Ruler-Hoehe um eine Spur nach unten versetzt zu werden.
- Die Drop-Zone-Beschriftung nutzt State statt Ref-Zugriff im Render-Pfad und ist damit React-Lint-konform.

### Features
- Der Importdialog unterstuetzt jetzt Audio-Dateien (`mp3`, `wav`, `ogg`, `flac`, `aac`, `m4a`) und bietet eine sichtbare "Alle Dateien"-Filteroption.
- Audio-Dateien aus Datei-Import, Mediathek oder Explorer-Drop werden als Audio-Medien erkannt und automatisch auf Audio-Spuren platziert.

## 2026-05-03 - Multi-Track Timeline: Sticky Ruler & Linked V+A Import

### Bug Fixes
- **Sticky Time-Ruler**: Die Zeitleiste (0:00, 0:05 ...) bleibt beim vertikalen Scrollen der Tracks dauerhaft oben sichtbar und laeuft beim horizontalen Scrollen weiterhin synchron mit den Clips. Playhead-Handle und Scrub-Tooltip sind jetzt Teil des stickyen Ruler-Layers, die rote Playhead-Linie spannt weiterhin ueber alle Tracks.
- **Video-Import splittet Audio jetzt auf eigene Spur**: Beim Drag-and-Drop eines Videos mit Tonspur (Sidebar oder Explorer) erzeugt StoneCutter jetzt zwei gelinkte Clips (Video + Audio) auf getrennten Spuren, wie in Filmora/DaVinci Resolve. Fehlt eine Audio-Spur, wird sie automatisch angelegt.
- **Legacy-Projekte migrieren automatisch**: Alte `.stonecutter`-Projekte (SchemaVersion 1) mit `trackMode: "av"` werden beim Oeffnen in gelinkte V+A-Paare aufgeteilt. Neue Projekte speichern Schema v2 inklusive `linkGroupId`.

### Features
- **Link-Groups fuer V+A**: Clips eines Imports teilen eine `linkGroupId`. Bewegen, Trimmen, Teilen und Loeschen einer Seite wirkt automatisch auf den Partner.
- **`Ctrl+Shift+L` entkoppelt**: Ein Shortcut und ein Kontextmenue-Eintrag ("Link aufheben") trennen die V+A-Verknuepfung fuer freie Bearbeitung.
- **Link-Badge**: Gelinkte Clips zeigen eine kleine Kette im Clip-Block + dezenten gelben Inset-Glow.
- **Export versteht gelinkte V+A**: Der Export fusioniert V+A-Paare wieder zu einem AV-Segment pro Quelle, statt sie als ueberlappende Multi-Track-Clips abzulehnen. Muted/Solo auf Audio-Spuren bleibt wirksam.
- **Bessere Drop-Toast statt blockierenden Alerts** bei inkompatiblen Drop-Targets (z.B. Audio-Clip auf Video-Spur).

### Technical Changes
- Neue reine Funktionen in `src/lib/timeline.js`: `splitMediaIntoLinkedClips`, `getLinkedClipIds`, `expandWithLinkedPartners`, `applyGroupShift`, `applyGroupTrimLeft`, `applyGroupTrimRight`, `applyGroupSplit`, `unlinkClipGroup`, `nextLinkGroupId`, `isAudioOnlyMedia`.
- `src/lib/exportSegments.js` entfernt doppelte Linked-Partner vor dem Overlap-Check.
- `src/lib/project.js`: `PROJECT_SCHEMA_VERSION = 2`, akzeptierte Versionen `{1, 2}`, Legacy-`av`-Split in `hydrateProjectState`.
- CSS: `.time-ruler` ist jetzt `position: sticky` mit opakem Hintergrund; separates Playhead-Handle im Ruler-Layer, neue `.clip-link-badge` und `.clip.linked`-States.
- `src/App.jsx`: Drop-Handler nutzt `splitMediaIntoLinkedClips`, legt Audio-Track bei Bedarf an, Explorer-Drop geht denselben Pfad. Trim/Split/Delete propagieren ueber Link-Partner.
- Tests: 13 neue Node-Tests (Linked-Clip-Helper, Linked-Export, Legacy-v1-Migration). Gesamtsumme 59 Tests in `src/lib/*.test.js`.

### Known Limitations
- Export unterstuetzt noch kein echtes Video-Stacking mehrerer Video-Tracks oder `amix` ueber mehrere Audio-Tracks; ueberlappende Clips unterschiedlicher Quellen werden weiter abgelehnt.

## 2026-05-03 - Logic Hardening Audit

### Bug Fixes
- Timeline move constraints now merge unsorted/overlapping blockers and handle zero-length gaps deterministically.
- Ripple delete now shifts later clips by the merged removed time ranges instead of double-counting overlapping deleted clips.
- Overwrite splitting uses explicit source-time offsets for trimmed source clips.
- Playback edge handling covers exact clip ends, tail gaps, repeated virtual-gap clocks, and minimum-duration image clips.
- Export segment building now tolerates overlapping clips, clamps source ranges to source duration, and passes audio-only media through safely.
- Project hydration now normalizes partial or corrupt persisted fields instead of trusting invalid arrays, objects, numbers, and UI values.
- Source monitor range and pointer helpers now avoid invalid ranges and zero-width seek math.
- Timeline play and seek logic now clears stale playback refs, avoids redundant pending seeks, and skips redundant duration probes.
- Project save/load now preserves the new track layout including track IDs, names, heights, lock state, and audio mute/solo state.
- Export planning now respects muted/solo audio tracks and rejects unsupported overlapping active track clips with a clear error instead of generating a wrong linear export.
- Timeline playback now prefers aligned video clips over audio-only clips, so audio tracks do not steal the preview image.
- Media-library thumbnails are generated from imported media, so the new library layout is populated before clips are placed on the timeline.
- Tauri export retry detection now recognizes FFmpeg "Stream specifier" and "matches no streams" missing-audio errors.

### Tests
- Added edge-case coverage for timeline overlap resolution, ripple delete, playback transitions, export segments, track-aware project hydration, source monitor math, and Tauri FFmpeg argument construction.

## 2026-05-03 - UI/UX Polish Pass

### UX Changes
- Smooth 0.15s transitions auf Toolbar-Buttons, Tabs, Listenelementen und Aspect-Ratio-Buttons.
- Einheitliche, schmale 5px-Scrollbars (Accent-Violett) in Mediathek, Timeline, Modaldialogen und Recent-Projects-Liste.
- Clip-Bloecke: subtiler weisser Top-Highlight + inset Box-Shadow fuer mehr Tiefe.
- Clip-Beschriftungen mit zusaetzlichem Text-Shadow fuer bessere Lesbarkeit auf Thumbnails.
- Playhead-Linie hat jetzt einen weichen roten Glow fuer bessere Sichtbarkeit waehrend der Wiedergabe.
- Aktive Gap-Wiedergabe zeigt einen sanft animierten Cyan-Shimmer.
- Time-Ruler mit subtiler Hintergrundabstufung; Tick-Labels in `tabular-nums`.
- Track-Headers durch eine 2px-Accent-Linie sichtbar von der Clip-Flaeche getrennt.
- Source-Monitor: weicher Verlauf am unteren Rand des Previews statt harter Kante zur Player-Leiste.
- Source-In/Out-Handles bekommen einen violetten Glow beim Hover.
- Source-Timeline-Fortschrittsbalken animiert Width-Aenderungen smooth.
- Mediathek-Eintraege zeigen einen 40x28-Thumbnail-Strip-Vorschau (sobald Thumbs verfuegbar sind) anstelle des Icon-Platzhalters.
- Aktiver Mediathek-Eintrag erhaelt einen 3px-Accent-Streifen am linken Rand statt nur Hintergrundwechsel.
- Import-Button pulsiert leicht, solange die Mediathek leer ist (Onboarding-Hinweis).
- Project-Start-Screen mit weichem, animiertem Radial-Gradient-Hintergrund hinter dem Logo.
- Logo auf dem Startscreen wird jetzt mit einer kurzen Fade-In + TranslateY-Animation eingeblendet.
- Recent-Projects-Eintraege zeigen einen einsliegenden `→`-Pfeil beim Hover.
- Modal-Dialoge (Settings, Export, Neues Projekt) blurren jetzt den Hintergrund (`backdrop-filter: blur(6px)`).
- Modal-Container haben einen feinen Accent-Glow als Rahmen und eine sanfte Scale-In-Entrance-Animation.
- Toast-Notifications skalieren beim Erscheinen leicht hoch und besitzen einen farbigen 3px-Linksrand-Streifen (Gruen=ok, Rot=err).
- Snap-Toolbar-Button bekommt im aktiven Zustand einen deutlichen Glow-Ring.
- Export-Button pulsiert mit einem Gradient-Shimmer waehrend ein Export laeuft.
- Undo/Redo-Buttons sind bei leerer History nicht mehr klickbar (`pointer-events: none`, opacity 0.35).
- Keyboard-Shortcut-Hint-Bar in der Status-Zeile mit kleineren Badges, klaren Trennstrichen (`|`) und Tabular-Numerics-Schrift.

### Technical Changes
- `.clip.dragging` nutzt `will-change: transform` fuer GPU-Compositing waehrend Drag-Operationen.
- Waveform-Container hat `image-rendering: crisp-edges` und sauberen Overflow-Clip.
- Statusbar-Shortcuts in `App.jsx` als strukturierte `kbd-group`/`kbd-sep`-Spans gruppiert.
- Sidebar-Eintraege rendern Thumbnails per `thumbsMap`-Lookup (nur Praesentation, keine Logikaenderung).
- Logo-Export-Button und Import-Button erhalten neue Modifier-Klassen (`exporting`, `pulse`) ueber bestehenden State (`exportStatus`, `videos.length`).

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
