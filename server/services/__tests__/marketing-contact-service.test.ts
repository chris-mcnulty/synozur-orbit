import { strict as assert } from "node:assert";
import { describe, it, vi } from "vitest";
import {
  shouldAdvanceLifecycleStage,
  LIFECYCLE_STAGES,
  normaliseEmail,
  upsertContact,
} from "../marketing-contact-service";
import {
  computeWebhookSignature,
  verifyWebhookSignature,
} from "../marketing-contact-webhook-auth";

// ---------------------------------------------------------------------------
// normaliseEmail
// ---------------------------------------------------------------------------

describe("normaliseEmail", () => {
  it("lowercases an already-lowercase address", () => {
    assert.equal(normaliseEmail("user@example.com"), "user@example.com");
  });

  it("lowercases a mixed-case address (HubSpot style)", () => {
    assert.equal(normaliseEmail("User@Example.COM"), "user@example.com");
  });

  it("trims leading and trailing whitespace", () => {
    assert.equal(normaliseEmail("  user@example.com  "), "user@example.com");
  });

  it("handles all-uppercase address", () => {
    assert.equal(normaliseEmail("USER@EXAMPLE.COM"), "user@example.com");
  });

  it("trims AND lowercases simultaneously", () => {
    assert.equal(normaliseEmail("  User@Example.COM  "), "user@example.com");
  });

  it("leaves an already-normalised address unchanged", () => {
    const addr = "contact@synozur.com";
    assert.equal(normaliseEmail(addr), addr);
  });
});

// ---------------------------------------------------------------------------
// upsertContact — retry on concurrent unique-violation (23505)
// ---------------------------------------------------------------------------

describe("upsertContact — retry on 23505 unique violation", () => {
  it("retries on first 23505 and succeeds on second attempt", async () => {
    // Simulate a PostgreSQL unique_violation (code 23505) on the first INSERT
    // attempt, as happens when two concurrent requests race before either commits.
    // The function should transparently retry and return the row from the second
    // attempt (where ON CONFLICT DO UPDATE takes effect).
    const uniqueViolation = Object.assign(new Error("duplicate key value"), { code: "23505" });

    const expectedRow = {
      id: "existing-id",
      tenantDomain: "example.com",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      company: null,
      jobTitle: null,
      lifecycleStage: "subscriber",
      hubspotContactId: null,
      source: "manual",
      metadata: null,
      lastEventAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let callCount = 0;

    // Build a mock drizzle chain: insert().values().onConflictDoUpdate().returning()
    // First call throws uniqueViolation; second call returns expectedRow.
    const mockReturning = vi.fn(async () => { throw otherError; });
    const mockOnConflict = vi.fn(() => ({ returning: mockReturning }));
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflict }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));

    const { db } = await import("../../db");
    const originalInsert = db.insert.bind(db);
    (db as any).insert = mockInsert;

    try {
      const result = await upsertContact({
        tenantDomain: "example.com",
        email: "user@example.com",
        source: "test",
      });
      assert.equal(callCount, 2, "should have retried exactly once");
      assert.equal(result.contact.email, "user@example.com");
      // The returned id differs from the generated uuid → created=false
      assert.equal(result.created, false);
    } finally {
      (db as any).insert = originalInsert;
    }
  });

  it("rethrows on the third consecutive 23505 (exhausted retries)", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate key value"), { code: "23505" });

    const mockReturning = vi.fn(async () => { throw otherError; });
    const mockOnConflict = vi.fn(() => ({ returning: mockReturning }));
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflict }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));

    const { db } = await import("../../db");
    const originalInsert = db.insert.bind(db);
    (db as any).insert = mockInsert;

    try {
      await assert.rejects(
        () => upsertContact({ tenantDomain: "example.com", email: "user@example.com" }),
        (err: any) => err.code === "23505",
      );
      assert.equal(mockReturning.mock.calls.length, 3, "should have tried 3 times before giving up");
    } finally {
      (db as any).insert = originalInsert;
    }
  });

  it("does NOT retry on a non-unique-violation DB error", async () => {
    const otherError = Object.assign(new Error("connection reset"), { code: "08006" });

    const mockReturning = vi.fn(async () => { throw otherError; });
    const mockOnConflict = vi.fn(() => ({ returning: mockReturning }));
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflict }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));

    const { db } = await import("../../db");
    const originalInsert = db.insert.bind(db);
    (db as any).insert = mockInsert;

    try {
      await assert.rejects(
        () => upsertContact({ tenantDomain: "example.com", email: "user@example.com" }),
        (err: any) => err.code === "08006",
      );
      assert.equal(mockReturning.mock.calls.length, 1, "should have thrown immediately without retry");
    } finally {
      (db as any).insert = originalInsert;
    }
  });
});

// ---------------------------------------------------------------------------
// shouldAdvanceLifecycleStage
// ---------------------------------------------------------------------------

describe("marketing-contact-service pure helpers", () => {
  describe("shouldAdvanceLifecycleStage", () => {
    it("advances from subscriber to lead", () => {
      assert.equal(shouldAdvanceLifecycleStage("subscriber", "lead"), true);
    });

    it("advances from lead to mql", () => {
      assert.equal(shouldAdvanceLifecycleStage("lead", "mql"), true);
    });

    it("advances from mql all the way to customer", () => {
      assert.equal(shouldAdvanceLifecycleStage("mql", "customer"), true);
    });

    it("does not downgrade from customer to lead", () => {
      assert.equal(shouldAdvanceLifecycleStage("customer", "lead"), false);
    });

    it("does not change when stage is identical", () => {
      assert.equal(shouldAdvanceLifecycleStage("sql", "sql"), false);
    });

    it("treats null current as subscriber (lowest)", () => {
      assert.equal(shouldAdvanceLifecycleStage(null, "lead"), true);
    });

    it("returns false when next is null", () => {
      assert.equal(shouldAdvanceLifecycleStage("subscriber", null), false);
    });

    it("returns false for unknown stage in next", () => {
      assert.equal(shouldAdvanceLifecycleStage("subscriber", "unknown-stage"), false);
    });

    it("covers the full LIFECYCLE_STAGES order end-to-end", () => {
      // Each adjacent pair should advance.
      for (let i = 0; i < LIFECYCLE_STAGES.length - 1; i++) {
        assert.equal(
          shouldAdvanceLifecycleStage(LIFECYCLE_STAGES[i], LIFECYCLE_STAGES[i + 1]),
          true,
          `expected ${LIFECYCLE_STAGES[i]} → ${LIFECYCLE_STAGES[i + 1]} to advance`,
        );
      }
    });

    it("never advances from the last stage", () => {
      const last = LIFECYCLE_STAGES[LIFECYCLE_STAGES.length - 1];
      for (const stage of LIFECYCLE_STAGES) {
        assert.equal(
          shouldAdvanceLifecycleStage(last, stage),
          false,
          `expected ${last} → ${stage} to not advance`,
        );
      }
    });
  });
});

describe("marketing-contact-webhook-auth", () => {
  const SECRET = "test-secret-abc123";
  const TENANT_A = "tenant-a.example.com";
  const TENANT_B = "tenant-b.example.com";
  const BODY = Buffer.from(JSON.stringify({ email: "user@example.com", eventType: "form_submit" }));

  it("accepts a valid signature for the correct tenant", () => {
      const sig = computeWebhookSignature(TENANT_A, BODY, "any-secret");
    // Override env for the test
    const originalSecret = process.env.WEBBASE_WEBHOOK_SECRET;
    process.env.WEBBASE_WEBHOOK_SECRET = SECRET;
    try {
      assert.equal(verifyWebhookSignature(TENANT_A, BODY, sig), true);
    } finally {
      process.env.WEBBASE_WEBHOOK_SECRET = originalSecret;
    }
  });

  it("rejects a signature computed for tenant A when replayed against tenant B", () => {
    // A signature produced for TENANT_A must NOT verify for TENANT_B.
    const sigForTenantA = computeWebhookSignature(TENANT_A, BODY, SECRET);
    const originalSecret = process.env.WEBBASE_WEBHOOK_SECRET;
    process.env.WEBBASE_WEBHOOK_SECRET = SECRET;
    try {
      assert.equal(
        verifyWebhookSignature(TENANT_B, BODY, sigForTenantA),
        false,
        "signature for tenant A must not pass for tenant B",
      );
    } finally {
      process.env.WEBBASE_WEBHOOK_SECRET = originalSecret;
    }
  });

  it("rejects a missing signature header", () => {
    const originalSecret = process.env.WEBBASE_WEBHOOK_SECRET;
    process.env.WEBBASE_WEBHOOK_SECRET = SECRET;
    try {
      assert.equal(verifyWebhookSignature(TENANT_A, BODY, undefined), false);
    } finally {
      process.env.WEBBASE_WEBHOOK_SECRET = originalSecret;
    }
  });

  it("rejects a tampered body (same tenant, same sig)", () => {
      const sig = computeWebhookSignature(TENANT_A, BODY, "any-secret");
    const tamperedBody = Buffer.from(
      JSON.stringify({ email: "attacker@example.com", eventType: "form_submit" }),
    );
    const originalSecret = process.env.WEBBASE_WEBHOOK_SECRET;
    process.env.WEBBASE_WEBHOOK_SECRET = SECRET;
    try {
      assert.equal(
        verifyWebhookSignature(TENANT_A, tamperedBody, sig),
        false,
        "tampered body must not verify",
      );
    } finally {
      process.env.WEBBASE_WEBHOOK_SECRET = originalSecret;
    }
  });

  it("computeWebhookSignature produces different values for different tenants", () => {
    const sigA = computeWebhookSignature(TENANT_A, BODY, SECRET);
    const sigB = computeWebhookSignature(TENANT_B, BODY, SECRET);
    assert.notEqual(sigA, sigB, "same body + secret must yield different signatures for different tenants");
  });

  it("rejects in every environment when WEBBASE_WEBHOOK_SECRET is unset", () => {
    // Previously, a missing secret was accepted in development — that was a
    // fail-open vulnerability. The secret must now always be required.
    const originalSecret = process.env.WEBBASE_WEBHOOK_SECRET;
    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.WEBBASE_WEBHOOK_SECRET;
    try {
      const sig = computeWebhookSignature(TENANT_A, BODY, "any-secret");

      // Development environment — must still reject.
      process.env.NODE_ENV = "development";
      assert.equal(
        verifyWebhookSignature(TENANT_A, BODY, sig),
        false,
        "should reject in development when secret is unset",
      );

      // Production environment — must reject.
      process.env.NODE_ENV = "production";
      assert.equal(
        verifyWebhookSignature(TENANT_A, BODY, sig),
        false,
        "should reject in production when secret is unset",
      );

      // No NODE_ENV at all — must reject.
      delete process.env.NODE_ENV;
      assert.equal(
        verifyWebhookSignature(TENANT_A, BODY, sig),
        false,
        "should reject when NODE_ENV is absent and secret is unset",
      );
    } finally {
      if (originalSecret !== undefined) process.env.WEBBASE_WEBHOOK_SECRET = originalSecret;
      if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
