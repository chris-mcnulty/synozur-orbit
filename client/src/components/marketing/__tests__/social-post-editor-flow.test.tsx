// @vitest-environment jsdom
/**
 * Flow tests for the shared SocialPostEditor.
 *
 * Three sets of tests:
 *
 * 1. SocialPostEditor component (direct) — save, approve, delete mutations fire
 *    the right requests; dialog closes and change-callbacks are invoked.
 *
 * 2. Queue surface (real QueuePage) — editor opens on row-click; save, approve
 *    (via deep-link), and delete all complete end-to-end; list is refreshed.
 *
 * 3. Pipeline surface (real ContentPipelinePage) — editor opens on card-click;
 *    save, approve, and delete all complete end-to-end; the pipeline calendar
 *    query is invalidated on every change.
 *
 * Surface tests import the real page component and mock only the layout shell,
 * DnD, and view-switcher — ensuring that any regression in state wiring, prop
 * threading, or invalidation key is caught.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── module mocks ──────────────────────────────────────────────────────────────
// Must be declared before any import that transitively loads the mocked module.

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
  useLocation: () => ["/", vi.fn()],
  useSearch: () => "",
  // vi.fn so campaign-detail tests can override it per-describe block.
  useParams: vi.fn(() => ({})),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-upload", () => ({
  useUpload: () => ({ uploadFile: vi.fn(), isUploading: false }),
}));

vi.mock("@/components/marketing/AIRewritePanel", () => ({
  default: () => React.createElement("div", { "data-testid": "stub-ai-rewrite" }),
}));

vi.mock("@/components/marketing/post-stage", () => ({
  PostStageBadge: () => React.createElement("span", { "data-testid": "stub-stage-badge" }),
}));

// Shells used by both page components — render children as-is.
vi.mock("@/components/layout/AppLayout", () => ({
  default: ({ children }: any) =>
    React.createElement("div", { "data-testid": "app-layout" }, children),
}));

vi.mock("@/components/marketing/CalendarViewSwitcher", () => ({
  CalendarViewSwitcher: () => null,
}));

vi.mock("@/components/EmptyPageState", () => ({
  default: () => null,
}));

// DnD (used by ContentPipelinePage) — pass children through; stub sensor hooks.
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: any) => children,
  DragOverlay: () => null,
  MouseSensor: function MouseSensor() {},
  TouchSensor: function TouchSensor() {},
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  useSensor: () => null,
  useSensors: (...sensors: any[]) => sensors,
}));

// ── mocks needed by CalendarPage ──────────────────────────────────────────────

// useDeepLinkFocus is a read-only hook; return a stable no-op for all tests.
vi.mock("@/lib/use-deep-link-focus", () => ({
  useDeepLinkFocus: () => [null, vi.fn()],
}));

// ── mocks needed by CampaignDetailPage ───────────────────────────────────────

// Post-batch rollup: return empty batches so the draft test post is always a
// "loose" post (not collapsed into a batch header) and the edit button renders.
vi.mock("@shared/social-rollup", () => ({
  rollupPosts: () => ({ batches: [], loosePosts: [] }),
  batchSourceOf: () => null,
}));

vi.mock("@/components/ui/optimized-thumbnail", () => ({
  OptimizedThumbnail: () => null,
  thumbnailUrl: () => "",
  buildSrcSet: () => "",
}));

vi.mock("@/hooks/use-job-status", () => ({
  useJobStatus: () => ({ status: null }),
  jobStatusLabel: () => "",
}));

vi.mock("@/components/marketing/LinkBuilderTab", () => ({
  LinkBuilderTab: () => null,
}));

vi.mock("@/components/marketing/CampaignLinkClicks", () => ({
  CampaignLinkClicks: () => null,
}));

// hub-components: stub all named exports used by CampaignDetailPage.
vi.mock("@/pages/app/marketing/hub-components", () => ({
  RollupStat: () => null,
  HubItemsList: () => null,
  AttachDialog: () => null,
  CreateActionDialog: () => null,
  STAGE_META: {},
  STAGE_ORDER: [],
}));

vi.mock("@/components/marketing/NextActionsByBatch", () => ({
  CampaignNextActions: () => null,
}));

// ── component imports (after mocks) ──────────────────────────────────────────

import SocialPostEditor from "../SocialPostEditor";
import QueuePage from "@/pages/app/marketing/queue";
import ContentPipelinePage from "@/pages/app/marketing/pipeline";
import CalendarPage from "@/pages/app/marketing/calendar";
import CampaignDetailPage from "@/pages/app/marketing/campaign-detail";
import { useParams } from "wouter";

// ── fixtures ──────────────────────────────────────────────────────────────────

/**
 * Minimal campaign fixture used by CampaignDetailPage tests.
 * Only the fields the component reads during initial render are required.
 */
const CAMPAIGN_FIXTURE = {
  id: "camp-1",
  name: "Test Campaign",
  status: "active",
  campaignType: "theme",
  assets: [],
  pinnedBrandAssets: [],
  socialAccounts: [],
};

/**
 * A full-post fixture (status: draft) used by SocialPostEditor and by the
 * queue deep-link path.  Draft status activates Save changes, Save & approve,
 * and Delete this post simultaneously — the widest coverage per render.
 */
const DRAFT_FULL_POST = {
  id: "post-abc",
  platform: "linkedin",
  content: "Original content",
  editedContent: "Edited content",
  hashtags: ["tech"],
  publishError: null,
  publishedUrl: null,
  publishedAt: null,
  status: "draft",
  postFormat: "standard",
  scheduledDate: null,
  overrideImageUrl: null,
  leadImageUrl: null,
  carouselSlides: null,
  campaignId: "camp-1",
  socialAccountId: "acct-1",
  deliveryMode: null,
  exactSchedule: false,
  linkUrl: null,
  linkLabel: null,
  // CalendarPost / CalendarPostRow shape (calendar endpoint fields)
  preview: "Edited content",
  accountName: "Test LinkedIn",
  campaignName: "Test Campaign",
  sourceBriefId: null,
};

/**
 * A failed post used in queue save/delete tests: status "publish_failed" gives
 * it a non-null queueStage so the row appears in the rendered queue list,
 * while isReadOnly stays false so Save changes and Delete show.
 */
const FAILED_FULL_POST = {
  ...DRAFT_FULL_POST,
  status: "publish_failed",
  scheduledDate: null,
  publishError: "API rate limit exceeded",
};

// ── fetch stub factory ────────────────────────────────────────────────────────

type Call = { url: string; method: string; body?: unknown };

/**
 * Build a fetch stub.
 *
 * @param queueCalendarPosts - rows returned by /api/generated-posts/calendar
 *        (used for queue list rendering and pipeline board rendering)
 * @param fullPost - the post returned by /api/generated-posts/:id (editor load
 *        + optional queue deep-link load)
 */
function makeFetchStub(
  queueCalendarPosts: unknown[] = [],
  fullPost: unknown = DRAFT_FULL_POST,
) {
  const calls: Call[] = [];

  const stub = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(init.body as string) : undefined;
    } catch {
      body = init?.body;
    }
    calls.push({ url, method, body });

    // ── CalendarPage needs ────────────────────────────────────────────────────
    if (method === "GET" && url.includes("/api/tenant/info")) {
      return ok({ features: { socialPosts: true } });
    }
    if (method === "GET" && url.includes("/api/marketing-calendar/filters")) {
      return ok({ campaigns: [] });
    }

    // ── CampaignDetailPage needs (specific before generic) ────────────────────
    // Job-status polling
    if (method === "GET" && url.includes("/generate-posts-status")) {
      return ok({ status: "idle" });
    }
    // Generation config
    if (method === "GET" && url.includes("/api/social/generation-config")) {
      return ok({ minVariantsPerPlatform: 3, maxVariantsPerPlatform: 10, maxDraftsPerGeneration: 60 });
    }
    // Strategic context
    if (method === "GET" && url.includes("/strategic-context")) {
      return ok({ available: false, sections: {} });
    }
    // Campaign posts (must come before the generic /api/campaigns handler)
    if (method === "GET" && url.includes("/api/campaigns/") && url.includes("/generated-posts")) {
      return ok(queueCalendarPosts);
    }
    // Single campaign
    if (method === "GET" && url.match(/\/api\/campaigns\/camp-\w+$/)) {
      return ok(CAMPAIGN_FIXTURE);
    }
    // ── Shared / queue / pipeline ─────────────────────────────────────────────
    // Calendar (queue rows, pipeline board)
    if (method === "GET" && url.includes("/api/generated-posts/calendar")) {
      return ok(queueCalendarPosts);
    }
    // Individual post (editor load + queue deep-link)
    if (method === "GET" && url.includes("/api/generated-posts/")) {
      return ok(fullPost);
    }
    // Social accounts (queue AccountPausePanel + editor account picker)
    if (method === "GET" && url.includes("/api/social-accounts")) {
      return ok([]);
    }
    // Pipeline sources
    if (method === "GET" && url.includes("/api/email/saved")) return ok([]);
    if (method === "GET" && url.includes("/api/content-briefs")) return ok([]);
    if (method === "GET" && url.includes("/api/campaigns")) return ok([]);
    if (method === "GET" && url.includes("/api/brand-assets")) return ok([]);
    // Catch-all for other GET calls (content-assets, categories, personas, etc.)
    // Return [] so queries with `= []` defaults never receive a non-array.
    if (method === "GET") return ok([]);

    // All writes succeed with a minimal echoed payload.
    return ok({ id: "post-abc", status: (fullPost as any).status });
  });

  return { stub, calls };
}

function ok(data: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    QueryClientProvider,
    { client: makeQueryClient() },
    children,
  );
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Polyfill matchMedia (jsdom omits it; ContentPipelinePage checks pointer type)
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Reset URL (queue deep-link tests may set ?postId=)
  window.history.pushState({}, "", "/");
  // Clear pipeline's persisted view preference
  try { localStorage.clear(); } catch { /* ignore */ }
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Wait until the Save changes button is in the DOM — that confirms the editor
 * has mounted AND the post query has resolved (the button is gated on `post`).
 */
async function waitForEditorReady(timeout = 4000) {
  return waitFor(
    () => {
      const btn = screen.getByTestId("edit-dialog-save");
      expect(btn).not.toBeNull();
      return btn;
    },
    { timeout },
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SocialPostEditor (direct — no host page)
// ═════════════════════════════════════════════════════════════════════════════

function renderEditor(props: Partial<React.ComponentProps<typeof SocialPostEditor>> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    React.createElement(
      Wrapper,
      null,
      React.createElement(SocialPostEditor, {
        postId: "post-abc",
        onClose,
        onChanged,
        ...props,
      }),
    ),
  );
  return { onClose, onChanged };
}

describe("SocialPostEditor — save mutation", () => {
  it("fires PATCH /api/generated-posts/:id when Save changes is clicked", async () => {
    const { stub, calls } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      const patch = calls.find(
        (c) => c.method === "PATCH" && c.url.includes("/api/generated-posts/post-abc"),
      );
      expect(patch).toBeDefined();
    });
  });

  it("calls onClose after a successful save", async () => {
    const { stub } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    const { onClose } = renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("calls onChanged after a successful save (list-refresh signal)", async () => {
    const { stub } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    const { onChanged } = renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });
});

describe("SocialPostEditor — approve mutation", () => {
  it("shows the Save & approve button for a draft post", async () => {
    const { stub } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    renderEditor();

    await waitForEditorReady();
    expect(screen.getByTestId("edit-dialog-approve").textContent).toContain("approve");
  });

  it("fires PATCH with status:approved when Save & approve is clicked", async () => {
    const { stub, calls } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) =>
          c.method === "PATCH" &&
          c.url.includes("/api/generated-posts/post-abc") &&
          (c.body as any)?.status === "approved",
      );
      expect(hit).toBeDefined();
    });
  });

  it("calls onClose after a successful approve", async () => {
    const { stub } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    const { onClose } = renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe("SocialPostEditor — delete mutation", () => {
  it("reveals the confirm section after clicking Delete this post", async () => {
    const { stub } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });

    await waitFor(() => {
      expect(screen.getByTestId("edit-dialog-confirm-cancel")).not.toBeNull();
    });
  });

  it("fires PUT status:deleted (campaign-scoped URL) when confirmed", async () => {
    const { stub, calls } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) => c.method === "PUT" && (c.body as any)?.status === "deleted",
      );
      expect(hit).toBeDefined();
      // campaignId is "camp-1" so the URL must be campaign-scoped.
      expect(hit!.url).toContain("camp-1");
    });
  });

  it("calls onClose after a successful delete", async () => {
    const { stub } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    const { onClose } = renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("hides the confirm section if Keep it is clicked", async () => {
    const { stub } = makeFetchStub();
    vi.stubGlobal("fetch", stub);
    renderEditor();

    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /keep it/i }));
    });

    expect(screen.queryByTestId("edit-dialog-confirm-cancel")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Queue surface (real QueuePage)
//
// The queue shows posts with a non-null queueStage (scheduled/failed/missed/
// posted/exported). Row click → setEditPost → SocialPostEditor.
//
// Approve: draft posts don't appear in the queue list but can be opened via
// the ?postId= deep-link mechanism that QueuePage already supports.
// ═════════════════════════════════════════════════════════════════════════════

function renderQueue() {
  render(React.createElement(Wrapper, null, React.createElement(QueuePage)));
}

describe("Queue surface — save (failed post row → editor → save)", () => {
  it("opens the editor when a queue row is clicked", async () => {
    const { stub } = makeFetchStub([FAILED_FULL_POST], FAILED_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderQueue();

    await waitFor(
      () => expect(screen.getByTestId(`queue-row-post-abc`)).not.toBeNull(),
      { timeout: 3000 },
    );
    await act(async () => { fireEvent.click(screen.getByTestId("queue-row-post-abc")); });

    await waitFor(() => {
      expect(screen.getByTestId("social-post-editor")).not.toBeNull();
    });
  });

  it("fires PATCH /api/generated-posts/:id when Save changes is clicked from queue", async () => {
    const { stub, calls } = makeFetchStub([FAILED_FULL_POST], FAILED_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderQueue();

    await waitFor(() => screen.getByTestId("queue-row-post-abc"), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId("queue-row-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      expect(
        calls.find(
          (c) => c.method === "PATCH" && c.url.includes("/api/generated-posts/post-abc"),
        ),
      ).toBeDefined();
    });
  });

  it("closes the editor after saving from queue (row cleared from state)", async () => {
    const { stub } = makeFetchStub([FAILED_FULL_POST], FAILED_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderQueue();

    await waitFor(() => screen.getByTestId("queue-row-post-abc"), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId("queue-row-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

describe("Queue surface — approve (draft post via deep-link → editor → approve)", () => {
  beforeEach(() => {
    // Simulate arriving at the queue with ?postId=post-abc (deep-link from pipeline board).
    window.history.pushState({}, "", "/?postId=post-abc");
  });

  it("opens the editor for the deep-linked draft post", async () => {
    // Calendar returns nothing (draft posts don't appear in queue list).
    const { stub } = makeFetchStub([], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderQueue();

    await waitFor(
      () => expect(screen.getByTestId("social-post-editor")).not.toBeNull(),
      { timeout: 4000 },
    );
  });

  it("fires PATCH with status:approved when approve is clicked from queue deep-link", async () => {
    const { stub, calls } = makeFetchStub([], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderQueue();

    await waitForEditorReady(4000);
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) =>
          c.method === "PATCH" &&
          c.url.includes("/api/generated-posts/post-abc") &&
          (c.body as any)?.status === "approved",
      );
      expect(hit).toBeDefined();
    });
  });

  it("closes the queue editor after approve", async () => {
    const { stub } = makeFetchStub([], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderQueue();

    await waitForEditorReady(4000);
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

describe("Queue surface — delete (failed post row → editor → delete)", () => {
  it("fires PUT status:deleted when delete is confirmed from queue", async () => {
    const { stub, calls } = makeFetchStub([FAILED_FULL_POST], FAILED_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderQueue();

    await waitFor(() => screen.getByTestId("queue-row-post-abc"), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId("queue-row-post-abc")); });
    await waitForEditorReady();

    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) => c.method === "PUT" && (c.body as any)?.status === "deleted",
      );
      expect(hit).toBeDefined();
    });
  });

  it("closes the queue editor after delete", async () => {
    const { stub } = makeFetchStub([FAILED_FULL_POST], FAILED_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderQueue();

    await waitFor(() => screen.getByTestId("queue-row-post-abc"), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId("queue-row-post-abc")); });
    await waitForEditorReady();

    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Calendar surface (real CalendarPage)
//
// CalendarPage holds `selectedPost` (a CalendarPost | null).  Clicking a pill
// in the month grid — or a row in the unscheduled-drafts rail — calls
// `setSelectedPost(post)`, which mounts SocialPostEditor with
// `postId={selectedPost.id}` and `onClose={() => setSelectedPost(null)}`.
//
// We use a post with scheduledDate: null so it lands in the unscheduled-drafts
// rail (testid="unscheduled-post-post-abc"), avoiding date-grid math.
// The tenant/info mock returns socialPosts: true so isAllowed is true.
// ═════════════════════════════════════════════════════════════════════════════

function renderCalendarPage() {
  render(
    React.createElement(Wrapper, null, React.createElement(CalendarPage)),
  );
}

describe("Calendar surface — save (unscheduled pill → editor → save)", () => {
  it("opens the editor when an unscheduled-drafts row is clicked", async () => {
    // DRAFT_FULL_POST has scheduledDate: null → unscheduled rail.
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCalendarPage();

    await waitFor(
      () => expect(screen.getByTestId("unscheduled-post-post-abc")).not.toBeNull(),
      { timeout: 4000 },
    );
    await act(async () => { fireEvent.click(screen.getByTestId("unscheduled-post-post-abc")); });

    await waitFor(() => {
      expect(screen.getByTestId("social-post-editor")).not.toBeNull();
    });
  });

  it("fires PATCH /api/generated-posts/:id when Save changes is clicked from calendar", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCalendarPage();

    await waitFor(() => screen.getByTestId("unscheduled-post-post-abc"), { timeout: 4000 });
    await act(async () => { fireEvent.click(screen.getByTestId("unscheduled-post-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      expect(
        calls.find(
          (c) => c.method === "PATCH" && c.url.includes("/api/generated-posts/post-abc"),
        ),
      ).toBeDefined();
    });
  });

  it("closes the calendar editor after save (selectedPost cleared)", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCalendarPage();

    await waitFor(() => screen.getByTestId("unscheduled-post-post-abc"), { timeout: 4000 });
    await act(async () => { fireEvent.click(screen.getByTestId("unscheduled-post-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

describe("Calendar surface — approve (unscheduled pill → editor → approve)", () => {
  it("fires PATCH with status:approved when approve is clicked from calendar", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCalendarPage();

    await waitFor(() => screen.getByTestId("unscheduled-post-post-abc"), { timeout: 4000 });
    await act(async () => { fireEvent.click(screen.getByTestId("unscheduled-post-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) =>
          c.method === "PATCH" &&
          c.url.includes("/api/generated-posts/post-abc") &&
          (c.body as any)?.status === "approved",
      );
      expect(hit).toBeDefined();
    });
  });

  it("closes the calendar editor after approve (selectedPost cleared)", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCalendarPage();

    await waitFor(() => screen.getByTestId("unscheduled-post-post-abc"), { timeout: 4000 });
    await act(async () => { fireEvent.click(screen.getByTestId("unscheduled-post-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

describe("Calendar surface — delete (unscheduled pill → editor → delete)", () => {
  it("fires PUT status:deleted when delete is confirmed from calendar", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCalendarPage();

    await waitFor(() => screen.getByTestId("unscheduled-post-post-abc"), { timeout: 4000 });
    await act(async () => { fireEvent.click(screen.getByTestId("unscheduled-post-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) => c.method === "PUT" && (c.body as any)?.status === "deleted",
      );
      expect(hit).toBeDefined();
    });
  });

  it("closes the calendar editor after delete (selectedPost cleared)", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCalendarPage();

    await waitFor(() => screen.getByTestId("unscheduled-post-post-abc"), { timeout: 4000 });
    await act(async () => { fireEvent.click(screen.getByTestId("unscheduled-post-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Campaign-detail surface (real CampaignDetailPage)
//
// CampaignDetailPage holds `sharedEditorPostId` (string | null).  Every post
// card's edit button (data-testid="button-edit-<id>") calls
// `setSharedEditorPostId(post.id)`.  SocialPostEditor mounts with
// `postId={sharedEditorPostId}` and `onClose={() => setSharedEditorPostId(null)}`.
//
// Setup requirements:
//   - window.location.hash="#posts" so tabFromHash() initialises activeTab="posts"
//   - useParams() returns { id: "camp-1" }
//   - /api/campaigns/camp-1 → CAMPAIGN_FIXTURE
//   - /api/campaigns/camp-1/generated-posts → [DRAFT_FULL_POST]
//   - rollupPosts() → { batches: [] } so the post is loose (never collapsed)
//   - batchSourceOf() → null (post not part of any batch)
// ═════════════════════════════════════════════════════════════════════════════

function renderCampaignDetailPage() {
  render(
    React.createElement(Wrapper, null, React.createElement(CampaignDetailPage)),
  );
}

describe("Campaign-detail surface — save (post edit button → editor → save)", () => {
  beforeEach(() => {
    // Start on the Social Posts tab so post cards are visible immediately.
    window.location.hash = "#posts";
    vi.mocked(useParams).mockReturnValue({ id: "camp-1" });
  });

  afterEach(() => {
    vi.mocked(useParams).mockReturnValue({});
  });

  it("opens the editor when the post edit button is clicked", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCampaignDetailPage();

    await waitFor(
      () => expect(screen.getByTestId("button-edit-post-abc")).not.toBeNull(),
      { timeout: 5000 },
    );
    await act(async () => { fireEvent.click(screen.getByTestId("button-edit-post-abc")); });

    await waitFor(() => {
      expect(screen.getByTestId("social-post-editor")).not.toBeNull();
    });
  });

  it("fires PATCH /api/generated-posts/:id when Save changes is clicked from campaign-detail", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCampaignDetailPage();

    await waitFor(() => screen.getByTestId("button-edit-post-abc"), { timeout: 5000 });
    await act(async () => { fireEvent.click(screen.getByTestId("button-edit-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      expect(
        calls.find(
          (c) => c.method === "PATCH" && c.url.includes("/api/generated-posts/post-abc"),
        ),
      ).toBeDefined();
    });
  });

  it("closes the campaign-detail editor after save (sharedEditorPostId cleared)", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCampaignDetailPage();

    await waitFor(() => screen.getByTestId("button-edit-post-abc"), { timeout: 5000 });
    await act(async () => { fireEvent.click(screen.getByTestId("button-edit-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

describe("Campaign-detail surface — approve (post edit button → editor → approve)", () => {
  beforeEach(() => {
    window.location.hash = "#posts";
    vi.mocked(useParams).mockReturnValue({ id: "camp-1" });
  });

  afterEach(() => {
    vi.mocked(useParams).mockReturnValue({});
  });

  it("fires PATCH with status:approved when approve is clicked from campaign-detail", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCampaignDetailPage();

    await waitFor(() => screen.getByTestId("button-edit-post-abc"), { timeout: 5000 });
    await act(async () => { fireEvent.click(screen.getByTestId("button-edit-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) =>
          c.method === "PATCH" &&
          c.url.includes("/api/generated-posts/post-abc") &&
          (c.body as any)?.status === "approved",
      );
      expect(hit).toBeDefined();
    });
  });

  it("closes the campaign-detail editor after approve (sharedEditorPostId cleared)", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCampaignDetailPage();

    await waitFor(() => screen.getByTestId("button-edit-post-abc"), { timeout: 5000 });
    await act(async () => { fireEvent.click(screen.getByTestId("button-edit-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

describe("Campaign-detail surface — delete (post edit button → editor → delete)", () => {
  beforeEach(() => {
    window.location.hash = "#posts";
    vi.mocked(useParams).mockReturnValue({ id: "camp-1" });
  });

  afterEach(() => {
    vi.mocked(useParams).mockReturnValue({});
  });

  it("fires PUT status:deleted when delete is confirmed from campaign-detail", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCampaignDetailPage();

    await waitFor(() => screen.getByTestId("button-edit-post-abc"), { timeout: 5000 });
    await act(async () => { fireEvent.click(screen.getByTestId("button-edit-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) => c.method === "PUT" && (c.body as any)?.status === "deleted",
      );
      expect(hit).toBeDefined();
    });
  });

  it("closes the campaign-detail editor after delete (sharedEditorPostId cleared)", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderCampaignDetailPage();

    await waitFor(() => screen.getByTestId("button-edit-post-abc"), { timeout: 5000 });
    await act(async () => { fireEvent.click(screen.getByTestId("button-edit-post-abc")); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Pipeline surface (real ContentPipelinePage)
//
// The pipeline board shows posts in a board column; item.key = "post:<id>".
// Card click → openItem → setEditPostId → SocialPostEditor with onChanged that
// invalidates /api/generated-posts/calendar (production wiring).
//
// A draft post maps to stage "draft" in postToPipelineItem, which is always
// visible, and activates save + approve + delete in the editor.
// ═════════════════════════════════════════════════════════════════════════════

function renderPipeline() {
  render(
    React.createElement(Wrapper, null, React.createElement(ContentPipelinePage)),
  );
}

/** The pipeline card testid for our post (item.key = "post:<id>"). */
const PIPELINE_CARD_ID = "pipeline-card-post:post-abc";

describe("Pipeline surface — save (draft card → editor → save)", () => {
  it("opens the editor when a pipeline card is clicked", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderPipeline();

    await waitFor(
      () => expect(screen.getByTestId(PIPELINE_CARD_ID)).not.toBeNull(),
      { timeout: 3000 },
    );
    await act(async () => { fireEvent.click(screen.getByTestId(PIPELINE_CARD_ID)); });

    await waitFor(() => {
      expect(screen.getByTestId("social-post-editor")).not.toBeNull();
    });
  });

  it("fires PATCH /api/generated-posts/:id when Save changes is clicked from pipeline", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderPipeline();

    await waitFor(() => screen.getByTestId(PIPELINE_CARD_ID), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId(PIPELINE_CARD_ID)); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      expect(
        calls.find(
          (c) => c.method === "PATCH" && c.url.includes("/api/generated-posts/post-abc"),
        ),
      ).toBeDefined();
    });
  });

  it("invalidates /api/generated-posts/calendar after pipeline save (onChanged wiring)", async () => {
    // onChanged in ContentPipelinePage calls:
    //   queryClient.invalidateQueries({ queryKey: ["/api/generated-posts/calendar"] })
    // Invalidation triggers a refetch, which means the calendar endpoint is
    // called a second time after the save completes.
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderPipeline();

    await waitFor(() => screen.getByTestId(PIPELINE_CARD_ID), { timeout: 3000 });
    // Count calendar GETs before save.
    const calendarCallsBefore = () =>
      calls.filter(
        (c) => c.method === "GET" && c.url.includes("/api/generated-posts/calendar"),
      ).length;
    const before = calendarCallsBefore();

    await act(async () => { fireEvent.click(screen.getByTestId(PIPELINE_CARD_ID)); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      // After save, at least one more calendar GET must have fired (refetch).
      expect(calendarCallsBefore()).toBeGreaterThan(before);
    });
  });

  it("closes the pipeline editor after save", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderPipeline();

    await waitFor(() => screen.getByTestId(PIPELINE_CARD_ID), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId(PIPELINE_CARD_ID)); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-save")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

describe("Pipeline surface — approve (draft card → editor → approve)", () => {
  it("fires PATCH with status:approved when approve is clicked from pipeline", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderPipeline();

    await waitFor(() => screen.getByTestId(PIPELINE_CARD_ID), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId(PIPELINE_CARD_ID)); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) =>
          c.method === "PATCH" &&
          c.url.includes("/api/generated-posts/post-abc") &&
          (c.body as any)?.status === "approved",
      );
      expect(hit).toBeDefined();
    });
  });

  it("closes the pipeline editor after approve", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderPipeline();

    await waitFor(() => screen.getByTestId(PIPELINE_CARD_ID), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId(PIPELINE_CARD_ID)); });
    await waitForEditorReady();
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-approve")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});

describe("Pipeline surface — delete (draft card → editor → delete)", () => {
  it("fires PUT status:deleted when delete is confirmed from pipeline", async () => {
    const { stub, calls } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderPipeline();

    await waitFor(() => screen.getByTestId(PIPELINE_CARD_ID), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId(PIPELINE_CARD_ID)); });
    await waitForEditorReady();

    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      const hit = calls.find(
        (c) => c.method === "PUT" && (c.body as any)?.status === "deleted",
      );
      expect(hit).toBeDefined();
    });
  });

  it("closes the pipeline editor after delete", async () => {
    const { stub } = makeFetchStub([DRAFT_FULL_POST], DRAFT_FULL_POST);
    vi.stubGlobal("fetch", stub);
    renderPipeline();

    await waitFor(() => screen.getByTestId(PIPELINE_CARD_ID), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByTestId(PIPELINE_CARD_ID)); });
    await waitForEditorReady();

    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-cancel-post")); });
    await act(async () => { fireEvent.click(screen.getByTestId("edit-dialog-confirm-cancel")); });

    await waitFor(() => {
      expect(screen.queryByTestId("social-post-editor")).toBeNull();
    });
  });
});
