---
description: Tauri dev server starten (inkl. Rust/Cargo PATH-Fix für Windows)
---

# Tauri Dev starten

## Voraussetzungen prüfen

Sicherstellen dass `cargo` im PATH der aktuellen Session ist:

```powershell
cargo --version
```

Falls nicht gefunden → Schritt 1 ausführen.

## Schritt 1: PATH für aktuelle Session setzen (falls cargo nicht gefunden wird)

```powershell
$env:PATH += ";C:\Users\viuser\.cargo\bin"
```

## Schritt 2: Dev-Server starten

```powershell
npm run tauri dev
```

## Hinweise

- Beim **ersten Start** dauert die Rust-Kompilierung 3–10 Minuten (Crates werden gecached).
- Folgestarts sind deutlich schneller (~30 Sekunden).
- Das App-Fenster öffnet sich automatisch nach dem Compile.

## Dauerhafter PATH-Fix (einmalig)

Damit `cargo` dauerhaft im PATH ist, ins PowerShell-Profil eintragen:

```powershell
notepad $PROFILE
```

Zeile ans Ende anfügen:

```
$env:PATH += ";C:\Users\viuser\.cargo\bin"
```

Speichern → ab dem nächsten Terminal-Start ist cargo automatisch verfügbar.

## PowerShell Execution Policy (falls npm-Skripte blockiert werden)

Einmalig ausführen:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```
