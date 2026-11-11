import React, { useState } from "react";
/** Mount canvas-based legacy tools only after their container is visible. */
export function AdvancedTool({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="advanced-tool"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{title}</summary>
      {open && children}
    </details>
  );
}
