/** Sfondo navbar leggermente più scuro dopo scroll. */
export function initHeaderScroll() {
  const header = document.querySelector(".site-header");
  if (!header) return;

  const threshold = 6;

  function update() {
    const y = Math.max(
      window.scrollY || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );
    header.classList.toggle("is-scrolled", y > threshold);
  }

  update();
  window.addEventListener("scroll", update, { passive: true });
  document.addEventListener("scroll", update, { passive: true, capture: true });
}
