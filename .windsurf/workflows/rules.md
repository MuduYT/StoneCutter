---
description: Core project rules for StoneCutter development
---

# 🧩 ARCHITEKTUR REGELN

## Trennung
- **Frontend (JS/React) = UI ONLY**
- **Backend (Rust) = Logik + Berechnung**

## Kommunikation
- Jede wichtige Aktion läuft über Tauri Commands
- Keine Business-Logik im Frontend

## Daten
- Keyframes und Effekte werden im Backend gespeichert
- Frontend zeigt nur an

---

# 🧠 CORE REGELN

## Fokus
- **Baue immer nur EIN Feature gleichzeitig fertig.**
- Kein neues Feature anfangen, bevor das alte stabil läuft.

## Einfachheit
- Immer die simpelste Lösung zuerst.
- **Fake Lösungen (z. B. CSS statt echte Videoverarbeitung) sind erlaubt und gewünscht.**

## Sichtbarkeit
- Jede Änderung muss ein sichtbares Ergebnis haben.
- Keine "unsichtbare" Logik über mehrere Tage bauen.

---

# 🚫 VERBOTEN (am Anfang)

- Keine komplexe Videoverarbeitung am Anfang
- Kein direkter Einstieg in FFmpeg-Integration
- Keine GPU / Shader Optimierung am Anfang

---

# 🔧 DEBUGGING REGELN

## Wenn etwas nicht funktioniert
- **Vereinfachen statt erweitern**
- Nach jeder Änderung testen

## Wenn etwas kaputt geht
- **Sofort fixen, nicht ignorieren**
- Kein "ich mach später fix"

## Wenn du feststeckst
- Einen Schritt zurückgehen
- Problem kleiner machen

---

# 💪 MINDSET

- **Ziel ist Fortschritt, nicht Perfektion**
- **Ugly Code > kein Code**
- **Erst funktionierend, dann schön**
