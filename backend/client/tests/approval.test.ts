import { describe, expect, test } from "bun:test";
import { SamplingApprovalBroker } from "../src/runs/approval.ts";

describe("SamplingApprovalBroker", () => {
  test("resolves one pending request with allow once", async () => {
    const broker = new SamplingApprovalBroker();
    const decision = broker.request({ turnId: "turn-1", messageCount: 1 });

    expect(broker.decide("turn-1", "approve")).toBeTrue();
    await expect(decision).resolves.toBe("approve");
  });

  test("auto-approves later sampling requests in the same run", async () => {
    const broker = new SamplingApprovalBroker();
    const first = broker.request({ turnId: "turn-1", messageCount: 1 });

    expect(broker.decide("turn-1", "approve_always")).toBeTrue();
    await expect(first).resolves.toBe("approve_always");
    await expect(broker.request({ turnId: "turn-1", messageCount: 1 })).resolves.toBe(
      "approve",
    );

    broker.cancel("turn-1");
    expect(broker.pending("turn-1")).toBeNull();
  });

  test("denies pending sampling requests", async () => {
    const broker = new SamplingApprovalBroker();
    const decision = broker.request({ turnId: "turn-1", messageCount: 1 });

    expect(broker.decide("turn-1", "deny")).toBeTrue();
    await expect(decision).resolves.toBe("deny");
  });
});
