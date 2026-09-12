import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="xb-empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}
