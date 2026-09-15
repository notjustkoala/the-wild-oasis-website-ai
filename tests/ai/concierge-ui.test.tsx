import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ConciergeAgentUIMessage } from "@/app/_ai/agents/concierge-agent";
import type {
  CabinRecommendation,
  SearchAvailableCabinsResult,
} from "@/app/_ai/schemas/concierge";
import ConciergePanel, {
  prepareConciergeRequestMessages,
  type ConciergeChatAdapter,
} from "@/app/_components/concierge/ConciergePanel";

const mocks = vi.hoisted(() => ({
  adoptDraft: vi.fn(),
  push: vi.fn(),
  liveChat: {
    messages: [],
    sendMessage: vi.fn(),
    status: "ready",
    stop: vi.fn(),
    regenerate: vi.fn(),
    error: undefined,
    clearError: vi.fn(),
  },
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => mocks.liveChat,
}));

vi.mock("@/app/_components/ReservationContext", () => ({
  useReservation: () => ({ adoptDraft: mocks.adoptDraft }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const cabin: CabinRecommendation = {
  cabinId: 1,
  name: "Cabin 001",
  maxCapacity: 4,
  image: "/icon.png",
  description: "A quiet cabin.",
  regularPrice: 300,
  discount: 50,
  nightlyPrice: 250,
  startDate: "2026-10-02",
  endDate: "2026-10-05",
  numNights: 3,
  numGuests: 4,
  totalPrice: 750,
  withinBudget: true,
  preferences: [],
  facts: ["Sleeps up to 4 guests.", "$750 cabin total for 3 nights."],
  sourceIds: ["cabins:1", "settings:1"],
};

function searchOutput(
  recommendations: CabinRecommendation[]
): SearchAvailableCabinsResult {
  return {
    kind: "cabin-search",
    startDate: "2026-10-02",
    endDate: "2026-10-05",
    numNights: 3,
    numGuests: 4,
    currency: "USD",
    maxTotalPrice: 1200,
    recommendations,
    facts: recommendations.length ? ["Live inventory checked."] : ["No cabin."],
    sourceIds: ["settings:1", "availability:all"],
  };
}

function assistantMessage(parts: unknown[]): ConciergeAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts,
  } as ConciergeAgentUIMessage;
}

function createAdapter(
  overrides: Partial<ConciergeChatAdapter> = {}
): ConciergeChatAdapter {
  return {
    messages: [],
    sendMessage: vi.fn(async () => undefined),
    status: "ready",
    stop: vi.fn(async () => undefined),
    regenerate: vi.fn(async () => undefined),
    error: undefined,
    clearError: vi.fn(),
    ...overrides,
  } as ConciergeChatAdapter;
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await interact(() =>
    user.click(screen.getByRole("button", { name: /Ask AI concierge/i }))
  );
  return screen.getByRole("dialog", { name: /AI Concierge/i });
}

async function interact(action: () => Promise<unknown>) {
  await act(async () => {
    await action();
  });
}

describe("ConciergePanel production UI states", () => {
  beforeEach(() => {
    mocks.adoptDraft.mockReset();
    mocks.push.mockReset();
  });

  it("omits assistant tool payloads and provider metadata from follow-up requests", () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "早餐多少钱？" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        metadata: { provider: "x".repeat(40_000) },
        parts: [
          {
            type: "tool-searchHotelPolicies",
            toolCallId: "policy-1",
            state: "output-available",
            input: { question: "早餐多少钱？" },
            output: {
              kind: "policy-search",
              status: "grounded",
              answerContext: "x".repeat(40_000),
              citations: [],
              truncated: false,
            },
            providerMetadata: {
              google: { thoughtSignature: "x".repeat(40_000) },
            },
          },
        ],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "提交预订时会自动扣款吗？" }],
      },
    ] as ConciergeAgentUIMessage[];

    const prepared = prepareConciergeRequestMessages(messages);

    expect(prepared).toEqual([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "早餐多少钱？" }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "提交预订时会自动扣款吗？" }],
      },
    ]);
    expect(
      new TextEncoder().encode(JSON.stringify({ messages: prepared })).byteLength
    ).toBeLessThan(32_000);
  });

  it("keeps the global launcher pointer-accessible above the home background", () => {
    const homepageSource = readFileSync(
      resolve(process.cwd(), "app/page.js"),
      "utf8"
    );
    render(<ConciergePanel chatAdapter={createAdapter()} />);

    // JSDOM has no hit-testing. Lock the production background out of pointer
    // targeting and keep the global launcher in a fixed, elevated layer.
    expect(homepageSource).toContain(
      'className="pointer-events-none object-cover object-top"'
    );
    expect(
      screen.getByRole("button", { name: /Ask AI concierge/i })
    ).toHaveClass("fixed", "z-40");
  });

  it("traps Tab and Shift+Tab, closes on Escape, and restores launcher focus", async () => {
    const user = userEvent.setup();
    render(<ConciergePanel chatAdapter={createAdapter()} />);
    const launcher = screen.getByRole("button", { name: /Ask AI concierge/i });
    const dialog = await openPanel(user);
    const close = within(dialog).getByRole("button", {
      name: "Close AI concierge",
    });
    const textarea = screen.getByRole("textbox", { name: /Message the AI concierge/i });

    expect(close).toHaveFocus();
    expect(dialog).toContainElement(close);
    const backdrop = screen.getAllByRole("button", {
      name: "Close AI concierge",
    })[0];
    expect(backdrop).toHaveAttribute("tabindex", "-1");

    await interact(() => user.tab({ shift: true }));
    expect(textarea).toHaveFocus();
    await interact(() => user.tab());
    expect(close).toHaveFocus();

    await interact(() => user.keyboard("{Escape}"));
    await waitFor(() => expect(launcher).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders streaming typed-tool input and calls Stop", async () => {
    const user = userEvent.setup();
    const adapter = createAdapter({
      status: "streaming",
      messages: [
        assistantMessage([
          {
            type: "tool-searchAvailableCabins",
            toolCallId: "search-1",
            state: "input-available",
            input: {
              startDate: "2026-10-02",
              endDate: "2026-10-05",
              numGuests: 4,
              preferences: [],
            },
          },
        ]),
      ],
    });
    render(<ConciergePanel chatAdapter={adapter} />);
    await openPanel(user);

    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      /Availability.*Checking live data/i
    );
    expect(screen.getByText(/Concierge is working/i)).toBeInTheDocument();
    await interact(() =>
      user.click(screen.getByRole("button", { name: "Stop" }))
    );
    expect(adapter.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Response cancelled/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry last request/i })
    ).not.toBeInTheDocument();
  });

  it("renders typed tool output, handles no inventory, and adopts a real plan", async () => {
    const user = userEvent.setup();
    const adapter = createAdapter({
      messages: [
        assistantMessage([
          {
            type: "tool-searchAvailableCabins",
            toolCallId: "search-1",
            state: "output-available",
            input: {
              startDate: cabin.startDate,
              endDate: cabin.endDate,
              numGuests: cabin.numGuests,
              preferences: [],
            },
            output: searchOutput([cabin]),
          },
          {
            type: "tool-searchAvailableCabins",
            toolCallId: "search-2",
            state: "output-available",
            input: {
              startDate: "2026-12-24",
              endDate: "2026-12-27",
              numGuests: 10,
              preferences: [],
            },
            output: searchOutput([]),
          },
        ]),
      ],
    });
    render(<ConciergePanel chatAdapter={adapter} />);
    await openPanel(user);

    expect(screen.getByText("$750")).toBeInTheDocument();
    expect(screen.getByText(/No cabins match/i)).toBeInTheDocument();
    await interact(() =>
      user.click(
        screen.getByRole("button", { name: /Adopt plan for Cabin 001/i })
      )
    );
    expect(mocks.adoptDraft).toHaveBeenCalledWith({
      cabinId: 1,
      startDate: "2026-10-02",
      endDate: "2026-10-05",
      numGuests: 4,
    });
    expect(mocks.push).toHaveBeenCalledWith("/cabins/1#reservation");
  });

  it("shows date-free cabin details without calling the cabin missing state", async () => {
    const user = userEvent.setup();
    const detailCabin = {
      ...cabin,
      startDate: "",
      endDate: "",
      numNights: 0,
      totalPrice: 0,
      numGuests: 1,
    };
    render(
      <ConciergePanel
        chatAdapter={createAdapter({
          messages: [
            assistantMessage([
              {
                type: "tool-getCabinDetails",
                toolCallId: "details-1",
                state: "output-available",
                input: { cabinId: 1 },
                output: {
                  kind: "cabin-details",
                  cabin: detailCabin,
                  available: null,
                  facts: ["Provide dates."],
                  sourceIds: ["cabins:1"],
                },
              },
            ]),
          ],
        })}
      />
    );
    await openPanel(user);

    expect(screen.getByText("Cabin 001")).toBeInTheDocument();
    expect(screen.getByText("$250/night")).toBeInTheDocument();
    expect(screen.getByText(/Add check-in and checkout dates/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Adopt plan/i })).not.toBeInTheDocument();
  });

  it("calls Send, Retry/Regenerate, and clears errors through the injected adapter", async () => {
    const user = userEvent.setup();
    const adapter = createAdapter({ error: new Error("Gateway unavailable") });
    render(<ConciergePanel chatAdapter={adapter} />);
    await openPanel(user);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not finish that request.*try again/i
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /Gateway unavailable/i
    );

    await interact(() =>
      user.type(
        screen.getByRole("textbox", { name: /Message the AI concierge/i }),
        "Two guests from 2026-10-02 to 2026-10-05"
      )
    );
    await interact(() =>
      user.click(screen.getByRole("button", { name: "Send" }))
    );
    expect(adapter.sendMessage).toHaveBeenCalledWith({
      text: "Two guests from 2026-10-02 to 2026-10-05",
    });
    expect(adapter.clearError).toHaveBeenCalled();

    await interact(() =>
      user.click(screen.getByRole("button", { name: /Retry last request/i }))
    );
    expect(adapter.regenerate).toHaveBeenCalledTimes(1);
    expect(adapter.clearError).toHaveBeenCalledTimes(2);
  });

  it("renders policy citations from the typed policy tool part", async () => {
    const user = userEvent.setup();
    render(<ConciergePanel chatAdapter={createAdapter({
      messages: [assistantMessage([{
        type: "tool-searchHotelPolicies",
        toolCallId: "policy-1",
        state: "output-available",
        input: { question: "What is the pet policy?" },
        output: {
          kind: "policy-search",
          status: "grounded",
          answerContext: "Trusted context",
          citations: [
            { documentId: "pet-policy", title: "Pet policy", section: "Eligible pets and limits", version: 1, effectiveDate: "2026-08-30", excerpt: "One cat or dog up to 20 kg.", scope: "public" },
            { documentId: "cancellation-refund", title: "Cancellation policy", section: "Refunds", version: 1, effectiveDate: "2026-08-30", excerpt: "Refunds return to the original payment method.", scope: "public" },
          ],
          truncated: false,
        },
      }])],
    })} />);
    await openPanel(user);
    expect(screen.getByText(/Pet policy · Eligible pets and limits/)).toBeVisible();
    expect(screen.getAllByText(/Version 1 · Effective 2026-08-30/)).toHaveLength(2);
    const first = screen.getByText(/Pet policy · Eligible pets and limits/).closest("summary");
    const second = screen.getByText(/Cancellation policy · Refunds/).closest("summary");
    first?.focus();
    await interact(() => user.tab());
    expect(second).toHaveFocus();
    await interact(() => user.tab({ shift: true }));
    expect(first).toHaveFocus();
    if (first) await interact(() => user.click(first));
    expect(screen.getByText("One cat or dog up to 20 kg.")).toBeVisible();
  });
});
