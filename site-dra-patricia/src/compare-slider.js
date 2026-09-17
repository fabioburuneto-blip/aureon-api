export function initCompareSlider() {
  const root = document.querySelector("[data-compare]");
  if (!root) return;

  const frame = root.querySelector(".compare__frame");
  const before = root.querySelector("[data-compare-before]");
  const handle = root.querySelector("[data-compare-handle]");

  let dragging = false;

  function setPosition(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    before.style.clipPath = `inset(0 ${100 - clamped}% 0 0)`;
    handle.style.left = `${clamped}%`;
    handle.setAttribute("aria-valuenow", String(Math.round(clamped)));
  }

  function pctFromClientX(clientX) {
    const rect = frame.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  }

  function onMove(e) {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    setPosition(pctFromClientX(clientX));
  }

  function stopDrag() {
    dragging = false;
  }

  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
  });
  frame.addEventListener("pointerdown", (e) => {
    dragging = true;
    setPosition(pctFromClientX(e.clientX));
  });
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);

  handle.addEventListener("keydown", (e) => {
    const current = parseFloat(handle.style.left) || 50;
    if (e.key === "ArrowLeft") setPosition(current - 5);
    if (e.key === "ArrowRight") setPosition(current + 5);
  });

  setPosition(50);
}
