import { describe, expect, it } from "vitest";

import { getCountries } from "../app/_lib/countries.js";

describe("country options", () => {
  it("builds the complete ISO alpha-2 list without a runtime API request", () => {
    const countries = getCountries();

    expect(countries).toHaveLength(249);
    expect(new Set(countries.map((country) => country.code)).size).toBe(249);
    expect(countries).toContainEqual({
      code: "US",
      name: "United States",
      flag: "https://flagcdn.com/us.svg",
    });
    expect(countries).toContainEqual({
      code: "CN",
      name: "China",
      flag: "https://flagcdn.com/cn.svg",
    });
  });

  it("returns stable sorted options with derived HTTPS flag URLs", () => {
    const countries = getCountries();
    const names = countries.map((country) => country.name);

    expect(names).toEqual(
      [...names].sort((left, right) => left.localeCompare(right, "en"))
    );
    expect(
      countries.every((country) =>
        new RegExp(
          `^https://flagcdn\\.com/${country.code.toLowerCase()}\\.svg$`
        ).test(country.flag)
      )
    ).toBe(true);
    expect(getCountries()).toBe(countries);
  });
});
