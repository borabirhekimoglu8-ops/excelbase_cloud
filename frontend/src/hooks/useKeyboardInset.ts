import { useEffect } from "react";

/** Keeps `--keyboard-inset` in sync with the visual viewport so the composer
 * and nav sit above the iOS keyboard instead of under it. */
export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
      document.documentElement.classList.toggle("keyboard-open", inset > 80);
    };
    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);
}
