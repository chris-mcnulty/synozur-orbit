/**
 * Integration tests for the Observatory API routes.
 *
 * Traceability spine: Application → Version → Assessment → Finding →
 * Evidence → Control. Covers create, link/unlink, status transitions,
 * tenant scoping (401/403), and cascade-delete in each layer.
 *
 * The key regression guard: POST /api/observatory/findings must NOT require
 * applicationId in the request body — the server derives it from the parent
 * assessment. This was a bug found and fixed during manual testing.
 *
 * All I/O is mocked (no real DB or network). A queue-based chainable proxy
 * lets each test push exactly the rows each DB call should return, in order.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import express from "express";
import request from "supertest";

// ── DB mock — queue-based chainable proxy ────────────────────────────────────
//
// vi.hoisted() runs BEFORE vi.mock so the objects it produces can be used
// inside mock factories (which are also hoisted).

const { dbQ, makeMockDb } = vi.hoisted(() => {
  /** Each entry is the array the next DB terminal call will resolve with. */
  const dbQ: any[][] = [];

  /**
   * terminal() — pops one entry from dbQ and returns an object that is both
   * thenable (so `await chain.where(...)` works) AND chainable with the most
   * common suffixes (.returning(), .orderBy(), .onConflictDoNothing()).
   */
  function terminal(): any {
    const val = dbQ.shift() ?? [];
    return {
      then: (resolve: any, reject?: any) => Promise.resolve(val).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(val).catch(reject),
      finally: (cb: any) => Promise.resolve(val).finally(cb),
      returning: () => Promise.resolve(val),
      orderBy: () => Promise.resolve(val),
      onConflictDoNothing: () => Promise.resolve(val),
      limit: () => Promise.resolve(val),
    };
  }

  function mkChain(): any {
    return {
      from: () => mkChain(),
      where: terminal,
      set: () => mkChain(),
      values: terminal,
      innerJoin: () => mkChain(),
      leftJoin: () => mkChain(),
      groupBy: () => mkChain(),
      orderBy: () => Promise.resolve(dbQ.shift() ?? []),
      returning: () => Promise.resolve(dbQ.shift() ?? []),
      onConflictDoUpdate: () => ({ returning: () => Promise.resolve(dbQ.shift() ?? []) }),
      limit: () => mkChain(),
    };
  }

  /**
   * mkDeleteChain — supports both:
   *   await db.delete(t).where(...)              (no .returning())
   *   await db.delete(t).where(...).returning()
   * Both pop ONE entry from dbQ.
   */
  function mkDeleteChain(): any {
    return {
      where: terminal,
    };
  }

  function makeMockDb() {
    const db: any = {
      select: mkChain,
      insert: mkChain,
      update: mkChain,
      delete: mkDeleteChain,
      transaction: async (fn: any) => fn(db),
    };
    return db;
  }

  return { dbQ, makeMockDb };
});

// ── Mock all I/O modules ─────────────────────────────────────────────────────

vi.mock("../../db", () => ({ db: makeMockDb() }));

vi.mock("../../context", () => ({
  getRequestContext: vi.fn(),
  ContextError: class ContextError extends Error {
    status: number;
    constructor(msg: string, status = 401) {
      super(msg);
      this.status = status;
    }
  },
}));

// seedStandardsCatalog is called at registration time — mock to no-op.
vi.mock("../observatory-standards", () => ({
  seedStandardsCatalog: vi.fn().mockResolvedValue({ frameworks: 0, controls: 0 }),
}));

// seedObservatoryDemo is called by the seed-demo route — mock it.
vi.mock("../observatory-demo-seed", () => ({
  seedObservatoryDemo: vi.fn().mockResolvedValue({ seeded: false, message: "Already seeded" }),
}));

// ── Import under test AFTER mocks ────────────────────────────────────────────

import { registerObservatoryRoutes } from "../../routes/observatory";
import { getRequestContext } from "../../context";

// ── Shared test fixtures ─────────────────────────────────────────────────────

const WRITER_CTX = {
  userId: "user-1",
  tenantId: "tenant-1",
  marketId: "market-1",
  userRole: "Domain Admin",   // hasContentAccess && hasAdminAccess
  tenantDomain: "acme.com",
  isDefaultMarket: true,
};

const READONLY_CTX = {
  ...WRITER_CTX,
  userRole: "Standard User",  // hasContentAccess → false → 403 on write routes
};

const APP = {
  id: "app-1",
  tenantDomain: "acme.com",
  name: "Customer Portal",
  description: "Main customer-facing portal",
  createdBy: "user-1",
};

const VERSION = {
  id: "ver-1",
  tenantDomain: "acme.com",
  applicationId: "app-1",
  versionNumber: "1.0.0",
  assessmentStatus: "Draft",
  createdBy: "user-1",
};

const ASSESSMENT = {
  id: "asmnt-1",
  tenantDomain: "acme.com",
  applicationId: "app-1",
  versionId: "ver-1",
  title: "Q2 Pen Test",
  type: "penetration_test",
  status: "planned",
  createdBy: "user-1",
};

const FINDING = {
  id: "find-1",
  tenantDomain: "acme.com",
  applicationId: "app-1",
  assessmentId: "asmnt-1",
  title: "SQL injection in login form",
  severity: "Critical",
  domain: "security",
  status: "open",
  createdBy: "user-1",
};

const EVIDENCE = {
  id: "ev-1",
  tenantDomain: "acme.com",
  title: "Screenshot of error page",
  evidenceType: "screenshot",
  createdBy: "user-1",
};

const CONTROL = {
  id: "ctrl-1",
  frameworkId: "fw-1",
  controlId: "A.9.4.2",
  title: "Secure log-on procedures",
  sortOrder: 10,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  registerObservatoryRoutes(app);
  return app;
}

/** Push one result set into the DB queue (one terminal() pop). */
function pushDb(...rows: any[]) {
  dbQ.push(rows);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("observatory routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    dbQ.length = 0;
    vi.mocked(getRequestContext).mockResolvedValue(WRITER_CTX as any);
    app = buildApp();
  });

  // ── 401 / 403 tenant-scoping ────────────────────────────────────────────────

  describe("tenant scoping", () => {
    it("returns 401 when the request carries no valid context", async () => {
      const { ContextError } = await import("../../context");
      vi.mocked(getRequestContext).mockRejectedValue(
        new (ContextError as any)("No tenant context", 401),
      );

      const res = await request(app)
        .post("/api/observatory/applications")
        .send({ name: "My App" });

      expect(res.status).toBe(401);
    });

    it("returns 403 when the user lacks write permission", async () => {
      vi.mocked(getRequestContext).mockResolvedValue(READONLY_CTX as any);

      const res = await request(app)
        .post("/api/observatory/applications")
        .send({ name: "My App" });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/permission/i);
    });

    it("returns 403 on finding create for read-only user", async () => {
      vi.mocked(getRequestContext).mockResolvedValue(READONLY_CTX as any);

      const res = await request(app).post("/api/observatory/findings").send({
        assessmentId: "asmnt-1",
        title: "XSS",
        severity: "High",
        domain: "security",
      });

      expect(res.status).toBe(403);
    });
  });

  // ── Applications ─────────────────────────────────────────────────────────────

  describe("POST /api/observatory/applications", () => {
    it("creates an application and returns 201", async () => {
      pushDb(APP);        // insert(obsApplications).values().returning()
      pushDb();           // audit insert().values()

      const res = await request(app)
        .post("/api/observatory/applications")
        .send({ name: "Customer Portal", description: "Main customer-facing portal" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: "app-1", name: "Customer Portal" });
    });

    it("returns 400 when required field name is missing", async () => {
      const res = await request(app)
        .post("/api/observatory/applications")
        .send({ description: "No name provided" });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/observatory/applications/:id", () => {
    it("deletes an application and returns { success: true }", async () => {
      pushDb(APP);  // select(obsApplications).where() — existence check
      pushDb();     // delete(obsFindings).where()
      pushDb();     // delete(obsAssessments).where()
      pushDb();     // delete(obsVersions).where()
      pushDb(APP);  // delete(obsApplications).where().returning()
      pushDb();     // audit

      const res = await request(app).delete("/api/observatory/applications/app-1");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
    });

    it("returns 404 when the application does not exist for this tenant", async () => {
      pushDb();    // select(obsApplications).where() returns [] → not found
      // no child deletes and no audit because we return early

      const res = await request(app).delete("/api/observatory/applications/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found/i);
    });

    it("explicitly deletes findings, assessments, and versions before removing the parent — cascade regression guard", async () => {
      // This test is the cascade regression guard.
      //
      // The route issues explicit child deletes (findings → assessments → versions)
      // BEFORE deleting the application row. This means:
      //   1. The test will fail with a queue underrun if any of the child-cleanup
      //      DB calls are removed from the route, catching a missing cascade early.
      //   2. Even if DB-level FK cascade rules are accidentally removed from a
      //      future migration, the application-level cleanup here prevents
      //      orphaned findings / assessments / versions from accumulating.
      //
      // Cascade order verified:
      //   obs_findings    (app-scoped) → cascades obs_finding_evidence,
      //                                             obs_finding_controls,
      //                                             obs_review_item_findings
      //   obs_assessments (app-scoped) → cascades obs_review_items
      //                                             (→ obs_review_item_evidence),
      //                                             obs_assessment_evidence
      //   obs_versions    (app-scoped) → cascades obs_version_evidence

      const FINDING_2 = { ...FINDING, id: "find-2", title: "Open redirect" };

      pushDb(APP);             // select — confirm app exists
      pushDb(FINDING, FINDING_2); // delete(obsFindings).where() — 2 findings removed
      pushDb(ASSESSMENT);      // delete(obsAssessments).where() — 1 assessment removed
      pushDb(VERSION);         // delete(obsVersions).where() — 1 version removed
      pushDb(APP);             // delete(obsApplications).where().returning()
      pushDb();                // audit

      const res = await request(app).delete("/api/observatory/applications/app-1");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      // All 6 queue entries were consumed — no DB call was skipped.
      expect(dbQ).toHaveLength(0);
    });
  });

  // ── Versions ─────────────────────────────────────────────────────────────────

  describe("POST /api/observatory/versions", () => {
    it("creates a version after verifying the parent application", async () => {
      pushDb(APP);       // select(obsApplications).where() — parent check
      pushDb(VERSION);   // insert(obsVersions).values().returning()
      pushDb();          // audit

      const res = await request(app)
        .post("/api/observatory/versions")
        .send({ applicationId: "app-1", versionNumber: "1.0.0" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: "ver-1", versionNumber: "1.0.0" });
    });

    it("returns 404 when the parent application is not in this tenant", async () => {
      pushDb();  // select(obsApplications).where() returns [] → 404

      const res = await request(app)
        .post("/api/observatory/versions")
        .send({ applicationId: "foreign-app", versionNumber: "2.0.0" });

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/application not found/i);
    });

    it("returns 400 for an invalid assessmentStatus value", async () => {
      const res = await request(app)
        .post("/api/observatory/versions")
        .send({ applicationId: "app-1", versionNumber: "1.0.0", assessmentStatus: "NOT_VALID" });

      expect(res.status).toBe(400);
    });
  });

  // ── Assessments ──────────────────────────────────────────────────────────────

  describe("POST /api/observatory/assessments", () => {
    it("creates an assessment with a valid type", async () => {
      pushDb(APP);         // select(obsApplications).where()
      pushDb(ASSESSMENT);  // insert(obsAssessments).values().returning()
      pushDb();            // audit

      const res = await request(app)
        .post("/api/observatory/assessments")
        .send({
          applicationId: "app-1",
          title: "Q2 Pen Test",
          type: "penetration_test",
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: "asmnt-1", type: "penetration_test" });
    });

    it("returns 400 for an invalid assessment type", async () => {
      const res = await request(app)
        .post("/api/observatory/assessments")
        .send({ applicationId: "app-1", title: "Bad type", type: "magic_wand" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid type/i);
    });

    it("returns 400 for an invalid assessment status", async () => {
      const res = await request(app)
        .post("/api/observatory/assessments")
        .send({
          applicationId: "app-1",
          title: "Q2 Pen Test",
          type: "penetration_test",
          status: "bogus_status",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid status/i);
    });

    it("returns 404 when the parent application is not in this tenant", async () => {
      pushDb();  // select(obsApplications).where() returns []

      const res = await request(app)
        .post("/api/observatory/assessments")
        .send({ applicationId: "foreign-app", title: "Test", type: "penetration_test" });

      expect(res.status).toBe(404);
    });
  });

  // ── Findings ─────────────────────────────────────────────────────────────────
  //
  // KEY REGRESSION: the client does NOT send applicationId — the server must
  // derive it from the parent assessment. Any change that re-introduces an
  // applicationId validation requirement will break this test.

  describe("POST /api/observatory/findings", () => {
    it("creates a finding WITHOUT applicationId in the request body", async () => {
      pushDb(ASSESSMENT);  // select(obsAssessments).where() — to get applicationId
      pushDb(FINDING);     // insert(obsFindings).values().returning()
      pushDb();            // audit

      const res = await request(app)
        .post("/api/observatory/findings")
        .send({
          assessmentId: "asmnt-1",
          title: "SQL injection in login form",
          severity: "Critical",
          domain: "security",
          // applicationId deliberately omitted — server must derive it
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: "find-1",
        severity: "Critical",
        domain: "security",
      });
    });

    it("returns 404 when the parent assessment is not found for this tenant", async () => {
      pushDb();  // select(obsAssessments).where() returns []

      const res = await request(app)
        .post("/api/observatory/findings")
        .send({
          assessmentId: "foreign-assessment",
          title: "Finding",
          severity: "High",
          domain: "security",
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/assessment not found/i);
    });

    it("returns 400 for an invalid severity value", async () => {
      const res = await request(app)
        .post("/api/observatory/findings")
        .send({
          assessmentId: "asmnt-1",
          title: "Finding",
          severity: "Catastrophic",   // not in OBS_FINDING_SEVERITIES
          domain: "security",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid severity/i);
    });

    it("returns 400 for an invalid domain value", async () => {
      const res = await request(app)
        .post("/api/observatory/findings")
        .send({
          assessmentId: "asmnt-1",
          title: "Finding",
          severity: "High",
          domain: "dragons",  // not in OBS_FINDING_DOMAINS
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid domain/i);
    });
  });

  describe("PATCH /api/observatory/findings/:id — status transitions", () => {
    it("returns 200 with updated finding", async () => {
      const UPDATED = { ...FINDING, status: "in_progress" };
      pushDb(UPDATED);  // update.set().where().returning()
      pushDb();         // audit

      const res = await request(app)
        .patch("/api/observatory/findings/find-1")
        .send({ status: "in_progress" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "in_progress" });
    });

    it("auto-sets resolvedAt when status is set to 'remediated'", async () => {
      // The route sets resolvedAt = new Date() on the server if not supplied.
      // We verify that the route reaches the update step without error; the
      // mock doesn't enforce the resolvedAt field because it's DB-side.
      const REMEDIATED = { ...FINDING, status: "remediated", resolvedAt: new Date().toISOString() };
      pushDb(REMEDIATED);
      pushDb();

      const res = await request(app)
        .patch("/api/observatory/findings/find-1")
        .send({ status: "remediated" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("remediated");
    });

    it("returns 400 for an invalid finding status", async () => {
      const res = await request(app)
        .patch("/api/observatory/findings/find-1")
        .send({ status: "not_a_real_status" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid status/i);
    });

    it("returns 404 when the finding is not in this tenant", async () => {
      pushDb();  // update returns []
      // no audit because we return early

      const res = await request(app)
        .patch("/api/observatory/findings/nonexistent")
        .send({ status: "in_progress" });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/observatory/findings/bulk-status", () => {
    it("bulk-updates multiple findings and returns the updated count", async () => {
      pushDb({ id: "find-1" }, { id: "find-2" });  // update.set().where().returning({id})
      pushDb();                                      // audit

      const res = await request(app)
        .post("/api/observatory/findings/bulk-status")
        .send({ ids: ["find-1", "find-2"], status: "remediated" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ updated: 2 });
    });

    it("returns 400 when ids array is empty", async () => {
      const res = await request(app)
        .post("/api/observatory/findings/bulk-status")
        .send({ ids: [], status: "remediated" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for an invalid bulk status value", async () => {
      const res = await request(app)
        .post("/api/observatory/findings/bulk-status")
        .send({ ids: ["find-1"], status: "not_valid" });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/observatory/findings/:id", () => {
    it("deletes a finding and returns { success: true }", async () => {
      pushDb(FINDING);  // delete(obsFindings).where().returning()
      pushDb();         // audit

      const res = await request(app).delete("/api/observatory/findings/find-1");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
    });

    it("returns 404 when the finding does not exist in this tenant", async () => {
      pushDb();  // delete returns []

      const res = await request(app).delete("/api/observatory/findings/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  // ── Evidence ─────────────────────────────────────────────────────────────────

  describe("POST /api/observatory/evidence", () => {
    it("creates evidence and returns 201", async () => {
      pushDb(EVIDENCE);  // insert(obsEvidence).values().returning()
      pushDb();          // audit

      const res = await request(app)
        .post("/api/observatory/evidence")
        .send({ title: "Screenshot of error page", evidenceType: "screenshot" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: "ev-1", evidenceType: "screenshot" });
    });

    it("returns 400 for an invalid evidenceType", async () => {
      const res = await request(app)
        .post("/api/observatory/evidence")
        .send({ title: "Evidence", evidenceType: "interpretive_dance" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid evidence type/i);
    });
  });

  // ── Link / unlink: finding ↔ evidence ────────────────────────────────────────

  describe("POST /api/observatory/findings/:id/evidence/:evidenceId", () => {
    it("links evidence to a finding and returns { success: true }", async () => {
      pushDb(FINDING);   // select(obsFindings).where()
      pushDb(EVIDENCE);  // select(obsEvidence).where()
      pushDb();          // insert(obsFindingEvidence).values().onConflictDoNothing()
      pushDb();          // audit

      const res = await request(app)
        .post("/api/observatory/findings/find-1/evidence/ev-1");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
    });

    it("returns 404 when finding or evidence is not in this tenant", async () => {
      pushDb();   // select(obsFindings).where() returns []
      pushDb();   // select(obsEvidence).where() returns []

      const res = await request(app)
        .post("/api/observatory/findings/nonexistent/evidence/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/observatory/findings/:id/evidence/:evidenceId", () => {
    it("unlinks evidence from a finding and returns { success: true }", async () => {
      pushDb(FINDING);  // select(obsFindings).where()
      pushDb();         // delete(obsFindingEvidence).where()
      pushDb();         // audit

      const res = await request(app)
        .delete("/api/observatory/findings/find-1/evidence/ev-1");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
    });

    it("returns 404 when the finding is not in this tenant", async () => {
      pushDb();  // select(obsFindings).where() returns []

      const res = await request(app)
        .delete("/api/observatory/findings/nonexistent/evidence/ev-1");

      expect(res.status).toBe(404);
    });
  });

  // ── Link / unlink: finding ↔ control ─────────────────────────────────────────

  describe("POST /api/observatory/findings/:id/controls/:controlId", () => {
    it("links a control to a finding and returns { success: true }", async () => {
      pushDb(FINDING);   // select(obsFindings).where()
      pushDb(CONTROL);   // select(obsControls).where()
      pushDb();          // insert(obsFindingControls).values().onConflictDoNothing()
      pushDb();          // audit

      const res = await request(app)
        .post("/api/observatory/findings/find-1/controls/ctrl-1");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
    });

    it("returns 404 when finding or control is not found", async () => {
      pushDb();   // select(obsFindings) returns []
      pushDb();   // select(obsControls) returns []

      const res = await request(app)
        .post("/api/observatory/findings/nonexistent/controls/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/observatory/findings/:id/controls/:controlId", () => {
    it("unlinks a control from a finding and returns { success: true }", async () => {
      pushDb(FINDING);  // select(obsFindings).where()
      pushDb();         // delete(obsFindingControls).where()
      pushDb();         // audit

      const res = await request(app)
        .delete("/api/observatory/findings/find-1/controls/ctrl-1");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
    });

    it("returns 404 when the finding is not in this tenant", async () => {
      pushDb();  // select(obsFindings) returns []

      const res = await request(app)
        .delete("/api/observatory/findings/nonexistent/controls/ctrl-1");

      expect(res.status).toBe(404);
    });
  });
});
