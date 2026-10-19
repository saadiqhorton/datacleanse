import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseDate, detectColumnOrder, toIsoDate, dateLayoutOf } from "./dates";

describe("parseDate: ISO forms", () => {
  test("YYYY-MM-DD", () => {
    assert.deepEqual(parseDate("2022-03-04"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "YYYY-MM-DD",
      ambiguous: false,
    });
  });

  test("YYYY/MM/DD and YYYY.MM.DD keep their separator in the layout", () => {
    assert.deepEqual(parseDate("2022/03/04"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "YYYY/MM/DD",
      ambiguous: false,
    });
    assert.deepEqual(parseDate("2022.03.04"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "YYYY.MM.DD",
      ambiguous: false,
    });
  });

  test("single-digit ISO month and day are accepted", () => {
    assert.deepEqual(parseDate("2022-3-4")?.parts, { y: 2022, m: 3, d: 4 });
  });

  test("ISO datetime with Z suffix labels the time part", () => {
    assert.deepEqual(parseDate("2022-03-04T10:00:00Z"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "YYYY-MM-DDThh:mm",
      ambiguous: false,
    });
  });

  test("ISO datetime with offset and fractional seconds", () => {
    const r = parseDate("2022-03-04T10:00:00.123+02:00");
    assert.deepEqual(r?.parts, { y: 2022, m: 3, d: 4 });
    assert.equal(r?.layout, "YYYY-MM-DDThh:mm");
  });

  test("space-separated datetime", () => {
    assert.deepEqual(parseDate("2022-03-04 10:00"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "YYYY-MM-DD hh:mm",
      ambiguous: false,
    });
  });

  test("ISO dates are never ambiguous, even when both parts are <= 12", () => {
    assert.equal(parseDate("2022-03-04", "dmy")?.ambiguous, false);
    assert.equal(parseDate("2022-03-04")?.ambiguous, false);
  });
});

describe("parseDate: calendar validity", () => {
  test("2024-02-29 is valid (leap year)", () => {
    assert.deepEqual(parseDate("2024-02-29")?.parts, { y: 2024, m: 2, d: 29 });
  });

  test("2023-02-29 is rejected", () => {
    assert.equal(parseDate("2023-02-29"), null);
  });

  test("century rule: 1900 is not a leap year, 2000 is", () => {
    assert.equal(parseDate("1900-02-29"), null);
    assert.deepEqual(parseDate("2000-02-29")?.parts, { y: 2000, m: 2, d: 29 });
  });

  test("impossible days and months are rejected", () => {
    assert.equal(parseDate("2022-02-30"), null);
    assert.equal(parseDate("2022-04-31"), null);
    assert.equal(parseDate("2022-13-01"), null);
    assert.equal(parseDate("2022-00-10"), null);
    assert.equal(parseDate("2022-01-00"), null);
  });

  test("invalid time components are rejected", () => {
    assert.equal(parseDate("2022-03-04T25:00"), null);
    assert.equal(parseDate("2022-03-04 10:61"), null);
  });
});

describe("parseDate: numeric D/M/Y", () => {
  test("explicit mdy reads first part as month and flags ambiguity", () => {
    assert.deepEqual(parseDate("03/04/2022", "mdy"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "MM/DD/YYYY",
      ambiguous: true,
    });
  });

  test("explicit dmy reads first part as day", () => {
    assert.deepEqual(parseDate("03/04/2022", "dmy"), {
      parts: { y: 2022, m: 4, d: 3 },
      layout: "DD/MM/YYYY",
      ambiguous: true,
    });
  });

  test("auto reads an ambiguous date as mdy and flags it", () => {
    assert.deepEqual(parseDate("03/04/2022"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "MM/DD/YYYY",
      ambiguous: true,
    });
  });

  test("equal parts are not ambiguous", () => {
    assert.equal(parseDate("05/05/2022")?.ambiguous, false);
  });

  test("auto resolves an unambiguous dmy date (day above 12)", () => {
    assert.deepEqual(parseDate("13/02/2022"), {
      parts: { y: 2022, m: 2, d: 13 },
      layout: "DD/MM/YYYY",
      ambiguous: false,
    });
  });

  test("auto resolves an unambiguous mdy date (day above 12 in second place)", () => {
    assert.deepEqual(parseDate("02/13/2022"), {
      parts: { y: 2022, m: 2, d: 13 },
      layout: "MM/DD/YYYY",
      ambiguous: false,
    });
  });

  test("explicit order rejects a date that needs the other order", () => {
    assert.equal(parseDate("13/02/2022", "mdy"), null);
    assert.equal(parseDate("02/13/2022", "dmy"), null);
  });

  test("impossible numeric dates are rejected under every order", () => {
    assert.equal(parseDate("13/13/2022"), null);
    assert.equal(parseDate("02/30/2022"), null);
    assert.equal(parseDate("30/02/2022", "dmy"), null);
    assert.equal(parseDate("29/02/2023"), null);
    assert.deepEqual(parseDate("29/02/2024")?.parts, { y: 2024, m: 2, d: 29 });
  });

  test("dash and dot separators, 1 or 2 digit day and month", () => {
    assert.deepEqual(parseDate("4-3-2022", "dmy")?.parts, { y: 2022, m: 3, d: 4 });
    assert.deepEqual(parseDate("4.3.2022", "dmy")?.parts, { y: 2022, m: 3, d: 4 });
    assert.equal(parseDate("4.3.2022", "dmy")?.layout, "DD.MM.YYYY");
  });

  test("mixed separators are rejected", () => {
    assert.equal(parseDate("03/04-2022"), null);
    assert.equal(parseDate("2022-03/04"), null);
  });

  test("2-digit year pivot: 00-69 -> 20xx, 70-99 -> 19xx", () => {
    assert.equal(parseDate("01/02/00", "mdy")?.parts.y, 2000);
    assert.equal(parseDate("01/02/69", "mdy")?.parts.y, 2069);
    assert.equal(parseDate("01/02/70", "mdy")?.parts.y, 1970);
    assert.equal(parseDate("01/02/99", "mdy")?.parts.y, 1999);
    assert.equal(parseDate("01/02/22", "mdy")?.layout, "MM/DD/YY");
  });
});

describe("parseDate: English month names", () => {
  test("D Mon YYYY", () => {
    assert.deepEqual(parseDate("4 Mar 2022"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "D Mon YYYY",
      ambiguous: false,
    });
  });

  test("dash separated day-first with 2-digit day", () => {
    assert.deepEqual(parseDate("04-Mar-2022")?.parts, { y: 2022, m: 3, d: 4 });
  });

  test("long month name, day first", () => {
    assert.deepEqual(parseDate("4 March 2022")?.parts, { y: 2022, m: 3, d: 4 });
  });

  test("Mon D, YYYY and Mon D YYYY", () => {
    assert.deepEqual(parseDate("Mar 4, 2022"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "Mon D, YYYY",
      ambiguous: false,
    });
    assert.deepEqual(parseDate("March 4 2022")?.parts, { y: 2022, m: 3, d: 4 });
  });

  test("2-digit year in named form uses the pivot", () => {
    assert.deepEqual(parseDate("Mar 4 22"), {
      parts: { y: 2022, m: 3, d: 4 },
      layout: "Mon D, YY",
      ambiguous: false,
    });
    assert.equal(parseDate("Mar 4 99")?.parts.y, 1999);
  });

  test("case-insensitive and 'Sept' accepted", () => {
    assert.deepEqual(parseDate("MAR 4, 2022")?.parts, { y: 2022, m: 3, d: 4 });
    assert.deepEqual(parseDate("mArCh 4 2022")?.parts, { y: 2022, m: 3, d: 4 });
    assert.deepEqual(parseDate("Sept 4 2022")?.parts, { y: 2022, m: 9, d: 4 });
  });

  test("invalid month names and impossible named dates are rejected", () => {
    assert.equal(parseDate("4 Foo 2022"), null);
    assert.equal(parseDate("31 Feb 2022"), null);
    assert.equal(parseDate("Mayday 4 2022"), null);
    assert.deepEqual(parseDate("29 Feb 2024")?.parts, { y: 2024, m: 2, d: 29 });
    assert.equal(parseDate("29 Feb 2023"), null);
  });
});

describe("parseDate: rejection and input handling", () => {
  test("trims surrounding whitespace", () => {
    assert.deepEqual(parseDate("  2022-03-04  ")?.parts, { y: 2022, m: 3, d: 4 });
  });

  test("plain integers, empty strings and free text are rejected", () => {
    assert.equal(parseDate(""), null);
    assert.equal(parseDate("   "), null);
    assert.equal(parseDate("20220304"), null);
    assert.equal(parseDate("1234"), null);
    assert.equal(parseDate("hello world"), null);
    assert.equal(parseDate("2022-03-04x"), null);
  });

  test("non-string input is rejected instead of throwing", () => {
    assert.equal(parseDate(null as unknown as string), null);
    assert.equal(parseDate(undefined as unknown as string), null);
  });
});

describe("detectColumnOrder", () => {
  test("day above 12 in first position -> dmy with full confidence", () => {
    const r = detectColumnOrder(["13/02/2022", "25/12/2021", "01/03/2020"]);
    assert.equal(r.order, "dmy");
    assert.equal(r.confidence, 1);
    assert.equal(r.evidence, "2 dates have a day above 12 in the first position");
  });

  test("day above 12 in second position -> mdy with full confidence", () => {
    const r = detectColumnOrder(["02/13/2022", "12/25/2021", "03/01/2020"]);
    assert.equal(r.order, "mdy");
    assert.equal(r.confidence, 1);
    assert.equal(r.evidence, "2 dates have a day above 12 in the second position");
  });

  test("no unambiguous dates -> mdy at 0.5", () => {
    const r = detectColumnOrder(["03/04/2022", "05/06/2022"]);
    assert.deepEqual(r, { order: "mdy", confidence: 0.5, evidence: "No unambiguous dates; assumed month/day" });
  });

  test("empty column -> same fallback", () => {
    assert.equal(detectColumnOrder([]).order, "mdy");
    assert.equal(detectColumnOrder([]).confidence, 0.5);
  });

  test("mixed evidence -> majority with lower confidence", () => {
    const values = [
      "13/01/2020", "14/01/2020", "15/01/2020", "16/01/2020", "17/01/2020",
      "18/01/2020", "19/01/2020", "20/01/2020", "21/01/2020",
      "01/13/2020",
    ];
    const r = detectColumnOrder(values);
    assert.equal(r.order, "dmy");
    assert.equal(r.confidence, 0.9);
    assert.equal(r.evidence, "9 dates read day-first, 1 date read month-first");
  });

  test("exact tie -> mdy at 0.5 with both sides reported", () => {
    const r = detectColumnOrder(["13/01/2020", "01/13/2020"]);
    assert.equal(r.order, "mdy");
    assert.equal(r.confidence, 0.5);
    assert.equal(r.evidence, "1 date read day-first, 1 date read month-first");
  });

  test("non-date, empty, ISO and named values are ignored", () => {
    const r = detectColumnOrder(["hello", "", "2022-03-04", "4 Mar 2022", "13/02/2022"]);
    assert.equal(r.order, "dmy");
    assert.equal(r.confidence, 1);
  });

  test("impossible numeric values do not count as evidence", () => {
    assert.equal(detectColumnOrder(["13/13/2022", "31/02/2022"]).evidence, "No unambiguous dates; assumed month/day");
  });
});

describe("toIsoDate", () => {
  test("formats YYYY-MM-DD with zero padding", () => {
    assert.equal(toIsoDate({ y: 2022, m: 3, d: 4 }), "2022-03-04");
    assert.equal(toIsoDate({ y: 999, m: 1, d: 9 }), "0999-01-09");
  });
});

describe("dateLayoutOf", () => {
  test("order-free numeric signatures", () => {
    assert.equal(dateLayoutOf("13/02/2022"), "NN/NN/YYYY");
    assert.equal(dateLayoutOf("03/04/22"), "NN/NN/YY");
    assert.equal(dateLayoutOf("4-3-2022"), "NN-NN-YYYY");
  });

  test("ISO, named and datetime signatures", () => {
    assert.equal(dateLayoutOf("2022-03-04"), "YYYY-MM-DD");
    assert.equal(dateLayoutOf("2022/03/04"), "YYYY/MM/DD");
    assert.equal(dateLayoutOf("4 Mar 2022"), "D Mon YYYY");
    assert.equal(dateLayoutOf("Mar 4, 2022"), "Mon D, YYYY");
    assert.equal(dateLayoutOf("2022-03-04T10:00:00Z"), "YYYY-MM-DDThh:mm");
  });

  test("null for non-dates and impossible dates", () => {
    assert.equal(dateLayoutOf("hello"), null);
    assert.equal(dateLayoutOf("20220304"), null);
    assert.equal(dateLayoutOf("2022-02-30"), null);
    assert.equal(dateLayoutOf(""), null);
  });
});
