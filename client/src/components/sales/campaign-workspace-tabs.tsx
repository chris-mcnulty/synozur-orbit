import { useRef, type KeyboardEvent } from "react";

export type CampaignWorkspaceTab = "overview" | "prospects" | "meetings" | "setup" | "next-steps";

const tabs: { id: CampaignWorkspaceTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "prospects", label: "Prospects" },
  { id: "meetings", label: "Meetings" },
  { id: "setup", label: "Setup" },
  { id: "next-steps", label: "Next Steps" },
];

export default function CampaignWorkspaceTabs({
  value,
  onChange,
}: {
  value: CampaignWorkspaceTab;
  onChange: (tab: CampaignWorkspaceTab) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[next];
    if (nextTab) onChange(nextTab.id);
    refs.current[next]?.focus();
  }

  return (
    <div className="mb-4 overflow-x-auto border-b border-border" role="tablist" aria-label="Campaign workspace">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => { refs.current[index] = node; }}
            id={`campaign-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={value === tab.id}
            aria-controls={`campaign-panel-${tab.id}`}
            tabIndex={value === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`min-h-10 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              value === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
