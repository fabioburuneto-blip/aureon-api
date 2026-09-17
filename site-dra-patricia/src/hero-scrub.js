import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Procedural frame renderer for the pain -> relief journey.
 * Drawn on canvas per scroll progress (0..1) rather than a static
 * image sequence, so the section works today. To swap in the real
 * illustrated sequence later: replace `drawFrame(ctx, progress, w, h)`
 * with an image-index lookup (Math.round(progress * (frames.length - 1)))
 * and drawImage() the preloaded frame — the ScrollTrigger/timeline
 * wiring below stays identical.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `rgb(${r},${g},${b})`;
}

const PAIN_RGB = [184, 101, 74];
const CALM_RGB = [147, 165, 131];
const BODY_TENSE_RGB = [138, 133, 119];
const BODY_CALM_RGB = [193, 202, 174];

function drawFrame(ctx, progress, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.clearRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) * (window.innerWidth < 760 ? 0.0016 : 0.0013);

  const hunch = lerp(1, 0, progress); // 1 = curved/hunched, 0 = upright
  const tilt = lerp(1, 0, progress); // shoulder asymmetry
  const dotOpacity = lerp(0.95, 0, Math.min(1, progress * 1.35));
  const auraOpacity = lerp(0, 0.5, Math.max(0, (progress - 0.4) / 0.6));
  const bodyColor = lerpColor(BODY_TENSE_RGB, BODY_CALM_RGB, progress);

  ctx.save();
  ctx.translate(cx, cy - 40 * scale);
  ctx.scale(scale, scale);
  ctx.rotate(lerp(0.16, 0, progress));

  // calm aura (fades in as progress -> 1)
  if (auraOpacity > 0.01) {
    const grad = ctx.createRadialGradient(0, 60, 10, 0, 60, 260);
    grad.addColorStop(0, `rgba(147,165,131,${auraOpacity * 0.5})`);
    grad.addColorStop(1, "rgba(147,165,131,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 60, 260, 0, Math.PI * 2);
    ctx.fill();
  }

  // spine curve control point (drives hunch)
  const spineCurveX = 95 * hunch;
  const shoulderTiltY = 34 * tilt;
  const headDropX = 46 * hunch;
  const headDropY = 26 * hunch;

  const neck = { x: 8 * hunch, y: -170 + headDropY * 0.3 };
  const shoulderL = { x: -66 + headDropX * 0.15, y: -148 + shoulderTiltY };
  const shoulderR = { x: 78 + headDropX * 0.15, y: -152 - shoulderTiltY * 0.35 };
  const midSpine = { x: spineCurveX, y: -60 };
  const hip = { x: 0, y: 40 };
  const hipL = { x: -55, y: 44 - 10 * hunch };
  const hipR = { x: 55, y: 44 + 10 * hunch };
  const kneeL = { x: -62 + spineCurveX * 0.15, y: 170 };
  const kneeR = { x: 62 + spineCurveX * 0.15, y: 170 };
  const footL = { x: -56, y: 280 };
  const footR = { x: 56, y: 280 };
  const elbowL = { x: -118 + spineCurveX * 0.55, y: -50 + 20 * hunch };
  const elbowR = { x: 128 - spineCurveX * 0.25, y: -60 };
  const handL = { x: -92 + spineCurveX * 0.5, y: 20 + 30 * hunch };
  const handR = { x: 110, y: 15 };

  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 4.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.92;

  // head (drops and juts forward when tense)
  ctx.beginPath();
  ctx.arc(headDropX * 0.7, -200 + headDropY, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(headDropX * 0.7, -172 + headDropY);
  ctx.lineTo(neck.x, neck.y);
  ctx.stroke();

  // spine
  ctx.beginPath();
  ctx.moveTo(neck.x, neck.y);
  ctx.quadraticCurveTo(midSpine.x, midSpine.y, hip.x, hip.y);
  ctx.stroke();

  // shoulders
  ctx.beginPath();
  ctx.moveTo(shoulderL.x, shoulderL.y);
  ctx.lineTo(neck.x, neck.y);
  ctx.lineTo(shoulderR.x, shoulderR.y);
  ctx.stroke();

  // arms
  ctx.beginPath();
  ctx.moveTo(shoulderL.x, shoulderL.y);
  ctx.quadraticCurveTo(elbowL.x, elbowL.y, handL.x, handL.y);
  ctx.moveTo(shoulderR.x, shoulderR.y);
  ctx.quadraticCurveTo(elbowR.x, elbowR.y, handR.x, handR.y);
  ctx.stroke();

  // hips
  ctx.beginPath();
  ctx.moveTo(hipL.x, hipL.y);
  ctx.lineTo(hipR.x, hipR.y);
  ctx.stroke();

  // legs
  ctx.beginPath();
  ctx.moveTo(hipL.x, hipL.y);
  ctx.lineTo(kneeL.x, kneeL.y);
  ctx.lineTo(footL.x, footL.y);
  ctx.moveTo(hipR.x, hipR.y);
  ctx.lineTo(kneeR.x, kneeR.y);
  ctx.lineTo(footR.x, footR.y);
  ctx.stroke();

  // tension points + radiating pain marks (fade out with progress)
  if (dotOpacity > 0.02) {
    const painColor = lerpColor(PAIN_RGB, CALM_RGB, Math.min(1, progress * 1.6));
    const points = [
      { x: neck.x, y: neck.y, r: 11 },
      { x: shoulderR.x - 6, y: shoulderR.y + 4, r: 9 },
      { x: midSpine.x, y: midSpine.y + 20, r: 10 },
      { x: hip.x, y: hip.y - 4, r: 9 },
    ];
    ctx.globalAlpha = dotOpacity;
    points.forEach((p) => {
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2.4);
      grad.addColorStop(0, painColor);
      grad.addColorStop(1, "rgba(184,101,74,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = painColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // small jagged tension marks
      ctx.strokeStyle = painColor;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2 + progress * 2;
        const x1 = p.x + Math.cos(ang) * (p.r + 6);
        const y1 = p.y + Math.sin(ang) * (p.r + 6);
        const x2 = p.x + Math.cos(ang) * (p.r + 16);
        const y2 = p.y + Math.sin(ang) * (p.r + 16);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    });
  }

  ctx.restore();
}

export function initHeroScrub() {
  const section = document.querySelector("[data-hero-scrub]");
  const canvas = document.querySelector("[data-scrub-canvas]");
  if (!section || !canvas) return;

  const ctx = canvas.getContext("2d");
  const state = { progress: 0 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame(ctx, state.progress, rect.width, rect.height);
  }

  window.addEventListener("resize", resize);
  resize();

  const words = section.querySelectorAll("[data-word]");
  const tagline = section.querySelector("[data-tagline]");
  const captionBefore = section.querySelector("[data-caption-before]");
  const captionAfter = section.querySelector("[data-caption-after]");

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: "+=300%",
      scrub: 0.6,
      pin: section.querySelector(".hero-scrub__stage"),
      anticipatePin: 1,
    },
  });

  tl.to(state, {
    progress: 1,
    duration: 1.4,
    ease: "none",
    onUpdate: () => {
      const rect = canvas.getBoundingClientRect();
      drawFrame(ctx, state.progress, rect.width, rect.height);
      if (captionBefore && captionAfter) {
        captionBefore.style.opacity = String(1 - state.progress);
        captionAfter.style.opacity = String(state.progress);
      }
    },
  });

  tl.to(
    words,
    {
      opacity: 1,
      y: 0,
      duration: 0.5,
      stagger: 0.15,
      ease: "power3.out",
    },
    "-=0.15"
  );

  if (tagline) {
    tl.to(
      tagline,
      { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" },
      "-=0.1"
    );
  }
}
