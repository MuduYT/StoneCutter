import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  handleHardReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const msg =
        this.state.error?.message || this.state.error?.toString?.() || "Unknown error";
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "#0d0a1a",
            color: "#e9e3f5",
            fontFamily: "Inter, Segoe UI, Arial, sans-serif",
            padding: "2rem",
            gap: "1rem",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>
            Etwas ist schiefgelaufen
          </h1>
          <p style={{ margin: 0, opacity: 0.7, maxWidth: "40rem", textAlign: "center" }}>
            Die Anwendung hat einen unerwarteten Fehler festgestellt. Du kannst
            versuchen, die Ansicht neu zu laden oder die Anwendung neu zu starten.
          </p>
          <pre
            style={{
              background: "rgba(255,255,255,0.06)",
              padding: "0.75rem 1rem",
              borderRadius: "6px",
              fontSize: "0.8rem",
              maxWidth: "50rem",
              overflow: "auto",
              color: "#f97316",
              margin: 0,
            }}
          >
            {msg}
          </pre>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "6px",
                border: "none",
                background: "#8b5cf6",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Erneut versuchen
            </button>
            <button
              onClick={this.handleHardReload}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "transparent",
                color: "#e9e3f5",
                cursor: "pointer",
              }}
            >
              Anwendung neu laden
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
