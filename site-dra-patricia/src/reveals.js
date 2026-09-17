import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function initReveals() {
  const blocks = gsap.utils.toArray("[data-reveal]");

  blocks.forEach((el, i) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 40 },
      {
        opacity: 1,
        y: 0,
        duration: 0.9,
        ease: "power3.out",
        scrollTrigger: {
          trigger: el,
          start: "top 82%",
          toggleActions: "play none none reverse",
        },
      }
    );
  });

  // service rows: subtle alternating slide + icon draw-in
  gsap.utils.toArray(".service").forEach((service, i) => {
    const icon = service.querySelector(".service__icon");
    gsap.fromTo(
      service,
      { opacity: 0, x: i % 2 === 0 ? -30 : 30 },
      {
        opacity: 1,
        x: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: service,
          start: "top 85%",
          toggleActions: "play none none reverse",
        },
      }
    );

    if (icon) {
      gsap.fromTo(
        icon,
        { rotate: -8, scale: 0.85, opacity: 0 },
        {
          rotate: 0,
          scale: 1,
          opacity: 0.9,
          duration: 0.9,
          ease: "back.out(1.6)",
          scrollTrigger: {
            trigger: service,
            start: "top 85%",
            toggleActions: "play none none reverse",
          },
        }
      );
    }
  });

  // bento grid stagger
  gsap.fromTo(
    ".bento__item",
    { opacity: 0, y: 30 },
    {
      opacity: 1,
      y: 0,
      duration: 0.7,
      stagger: 0.08,
      ease: "power2.out",
      scrollTrigger: {
        trigger: ".bento",
        start: "top 85%",
        toggleActions: "play none none reverse",
      },
    }
  );
}
