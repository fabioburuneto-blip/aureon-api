import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./style.css";

import { initLenis } from "./lenis-setup.js";
import { initHeroScrub } from "./hero-scrub.js";
import { initReveals } from "./reveals.js";
import { initCompareSlider } from "./compare-slider.js";

gsap.registerPlugin(ScrollTrigger);

document.documentElement.classList.add("js-ready");

initLenis();
initHeroScrub();
initReveals();
initCompareSlider();

// three.js is the heaviest dependency — only fetch it once the
// spine mount is about to scroll into view.
const spineMount = document.querySelector("[data-spine-mount]");
if (spineMount) {
  const loadSpine = () => {
    io.disconnect();
    import("./spine-3d.js").then(({ initSpine3D }) => initSpine3D());
  };
  const io = new IntersectionObserver(
    (entries) => entries.some((e) => e.isIntersecting) && loadSpine(),
    { rootMargin: "600px" }
  );
  io.observe(spineMount);
}

// nav: subtle background once page scrolls past the hero banner
const nav = document.querySelector("[data-nav]");
ScrollTrigger.create({
  trigger: ".hero-banner",
  start: "bottom top",
  onEnter: () => nav.classList.add("is-scrolled"),
  onLeaveBack: () => nav.classList.remove("is-scrolled"),
});

window.addEventListener("load", () => ScrollTrigger.refresh());
