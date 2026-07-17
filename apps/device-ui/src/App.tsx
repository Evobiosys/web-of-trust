import { ConsentCardsPane } from "./components/ConsentCardsPane";
import { InventoryPane } from "./components/InventoryPane";
import { RoomPane } from "./components/RoomPane";
import { StewardPane } from "./components/StewardPane";
import { useAgentState } from "./hooks/useAgentState";
import { getPersonaTheme } from "./persona";

const PERSONA_KEY = (import.meta.env.VITE_PERSONA as string | undefined) ?? "anna";
const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "http://localhost:4101";

export function App() {
  const { state, loading, error, connection, sendSteward, sendConsent, sendDecline, sendRoomMessage } =
    useAgentState(AGENT_URL);
  const theme = getPersonaTheme(PERSONA_KEY);
  const displayName = state?.persona.name ?? theme.displayName;

  return (
    <div className={`app ${theme.accentClass}`}>
      <header className="app__header">
        <h1>{displayName}&apos;s steward</h1>
        <span className="app__connection" data-testid="connection-status">
          {connection === "ws" ? "live" : connection === "poll" ? "polling" : "connecting…"}
        </span>
        {error && (
          <span className="app__error" data-testid="app-error">
            Connection issue: {error}
          </span>
        )}
      </header>

      {!state ? (
        <p className="app__loading" data-testid="app-loading">
          {loading ? "Loading…" : "Waiting for your agent…"}
        </p>
      ) : (
        <main className="app__grid grid gap-4 p-4 md:grid-cols-2">
          <StewardPane log={state.steward_log} asks={state.asks} onSend={sendSteward} />
          <InventoryPane items={state.items} trustEdges={state.trust_edges} />
          <ConsentCardsPane cards={state.consent_cards} onConsent={sendConsent} onDecline={sendDecline} />
          <RoomPane rooms={state.rooms} onSendMessage={sendRoomMessage} />
        </main>
      )}
    </div>
  );
}
