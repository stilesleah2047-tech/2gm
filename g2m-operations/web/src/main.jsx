import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

/* A render fault should say what happened, not leave a white screen on a
   phone in a supermarket aisle. */
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Dashboard crashed:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{
        fontFamily: "system-ui, sans-serif", background: "#e8e9e3", color: "#14181c",
        minHeight: "100vh", padding: "56px 24px", textAlign: "center",
      }}>
        <div style={{ maxWidth: 460, margin: "0 auto" }}>
          <div style={{ fontSize: 10, letterSpacing: ".17em", textTransform: "uppercase", color: "#7b858f" }}>
            Something broke
          </div>
          <h1 style={{ fontSize: 20, margin: "10px 0" }}>This screen stopped working</h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "#4a535c" }}>
            Nothing you entered was lost on the server. Reload to carry on, and send the
            message below if it keeps happening.
          </p>
          <pre style={{
            fontSize: 11, textAlign: "left", background: "#fbfbf8", border: "1px solid #d2d4ca",
            padding: 12, overflow: "auto", whiteSpace: "pre-wrap",
          }}>{String(this.state.err?.message || this.state.err)}</pre>
          <button onClick={() => window.location.reload()} style={{
            background: "#14181c", color: "#fff", border: 0, padding: "10px 16px",
            fontSize: 13, fontWeight: 600, cursor: "pointer", borderRadius: 2, marginTop: 8,
          }}>Reload</button>
        </div>
      </div>
    );
  }
}

document.body.style.margin = "0";
createRoot(document.getElementById("root")).render(
  <React.StrictMode><Boundary><App /></Boundary></React.StrictMode>
);
