"use client";

import { useState, type ReactNode } from "react";

export interface TabItem {
  key: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  /** The tabs to render, in order. */
  items: TabItem[];
  /** Key of the tab shown initially. Defaults to the first item. */
  defaultActiveKey?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function Tabs({ items, defaultActiveKey, className = "" }: TabsProps) {
  const [activeKey, setActiveKey] = useState(defaultActiveKey ?? items[0]?.key);
  const activeItem = items.find((item) => item.key === activeKey) ?? items[0];

  return (
    <div className={className}>
      <div className="flex gap-1 border-b border-line" role="tablist">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === activeItem?.key}
            onClick={() => setActiveKey(item.key)}
            className={`px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
              item.key === activeItem?.key
                ? "border-b-2 border-brass text-ink"
                : "text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="pt-4">{activeItem?.content}</div>
    </div>
  );
}
