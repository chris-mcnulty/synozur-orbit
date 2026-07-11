// @vitest-environment jsdom
/**
 * Render-level tests for the useDeepLinkFocus hook.
 *
 * These are more robust than the string-grep regression guards in
 * marketing-deep-links.test.ts: they actually mount a component, set the URL
 * search param, and assert that the target element is scrolled into view and
 * gets the highlight ring class.  A refactor that renames the param, switches
 * away from URLSearchParams, or breaks the data-testid selector will fail here
 * rather than silently shipping a broken deep-link.
 *
 * The tests are kept at the hook level (not the full page level) so we don't
 * have to mock hundreds of API calls.  The hook is the single source of truth
 * for the URL-param → scroll/highlight behaviour that all four marketing pages
 * share.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen, cleanup } from "@testing-library/react";
import { useState } from "react";
import { useDeepLinkFocus } from "./use-deep-link-focus";

type Item = { id: string; label: string };

/**
 * A minimal test component that mirrors what EditorialCalendarPage does:
 *  - renders a list of items with `data-testid="${prefix}-${id}"`
 *  - applies a ring class when `focusId === item.id`
 */
function DeepLinkList({
  paramName,
  prefix,
  items,
  preReveal,
  onFound,
  clearAfterMs,
  revealDelayMs,
}: {
  paramName: string;
  prefix: string;
  items: Item[];
  preReveal?: (item: Item) => void;
  onFound?: (item: Item) => void;
  clearAfterMs?: number;
  revealDelayMs?: number;
}) {
  const [focusId] = useDeepLinkFocus({ paramName, items, testIdPrefix: prefix, preReveal, onFound, clearAfterMs, revealDelayMs });
  return (
    <ul>
      {items.map((item) => (
        <li
          key={item.id}
          data-testid={`${prefix}-${item.id}`}
          className={focusId === item.id ? "ring-2 ring-primary ring-offset-2" : ""}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A component that simulates the campaign-detail tab pattern:
 * items start hidden (wrong tab) and are revealed via preReveal.
 */
function TabbedDeepLinkList({
  paramName,
  prefix,
  items,
  revealDelayMs,
}: {
  paramName: string;
  prefix: string;
  items: Item[];
  revealDelayMs?: number;
}) {
  const [activeTab, setActiveTab] = useState<"other" | "target">("other");

  const [focusId] = useDeepLinkFocus({
    paramName,
    items,
    testIdPrefix: prefix,
    revealDelayMs,
    preReveal: () => {
      setActiveTab("target");
    },
  });

  return (
    <div>
      <div data-testid="active-tab">{activeTab}</div>
      {activeTab === "target" && (
        <ul>
          {items.map((item) => (
            <li
              key={item.id}
              data-testid={`${prefix}-${item.id}`}
              className={focusId === item.id ? "ring-2 ring-primary ring-offset-2" : ""}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ITEMS: Item[] = [
  { id: "b1", label: "Brief One" },
  { id: "b2", label: "Brief Two" },
  { id: "b3", label: "Brief Three" },
];

describe("useDeepLinkFocus", () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  function setSearch(search: string) {
    window.history.replaceState({}, "", `/${search}`);
  }

  it("applies the highlight ring to the element whose id matches the URL param", async () => {
    setSearch("?brief=b2");
    await act(async () => {
      render(
        <DeepLinkList paramName="brief" prefix="brief" items={ITEMS} />,
      );
    });
    const el = screen.getByTestId("brief-b2");
    expect(el.className).toContain("ring-2");
  });

  it("does NOT apply the ring to non-matching items", async () => {
    setSearch("?brief=b2");
    await act(async () => {
      render(
        <DeepLinkList paramName="brief" prefix="brief" items={ITEMS} />,
      );
    });
    expect(screen.getByTestId("brief-b1").className).not.toContain("ring-2");
    expect(screen.getByTestId("brief-b3").className).not.toContain("ring-2");
  });

  it("calls scrollIntoView on the matching element", async () => {
    setSearch("?brief=b1");
    await act(async () => {
      render(
        <DeepLinkList paramName="brief" prefix="brief" items={ITEMS} />,
      );
    });
    expect(scrollIntoViewMock).toHaveBeenCalledOnce();
  });

  it("fires the onFound callback with the matching item", async () => {
    setSearch("?brief=b3");
    const onFound = vi.fn();
    await act(async () => {
      render(
        <DeepLinkList
          paramName="brief"
          prefix="brief"
          items={ITEMS}
          onFound={onFound}
        />,
      );
    });
    expect(onFound).toHaveBeenCalledOnce();
    expect(onFound).toHaveBeenCalledWith(ITEMS[2]);
  });

  it("does nothing when the param is absent", async () => {
    setSearch("");
    await act(async () => {
      render(
        <DeepLinkList paramName="brief" prefix="brief" items={ITEMS} />,
      );
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    for (const item of ITEMS) {
      expect(screen.getByTestId(`brief-${item.id}`).className).not.toContain("ring-2");
    }
  });

  it("does nothing when the id in the param has no matching item", async () => {
    setSearch("?brief=no-such-id");
    await act(async () => {
      render(
        <DeepLinkList paramName="brief" prefix="brief" items={ITEMS} />,
      );
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("does nothing when items are empty (still loading)", async () => {
    setSearch("?brief=b1");
    await act(async () => {
      render(
        <DeepLinkList paramName="brief" prefix="brief" items={[]} />,
      );
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("honours a custom testIdPrefix (email deep-link pattern)", async () => {
    setSearch("?emailId=e42");
    const emails: Item[] = [
      { id: "e41", label: "Email 41" },
      { id: "e42", label: "Email 42" },
    ];
    await act(async () => {
      render(
        <DeepLinkList paramName="emailId" prefix="card-email" items={emails} />,
      );
    });
    const el = screen.getByTestId("card-email-e42");
    expect(el.className).toContain("ring-2");
    expect(scrollIntoViewMock).toHaveBeenCalledOnce();
  });

  it("honours the social-post deep-link pattern (?post=)", async () => {
    setSearch("?post=p5");
    const posts: Item[] = [
      { id: "p4", label: "Post 4" },
      { id: "p5", label: "Post 5" },
    ];
    await act(async () => {
      render(
        <DeepLinkList paramName="post" prefix="calendar-post" items={posts} />,
      );
    });
    const el = screen.getByTestId("calendar-post-p5");
    expect(el.className).toContain("ring-2");
    expect(scrollIntoViewMock).toHaveBeenCalledOnce();
  });

  it("clears the highlight ring after the timeout", async () => {
    vi.useFakeTimers();
    setSearch("?brief=b1");
    await act(async () => {
      render(
        <DeepLinkList paramName="brief" prefix="brief" items={ITEMS} clearAfterMs={2500} />,
      );
    });
    expect(screen.getByTestId("brief-b1").className).toContain("ring-2");
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(screen.getByTestId("brief-b1").className).not.toContain("ring-2");
    vi.useRealTimers();
  });

  describe("preReveal — campaign social Posts tab pattern", () => {
    it("calls preReveal immediately when the item is found in the list", async () => {
      setSearch("?post=b2");
      const preReveal = vi.fn();
      await act(async () => {
        render(
          <DeepLinkList
            paramName="post"
            prefix="post"
            items={ITEMS}
            preReveal={preReveal}
            revealDelayMs={0}
          />,
        );
      });
      expect(preReveal).toHaveBeenCalledOnce();
      expect(preReveal).toHaveBeenCalledWith(ITEMS[1]);
    });

    it("scrolls to and highlights the target even when it starts hidden behind a tab", async () => {
      vi.useFakeTimers();
      setSearch("?post=b1");
      const posts: Item[] = [{ id: "b1", label: "Post 1" }, { id: "b2", label: "Post 2" }];
      await act(async () => {
        render(
          <TabbedDeepLinkList paramName="post" prefix="post" items={posts} revealDelayMs={50} />,
        );
      });
      // Before the reveal delay: preReveal has switched the tab (DOM updated)
      // but scroll hasn't fired yet.
      expect(screen.getByTestId("active-tab").textContent).toBe("target");
      expect(scrollIntoViewMock).not.toHaveBeenCalled();

      // After the reveal delay: hook queries DOM, finds element, scrolls.
      await act(async () => { vi.advanceTimersByTime(50); });
      expect(scrollIntoViewMock).toHaveBeenCalledOnce();
      expect(screen.getByTestId("post-b1").className).toContain("ring-2");
      vi.useRealTimers();
    });

    it("does not call preReveal when the param is absent", async () => {
      setSearch("");
      const preReveal = vi.fn();
      await act(async () => {
        render(
          <DeepLinkList paramName="post" prefix="post" items={ITEMS} preReveal={preReveal} revealDelayMs={0} />,
        );
      });
      expect(preReveal).not.toHaveBeenCalled();
    });
  });
});
