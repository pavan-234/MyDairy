import { describe, expect, it } from "vitest";
import { localDateKey, localMonthDateRange } from "./date.js";

describe("local calendar dates", () => {
  it("formats calendar dates with zero-padded month and day", () => {
    expect(localDateKey(2026, 0, 5)).toBe("2026-01-05");
  });

  it("returns valid first and last dates for each month", () => {
    expect(localMonthDateRange(2026, 9)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(localMonthDateRange(2024, 1)).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });
});
