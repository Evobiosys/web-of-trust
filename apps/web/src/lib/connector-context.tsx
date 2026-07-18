import { ReactNode, createContext, useContext, useSyncExternalStore } from "react";
import { AppState, Connector, ConnectorActions } from "@ew/contract";

const Ctx = createContext<Connector | null>(null);

export function ConnectorProvider({
  connector,
  children,
}: {
  connector: Connector;
  children: ReactNode;
}) {
  return <Ctx.Provider value={connector}>{children}</Ctx.Provider>;
}

export function useApp(): { state: AppState; actions: ConnectorActions } {
  const connector = useContext(Ctx);
  if (!connector) throw new Error("useApp outside ConnectorProvider");
  const state = useSyncExternalStore(connector.subscribe, connector.getState, connector.getState);
  return { state, actions: connector.actions };
}
