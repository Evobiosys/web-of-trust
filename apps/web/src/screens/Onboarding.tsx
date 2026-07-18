/**
 * Onboarding {ONB-*} — identity is created on-device. Two steps: welcome, name.
 * Copy ported from mockup/index.html (v7). Domain via useApp(); sheets via useSheet().
 */
import { useRef, useState } from "react";
import { useApp } from "../lib/connector-context";
import { Btn, Card, SheetMeta, SheetTitle, useSheet } from "../components/ui";
import { Anchor } from "../components/Anchor";

export function OnboardingScreen() {
  const { actions } = useApp();
  const { open } = useSheet();
  const [step, setStep] = useState<"welcome" | "name">("welcome");
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="flex h-full flex-col items-center justify-center overflow-y-auto px-7 text-center"
      style={{
        background:
          "linear-gradient(180deg, var(--color-linen) 0%, var(--color-mist) 55%, #DCC8F2 100%)",
      }}
    >
      {step === "welcome" ? (
        <Anchor id="ONB-1" className="w-full">
          <svg
            viewBox="0 0 48 48"
            width={56}
            height={56}
            fill="none"
            stroke="var(--color-vio)"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto"
          >
            <path d="M20 38c-3 0-5-2.4-5-5.5 0-4.5 3-7.5 3-12C18 14 21 9 26 9s8 5.5 8 11c0 6-3.5 9-6.5 12.5C25.5 35 23 38 20 38z" />
            <circle cx="16" cy="15" r="1.6" />
            <circle cx="20" cy="12" r="1.6" />
            <circle cx="25" cy="10.5" r="1.4" />
          </svg>
          <h2 className="mt-4 text-[28px] font-medium">Step onto the floor</h2>
          <p className="mx-auto mt-2 max-w-[22rem] text-ink-soft">
            Your identity is created here, on your phone. No account. No one to ask permission.
          </p>

          <Anchor id="ONB-2" className="mt-6 grid grid-cols-2 gap-3 text-left">
            <Card className="cursor-pointer" onClick={() => setStep("name")}>
              <b className="block">Quick start</b>
              <small className="mt-1 block text-[12px] leading-snug text-ink-soft">
                Keys made and kept in this phone's secure storage, unlocked by your face or PIN.
                Nothing to write down.
              </small>
            </Card>
            <Card
              className="cursor-pointer border-2 border-dashed border-ink/30 opacity-55"
              onClick={() =>
                open(
                  <div>
                    <SheetTitle>Advanced — held for later</SheetTitle>
                    <SheetMeta>
                      This path will let you hold your own twelve-word recovery verse, choose which
                      server carries your encrypted backups, and read every line of the open source.
                      The prototype ships with Quick start; nothing about your keys changes when
                      Advanced arrives — you can upgrade in Settings.
                    </SheetMeta>
                  </div>
                )
              }
            >
              <b className="block">Advanced</b>
              <small className="mt-1 block text-[12px] leading-snug text-ink-soft">
                Your own recovery verse, server choice, open source — held for a later pass.
              </small>
            </Card>
          </Anchor>

          <div className="mt-[18px]">
            <Btn variant="ghost" onClick={() => actions.enterGuest()}>
              Just look around
            </Btn>
          </div>
        </Anchor>
      ) : (
        <Anchor id="ONB-5" className="w-full">
          <span className="text-[11px] font-semibold tracking-widest text-ink-soft uppercase">
            Almost there
          </span>
          <h2 className="mt-2 text-[28px] font-medium">What do people call you on the floor?</h2>
          <input
            ref={nameRef}
            defaultValue="Zach"
            maxLength={16}
            aria-label="Your name"
            className="mx-auto mt-5 block border-b-2 border-vio bg-transparent text-center text-2xl outline-none focus:border-electric"
          />
          <div className="mt-6 flex flex-col items-center gap-2">
            <Btn
              variant="coral"
              onClick={() => actions.completeOnboarding(nameRef.current?.value ?? "")}
            >
              Enter
            </Btn>
            <Btn variant="ghost" onClick={() => setStep("welcome")}>
              Back
            </Btn>
          </div>
        </Anchor>
      )}
    </div>
  );
}
