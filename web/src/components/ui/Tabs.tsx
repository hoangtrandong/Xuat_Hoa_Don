"use client";
// src/components/ui/Tabs.tsx
import { cn } from "@/lib/utils";

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
}

export default function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className="inline-flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      {items.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
            active === tab.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1 text-xs text-gray-400">({tab.count})</span>}
        </button>
      ))}
    </div>
  );
}