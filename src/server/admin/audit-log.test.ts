import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnv, insertTestUser } from "../testing";
import { audit } from "../audit";
import { listAuditEntries } from "./audit-log";

const ADMIN = "user_admin";
const MARIA = "user_maria";

beforeEach(() => {
  const { db: conn } = setupTestEnv();
  insertTestUser(conn, ADMIN, "admin@northwind.co", "admin");
  insertTestUser(conn, MARIA, "maria@northwind.co");
  audit("auth.signed_in", "Signed in with password.", { actor: MARIA });
  audit("auth.sign_in_failed", "Failed password sign-in for ghost@example.com.");
  audit("admin.user_disabled", "Disabled maria. Their sessions were signed out.", { actor: ADMIN });
  audit("file.uploaded", "100% of rows were clean", { actor: MARIA });
  audit("file.uploaded", "100 rows were checked", { actor: MARIA });
  audit("authz.denied", "Not allowed");
});

describe("audit log", () => {
  it("lists everything newest first with the actor's email, or null for system entries", () => {
    const page = listAuditEntries();
    assert.equal(page.total, 6);
    assert.equal(page.items[0].action, "authz.denied");
    const failed = page.items.find((e) => e.action === "auth.sign_in_failed")!;
    assert.equal(failed.actorEmail, null);
    assert.equal(page.items.find((e) => e.action === "admin.user_disabled")!.actorEmail, "admin@northwind.co");
  });

  it("searches action, detail and actor email, case-insensitively", () => {
    assert.equal(listAuditEntries({ query: "MARIA@" }).total, 3, "signed in, two uploads");
    assert.equal(listAuditEntries({ query: "disabled" }).total, 1);
    assert.equal(listAuditEntries({ query: "sign_in" }).total, 1, "underscore in action text matches literally");
  });

  it("matches LIKE wildcards in search text literally", () => {
    assert.deepEqual(
      listAuditEntries({ query: "100%" }).items.map((e) => e.detail),
      ["100% of rows were clean"],
    );
    assert.equal(listAuditEntries({ query: "100" }).total, 2);
    assert.equal(listAuditEntries({ query: "%" }).total, 1);
  });

  it("filters by action prefix", () => {
    assert.deepEqual(
      listAuditEntries({ prefix: "auth." }).items.map((e) => e.action),
      ["auth.sign_in_failed", "auth.signed_in"],
    );
    assert.equal(listAuditEntries({ prefix: "admin." }).total, 1);
  });

  it("pages and combines search with the prefix", () => {
    const paged = listAuditEntries({ pageSize: 4 });
    assert.equal(paged.pageCount, 2);
    assert.equal(listAuditEntries({ pageSize: 4, page: 2 }).items.length, 2);
    assert.equal(listAuditEntries({ query: "maria", prefix: "file." }).total, 2);
  });
});
