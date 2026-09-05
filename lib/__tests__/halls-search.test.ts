// Regression tests for the free-text search filter.
//
// THE BUG THESE PIN. lib/halls.ts used to interpolate the raw search term into
// a PostgREST or-group: `name.ilike.%${t}%,city.ilike.%${t}%,...`. A comma in
// the term split that group into extra members and a parenthesis opened a
// nested one, so the request failed with PGRST100, fetchHalls swallowed the
// error and returned [], and /halls told the visitor "No halls found" for the
// entirely ordinary search "Sri Krishna, Madurai".
//
// The fix is the double quoting PostgREST documents for reserved characters.
// If someone "simplifies" the quotes away, these tests go red.

import { describe, expect, it } from "vitest";
import { buildFreeTextOrFilter } from "@/lib/halls";

describe("buildFreeTextOrFilter", () => {
  it("searches name, city and address by default", () => {
    expect(buildFreeTextOrFilter("Grand")).toBe(
      'name.ilike."%Grand%",city.ilike."%Grand%",address.ilike."%Grand%"',
    );
  });

  it("keeps a comma inside the value instead of splitting the or-group", () => {
    const filter = buildFreeTextOrFilter("Sri Krishna, Madurai", ["name"]);
    expect(filter).toBe('name.ilike."%Sri Krishna, Madurai%"');
    // One member, not two — the whole point.
    expect(filter.split('",').length).toBe(1);
  });

  it("keeps parentheses inside the value", () => {
    expect(buildFreeTextOrFilter("Grand Hall (AC)", ["name"])).toBe(
      'name.ilike."%Grand Hall (AC)%"',
    );
  });

  it("escapes a backslash before a double quote, not after", () => {
    // Escaping in the other order would turn \" into \\" and unbalance the value.
    expect(buildFreeTextOrFilter('a\\b"c', ["name"])).toBe(
      'name.ilike."%a\\\\b\\"c%"',
    );
  });

  it("escapes a bare double quote so the value stays closed", () => {
    const filter = buildFreeTextOrFilter('The "Palace"', ["name"]);
    expect(filter).toBe('name.ilike."%The \\"Palace\\"%"');
    // Every quote is either the pair delimiting the value, or backslash-escaped.
    expect(filter.match(/(?<!\\)"/g)).toHaveLength(2);
  });

  it("does not mangle a plain multi-word term", () => {
    expect(buildFreeTextOrFilter("wedding hall", ["city"])).toBe(
      'city.ilike."%wedding hall%"',
    );
  });
});
