// @ts-check
// Celebration confetti — verbatim behaviour from the mockup, guarded for
// reduced-motion and for jsdom's null canvas context.

import { $ } from "./dom.js";
import { reduced } from "./motion.js";

export function confetti() {
  if (reduced) return;
  const c = /** @type {HTMLCanvasElement} */ ($("confetti"));
  c.width = c.offsetWidth;
  c.height = c.offsetHeight;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  if (!x) return;
  const cols = ["#FF715B", "#4FD7A0", "#12A8E3", "#9A37F0", "#F2EBDC"];
  /** @type {Array<{x:number,y:number,w:number,h:number,vy:number,vx:number,rot:number,vr:number,col:string}>} */
  const ps = [];
  for (let i = 0; i < 70; i++) {
    ps.push({
      x: Math.sin(i * 997) * 0.5 * c.width + c.width / 2,
      y: -20 - (i % 10) * 30,
      w: 5 + (i % 4) * 2, h: 8 + (i % 3) * 3,
      vy: 2 + (i % 5) * 0.6, vx: Math.sin(i * 31) * 0.8,
      rot: i * 37, vr: i % 2 ? 3 : -3,
      col: cols[i % 5],
    });
  }
  let t = 0;
  function tick() {
    t++;
    x.clearRect(0, 0, c.width, c.height);
    ps.forEach((p) => {
      p.y += p.vy;
      p.x += p.vx + Math.sin((t + p.rot) / 18);
      p.rot += p.vr;
      x.save();
      x.translate(p.x, p.y);
      x.rotate((p.rot * Math.PI) / 180);
      x.fillStyle = p.col;
      x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      x.restore();
    });
    if (t < 210) requestAnimationFrame(tick);
    else x.clearRect(0, 0, c.width, c.height);
  }
  requestAnimationFrame(tick);
}
