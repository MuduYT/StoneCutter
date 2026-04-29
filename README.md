# StoneCutter

Ein Video-Schnittprogramm gebaut mit **Tauri 2**, **React** und **Rust**.

## Tech Stack

- **Frontend**: React + Vite + JavaScript
- **Backend**: Rust (via Tauri)
- **Desktop**: Tauri 2

## Voraussetzungen

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://rustup.rs/) (stable)

## Setup

```bash
# Dependencies installieren
npm install

# App im Entwicklungsmodus starten
npm run tauri dev

# App bauen
npm run tauri build
```

## Projektstruktur

```
StoneCutter/
├── src/              # React Frontend
├── src-tauri/        # Rust Backend (Tauri)
├── public/           # Statische Assets
└── index.html        # Einstiegspunkt
