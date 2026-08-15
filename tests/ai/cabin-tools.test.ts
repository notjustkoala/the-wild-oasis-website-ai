import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createConciergeInventoryService,
  type ConciergeInventoryDataSource,
} from "@/app/_ai/tools/cabin-tools";

const cabins = [
  {
    id: 1,
    name: "Cabin 001",
    maxCapacity: 4,
    regularPrice: 300,
    discount: 50,
    image: "/cabin-001.jpg",
    description: "A calm family cabin.",
  },
  {
    id: 2,
    name: "Cabin 002",
    maxCapacity: 6,
    regularPrice: 400,
    discount: 0,
    image: "/cabin-002.jpg",
    description: "A large group cabin.",
  },
  {
    id: 3,
    name: "Cabin 003",
    maxCapacity: 2,
    regularPrice: 180,
    discount: 20,
    image: "/cabin-003.jpg",
    description: "A compact cabin.",
  },
];

function createDataSource(conflicts = [2]): ConciergeInventoryDataSource {
  return {
    listCabins: vi.fn(async () => cabins),
    getCabins: vi.fn(async (ids) => cabins.filter((cabin) => ids.includes(cabin.id))),
    getCabin: vi.fn(async (id) => cabins.find((cabin) => cabin.id === id) ?? null),
    getSettings: vi.fn(async () => ({
      id: 1,
      minBookingLength: 2,
      maxBookingLength: 14,
      maxGuestsPerBooking: 8,
      breakfastPrice: 15,
    })),
    getConflictingCabinIds: vi.fn(async () => conflicts),
  };
}

describe("concierge inventory service", () => {
  it("uses half-open conflicts, capacity, discount, nights and trusted total", async () => {
    const service = createConciergeInventoryService(createDataSource());
    const result = await service.searchAvailableCabins({
      startDate: "2026-09-10",
      endDate: "2026-09-13",
      numGuests: 4,
      maxTotalPrice: 800,
      preferences: ["gluten-free breakfast"],
    });

    expect(result.numNights).toBe(3);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      cabinId: 1,
      nightlyPrice: 250,
      totalPrice: 750,
      withinBudget: true,
      numGuests: 4,
    });
    expect(result.recommendations[0].sourceIds).toContain(
      "availability:1:2026-09-10:2026-09-13"
    );
  });

  it("returns an honest empty result when capacity removes every cabin", async () => {
    const service = createConciergeInventoryService(createDataSource([]));
    const result = await service.searchAvailableCabins({
      startDate: "2026-09-10",
      endDate: "2026-09-13",
      numGuests: 9,
      preferences: [],
    });
    expect(result.recommendations).toEqual([]);
    expect(result.facts[0]).toMatch(/No cabin/i);
  });

  it("compares only current available cabins and preserves application totals", async () => {
    const service = createConciergeInventoryService(createDataSource([2]));
    const result = await service.compareCabins({
      cabinIds: [1, 2, 3],
      startDate: "2026-09-10",
      endDate: "2026-09-13",
      numGuests: 2,
    });
    expect(result.cabins.map((cabin) => cabin.cabinId)).toEqual([3, 1]);
    expect(result.cabins.map((cabin) => cabin.totalPrice)).toEqual([480, 750]);
    expect(result.unavailableCabinIds).toEqual([2]);
  });

  it("loads hotel policy from settings", async () => {
    const service = createConciergeInventoryService(createDataSource());
    await expect(service.getHotelPolicy()).resolves.toMatchObject({
      minBookingLength: 2,
      maxBookingLength: 14,
      maxGuestsPerBooking: 8,
      breakfastPrice: 15,
    });
  });

  it("keeps the AI implementation read-only", () => {
    const source = readFileSync(
      join(process.cwd(), "app/_ai/tools/cabin-tools.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/\.insert\s*\(/);
    expect(source).not.toMatch(/\.update\s*\(/);
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toMatch(/createBooking/);
  });
});
