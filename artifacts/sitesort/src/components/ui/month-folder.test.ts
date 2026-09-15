import { afterEach, describe, expect, it, vi } from "vitest";
import { splitByMonth, monthLabel } from "./month-folder";

afterEach(() => vi.useRealTimers());

describe("activity month folders", () => {
  it("keeps every current-month entry visible and groups older months newest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 12));
    const current = Array.from({ length: 12 }, (_, i) => ({ id: `current-${i}`, date: new Date(2026, 8, 14, 12).toISOString() }));
    const august = { id: "august", date: new Date(2026, 7, 20, 12).toISOString() };
    const july = { id: "july", date: new Date(2026, 6, 20, 12).toISOString() };
    const result = splitByMonth([...current, july, august], item => item.date);
    expect(result.current).toEqual(current);
    expect([...result.byMonth.keys()]).toEqual(["2026-08", "2026-07"]);
    expect(result.byMonth.get("2026-08")).toEqual([august]);
    expect(monthLabel("2026-08")).toBe("August 2026");
  });

  it("moves last month's entries into a folder across a year boundary without losing them", () => {
    vi.useFakeTimers();
    const item = { date: new Date(2026, 11, 31, 12).toISOString() };
    vi.setSystemTime(new Date(2026, 11, 31, 23));
    expect(splitByMonth([item], x => x.date).current).toEqual([item]);
    vi.setSystemTime(new Date(2027, 0, 1, 1));
    const result = splitByMonth([item], x => x.date);
    expect(result.current).toEqual([]);
    expect(result.byMonth.get("2026-12")).toEqual([item]);
  });

  it("handles an empty activity history", () => {
    const result = splitByMonth([], () => "");
    expect(result.current).toEqual([]);
    expect(result.byMonth.size).toBe(0);
  });
});