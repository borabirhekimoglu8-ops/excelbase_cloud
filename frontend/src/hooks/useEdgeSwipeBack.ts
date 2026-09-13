import { useEffect } from "react";

/** iOS-style back: a rightward swipe that begins on the left edge. */
export function useEdgeSwipeBack(enabled: boolean, onBack?: () => void) {
  useEffect(() => {
    if (!enabled || !onBack) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch || touch.clientX > 28) return;
      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    }

    function onEnd(event: TouchEvent) {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dx > 72 && dy < 64) onBack?.();
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [enabled, onBack]);
}
