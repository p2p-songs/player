/**
 * A crash boundary whose whole reason for existing is §6a: **error paths must
 * not serialize a configured addon URL** (which carries the debrid key) into a
 * message, stack, or report. React error info can include props, and a props
 * tree can contain a configured manifest URL — so this boundary renders a
 * generic fallback and, in dev, logs **only the redacted** error, never the raw
 * `errorInfo` component stack.
 *
 * It is intentionally minimal: no telemetry, no serialization, no "copy error
 * details" affordance — every one of those is a channel a secret could leak
 * through, and none is worth a credential.
 */
import { Component, type ReactNode } from "react";
import { redactSecrets } from "../../app/security/redact.js";

interface Props {
  children: ReactNode;
}
interface State {
  crashed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: unknown): void {
    // Log the redacted message only. Never the error object (its `.stack` /
    // React's component stack can embed a configured URL), never `errorInfo`.
    // eslint-disable-next-line no-console
    console.error("[player] a UI error was caught:", redactSecrets(messageOf(error)));
  }

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div role="alert" className="crash">
        <h1>Something went wrong</h1>
        <p>The player hit an unexpected error. Reloading usually clears it.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
