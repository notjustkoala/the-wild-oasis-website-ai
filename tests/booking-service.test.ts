import { describe, expect, it, vi } from "vitest";
import {
  createVerifiedBooking,
  type CreateBookingInput,
  updateVerifiedBooking,
  type UpdateBookingInput,
} from "../app/_lib/booking-service";

function createRepository(overrides = {}) {
  return {
    getCabin: vi.fn().mockResolvedValue({
      id: 3,
      regularPrice: 500,
      discount: 50,
      maxCapacity: 4,
    }),
    getSettings: vi.fn().mockResolvedValue({
      minBookingLength: 2,
      maxBookingLength: 14,
      maxGuestsPerBooking: 6,
    }),
    getOwnedBooking: vi.fn().mockResolvedValue({
      id: 21,
      cabinId: 3,
      guestId: 7,
    }),
    findConflicts: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue({ id: 99 }),
    updateForGuest: vi.fn().mockResolvedValue({ id: 21 }),
    ...overrides,
  };
}

const validInput: CreateBookingInput = {
  cabinId: 3,
  startDate: "2026-08-10",
  endDate: "2026-08-13",
  numGuests: 2,
  observations: "Late arrival",
};
const now = new Date("2026-08-04T12:00:00.000Z");
const validUpdateInput: UpdateBookingInput = {
  bookingId: 21,
  numGuests: 2,
  observations: "Quiet room, please",
};

describe("createVerifiedBooking", () => {
  it("inserts a server-calculated booking for valid input", async () => {
    const repository = createRepository();

    const result = await createVerifiedBooking({
      input: validInput,
      guestId: 7,
      repository,
      now,
    });

    expect(repository.getCabin).toHaveBeenCalledWith(3);
    expect(repository.getSettings).toHaveBeenCalledOnce();
    expect(repository.findConflicts).toHaveBeenCalledWith({
      cabinId: 3,
      startDate: "2026-08-10",
      endDate: "2026-08-13",
    });
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        numNights: 3,
        cabinPrice: 1350,
        totalPrice: 1350,
      })
    );
    expect(result).not.toHaveProperty("cabinPrice", 1);
  });

  it.each([
    ["missing field", { ...validInput, startDate: undefined }],
    ["wrong type", { ...validInput, numGuests: { value: 2 } }],
    ["unknown field", { ...validInput, isAdmin: true }],
  ])("rejects %s before making repository calls", async (_label, input) => {
    const repository = createRepository();

    await expect(
      createVerifiedBooking({ input, guestId: 7, repository, now })
    ).rejects.toThrow("Booking input is invalid");

    expect(repository.getCabin).not.toHaveBeenCalled();
    expect(repository.getSettings).not.toHaveBeenCalled();
    expect(repository.findConflicts).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects a conflicting stay immediately before insert", async () => {
    const repository = createRepository({
      findConflicts: vi.fn().mockResolvedValue([{ id: 42 }]),
    });

    await expect(
      createVerifiedBooking({ input: validInput, guestId: 7, repository, now })
    ).rejects.toThrow("no longer available");
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects an over-capacity request", async () => {
    const repository = createRepository();

    await expect(
      createVerifiedBooking({
        input: { ...validInput, numGuests: 5 },
        guestId: 7,
        repository,
        now,
      })
    ).rejects.toThrow("at most 4 guests");
    expect(repository.findConflicts).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("also enforces the global guest limit from settings", async () => {
    const repository = createRepository({
      getSettings: vi.fn().mockResolvedValue({
        minBookingLength: 2,
        maxBookingLength: 14,
        maxGuestsPerBooking: 2,
      }),
    });

    await expect(
      createVerifiedBooking({
        input: { ...validInput, numGuests: 3 },
        guestId: 7,
        repository,
        now,
      })
    ).rejects.toThrow("at most 2 guests");
    expect(repository.findConflicts).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects a past stay before checking availability", async () => {
    const repository = createRepository();

    await expect(
      createVerifiedBooking({
        input: {
          ...validInput,
          startDate: "2026-08-01",
          endDate: "2026-08-04",
        },
        guestId: 7,
        repository,
        now,
      })
    ).rejects.toThrow("cannot be in the past");
    expect(repository.findConflicts).not.toHaveBeenCalled();
  });
});

describe("updateVerifiedBooking", () => {
  it("rejects a forged guest count such as 999", async () => {
    const repository = createRepository();

    await expect(
      updateVerifiedBooking({
        input: { ...validUpdateInput, numGuests: 999 },
        guestId: 7,
        repository,
      })
    ).rejects.toThrow("at most 4 guests");
    expect(repository.updateForGuest).not.toHaveBeenCalled();
  });

  it("rejects a guest count above the cabin capacity", async () => {
    const repository = createRepository();

    await expect(
      updateVerifiedBooking({
        input: { ...validUpdateInput, numGuests: 5 },
        guestId: 7,
        repository,
      })
    ).rejects.toThrow("at most 4 guests");
    expect(repository.updateForGuest).not.toHaveBeenCalled();
  });

  it("rejects a guest count above the global booking setting", async () => {
    const repository = createRepository({
      getSettings: vi.fn().mockResolvedValue({
        minBookingLength: 2,
        maxBookingLength: 14,
        maxGuestsPerBooking: 2,
      }),
    });

    await expect(
      updateVerifiedBooking({
        input: { ...validUpdateInput, numGuests: 3 },
        guestId: 7,
        repository,
      })
    ).rejects.toThrow("at most 2 guests");
    expect(repository.updateForGuest).not.toHaveBeenCalled();
  });

  it("updates a valid guest-owned booking with trusted fields only", async () => {
    const repository = createRepository();

    const result = await updateVerifiedBooking({
      input: validUpdateInput,
      guestId: 7,
      repository,
    });

    expect(repository.getOwnedBooking).toHaveBeenCalledWith(21, 7);
    expect(repository.getCabin).toHaveBeenCalledWith(3);
    expect(repository.getSettings).toHaveBeenCalledOnce();
    expect(repository.updateForGuest).toHaveBeenCalledWith({
      bookingId: 21,
      guestId: 7,
      changes: {
        numGuests: 2,
        observations: "Quiet room, please",
      },
    });
    expect(result).toEqual({
      bookingId: 21,
      cabinId: 3,
      numGuests: 2,
      observations: "Quiet room, please",
    });
  });

  it("keeps the ownership boundary before reading rules or updating", async () => {
    const repository = createRepository({
      getOwnedBooking: vi.fn().mockResolvedValue(null),
    });

    await expect(
      updateVerifiedBooking({
        input: validUpdateInput,
        guestId: 8,
        repository,
      })
    ).rejects.toThrow("not allowed to edit");

    expect(repository.getOwnedBooking).toHaveBeenCalledWith(21, 8);
    expect(repository.getCabin).not.toHaveBeenCalled();
    expect(repository.getSettings).not.toHaveBeenCalled();
    expect(repository.updateForGuest).not.toHaveBeenCalled();
  });
});
