"use client";

import { ReactNode, useRef, useState } from "react";

const ACTION_WIDTH = 168;

/** Reveals trailing actions when the row is swiped left. */
export function SwipeRow({
  children,
  actions,
  disabled = false,
}: {
  children: ReactNode;
  actions: ReactNode;
  disabled?: boolean;
}) {
  const startX = useRef(0);
  const startY = useRef(0);
  const locked = useRef<"x" | "y" | null>(null);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);

  if (disabled) return <>{children}</>;

  return (
    <div className="xb-swipe">
      <div className="xb-swipe-actions" aria-hidden={!open}>
        {actions}
      </div>
      <div
        className="xb-swipe-front"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={(event) => {
          startX.current = event.touches[0].clientX;
          startY.current = event.touches[0].clientY;
          locked.current = null;
        }}
        onTouchMove={(event) => {
          const dx = event.touches[0].clientX - startX.current;
          const dy = event.touches[0].clientY - startY.current;
          if (!locked.current) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            locked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          }
          if (locked.current !== "x") return;
          const next = Math.min(0, Math.max(-ACTION_WIDTH, (open ? -ACTION_WIDTH : 0) + dx));
          setOffset(next);
        }}
        onTouchEnd={() => {
          if (locked.current !== "x") return;
          const shouldOpen = offset < -ACTION_WIDTH / 2;
          setOpen(shouldOpen);
          setOffset(shouldOpen ? -ACTION_WIDTH : 0);
        }}
      >
        {children}
      </div>
    </div>
  );
}
