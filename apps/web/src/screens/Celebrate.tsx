import { useEffect, useRef } from "react";
import { LEVEL_LABEL } from "@ew/contract";
import { useApp } from "../lib/connector-context";
import { Anchor } from "../components/Anchor";
import { Btn } from "../components/ui";

const CONFETTI_COLORS = ["#FF715B", "#4FD7A0", "#12A8E3", "#9A37F0", "#F2EBDC"];

function useConfetti(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Deterministic initial layout — seeded from the piece index, never Math.random().
    const pieces = Array.from({ length: 70 }, (_, i) => ({
      x: Math.sin(i * 997) * 0.5 * canvas.width + canvas.width / 2,
      y: -20 - (i % 10) * 30,
      w: 5 + (i % 4) * 2,
      h: 8 + (i % 3) * 3,
      vy: 2 + (i % 5) * 0.6,
      vx: Math.sin(i * 31) * 0.8,
      rot: i * 37,
      vr: i % 2 ? 3 : -3,
      col: CONFETTI_COLORS[i % 5],
    }));

    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of pieces) {
        p.y += p.vy;
        p.x += p.vx + Math.sin((frame + p.rot) / 18);
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (frame < 210) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef]);
}

export function CelebrateScreen({ goDiscover }: { goDiscover: () => void }) {
  const { state, actions } = useApp();
  const confettiRef = useRef<HTMLCanvasElement>(null);
  useConfetti(confettiRef);

  const { confirmedLevel } = state.ceremony;
  const label = confirmedLevel ? LEVEL_LABEL[confirmedLevel].toLowerCase() : "friend";
  const peerName = state.ceremony.peer?.displayName ?? "they";

  const back = () => {
    actions.resetCeremony();
    goDiscover();
  };

  return (
    <Anchor
      id="CER-5"
      className="bg-spectrum relative flex h-full flex-col items-center justify-center px-6 text-center text-white"
    >
      <canvas ref={confettiRef} className="pointer-events-none absolute inset-0 z-0 h-full w-full" />

      <div className="relative z-10 flex flex-col items-center">
        <h2 className="text-5xl font-medium drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)]">Woven.</h2>
        <p className="mt-4 max-w-sm text-[15px] leading-relaxed drop-shadow-[0_1px_6px_rgba(0,0,0,0.3)]">
          {confirmedLevel === "contact"
            ? `You and ${peerName} now hold each other’s cards — contacts, met at Nachbarschaftsfest Yppenplatz. Deeper rooms open as you grow closer.`
            : `You and ${peerName} now hold each other’s thread — ${label}s, at Nachbarschaftsfest Yppenplatz. Their building’s Hausversammlung just opened to you.`}
        </p>

        <div className="mt-8 flex w-full max-w-xs flex-col items-stretch gap-2.5">
          {state.unlocked && (
            <Btn variant="electric" onClick={back}>
              See what opened
            </Btn>
          )}
          <Btn variant="ghost" className="text-white" onClick={back}>
            Back to the floor
          </Btn>
        </div>
      </div>
    </Anchor>
  );
}
