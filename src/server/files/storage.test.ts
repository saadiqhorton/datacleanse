import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ID_PATTERN } from "./storage";

describe("storage ids", () => {
  it("accepts app ids and Better Auth user ids", () => {
    for (const id of ["file_3k9x2m7q1p0z", "usr_abc", "Xq7LmT2vN9pR4sK8wB1cD6eF0gH3jJ5k"]) {
      assert.ok(ID_PATTERN.test(id), id);
    }
  });

  it("rejects anything that could leave its directory", () => {
    for (const id of ["../etc", "a/b", "a.b", "", "a\\b", "file_1 2"]) assert.equal(ID_PATTERN.test(id), false, id);
  });
});
