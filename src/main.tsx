import React from "react";
import { createRoot } from "react-dom/client";
import { Companion } from "./components/Companion";
import { Settings } from "./components/Settings";
import "./styles.css";
const companion =
  new URLSearchParams(window.location.search).get("window") === "companion";
document.documentElement.dataset.window = companion ? "companion" : "settings";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="boot" role="alert">
        Something went wrong: {this.state.error}. Restart the window to try
        again.
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>{companion ? <Companion /> : <Settings />}</ErrorBoundary>,
);
