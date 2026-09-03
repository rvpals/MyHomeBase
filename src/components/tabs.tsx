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
  /**
   * Controlled active tab. Supply with `onActiveKeyChange` when something
   * outside the strip needs to switch tabs (SQL Explorer's "Open" jumps to the
   * query tab). Omit both to let the component own its state.
   */
  activeKey?: string;
  /** Called with the new key on a tab click. Required for controlled use. */
  onActiveKeyChange?: (key: string) => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function Tabs({
  items,
  defaultActiveKey,
  activeKey,
  onActiveKeyChange,
  className = "",
}: TabsProps) {
  const [uncontrolledKey, setUncontrolledKey] = useState(defaultActiveKey ?? items[0]?.key);
  const currentKey = activeKey ?? uncontrolledKey;
  const activeItem = items.find((item) => item.key === currentKey) ?? items[0];

  function selectTab(key: string) {
    if (activeKey === undefined) setUncontrolledKey(key);
    onActiveKeyChange?.(key);
  }

  return (
    <div className={className}>
      <div className="flex gap-1 border-b border-line" role="tablist">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === activeItem?.key}
            onClick={() => selectTab(item.key)}
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
