/**
 * Settings {YOU-4} — keys, upgrade placeholder, source. Overlay reached from You.
 * Copy ported from mockup/index.html (v7). Sheets via useSheet().
 */
import { Btn, Card, Hdr, SheetMeta, SheetTitle, useSheet } from "../components/ui";
import { Anchor } from "../components/Anchor";

export function SettingsScreen({ close }: { close: () => void }) {
  const { open } = useSheet();

  return (
    <div className="flex h-full flex-col">
      <Hdr
        title="Settings"
        right={
          <Btn variant="ghost" size="sm" onClick={close}>
            ‹ Back
          </Btn>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-16">
        <Anchor id="YOU-4" className="flex flex-col gap-3.5">
          <Card>
            <h3>Your keys</h3>
            <p className="mt-1 text-ink-soft">
              Made and held in this phone's secure storage, unlocked by your face or PIN. Want a
              recovery verse and server choice too? Upgrade lands here.
            </p>
          </Card>

          <Btn
            variant="plc"
            className="w-full"
            onClick={() =>
              open(
                <div>
                  <SheetTitle>Held for a later pass</SheetTitle>
                  <SheetMeta>
                    The Advanced path will let you hold your own twelve-word recovery verse, choose
                    which server carries your encrypted backups, and self-host if you like. Your keys
                    don't change when it arrives — you upgrade in place.
                  </SheetMeta>
                </div>
              )
            }
          >
            🗝 Recovery verse & server choice — held for a later pass
          </Btn>

          <Card>
            <h3>Read the source</h3>
            <p className="mt-1 text-ink-soft">
              Every line of this prototype is open — git.myceli.al · consensual/ecstatic-world.
            </p>
          </Card>
        </Anchor>
      </div>
    </div>
  );
}
