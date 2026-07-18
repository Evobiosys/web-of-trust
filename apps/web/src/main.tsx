import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { ConnectorProvider } from "./lib/connector-context";
import { MockConnector } from "./connector/mock";

const connector = new MockConnector();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConnectorProvider connector={connector}>
      <App />
    </ConnectorProvider>
  </StrictMode>
);
