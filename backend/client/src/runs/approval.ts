export type SamplingApprovalDecision = "approve" | "deny";

export type SamplingApprovalRequest = {
  id: string;
  turnId: string;
  messageCount: number;
  createdAt: string;
};

type PendingApproval = SamplingApprovalRequest & {
  resolve: (decision: SamplingApprovalDecision) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort: () => void;
};

export class SamplingApprovalBroker {
  private readonly pendingByTurn = new Map<string, PendingApproval>();

  request(
    input: Pick<SamplingApprovalRequest, "turnId" | "messageCount">,
    signal?: AbortSignal,
  ): Promise<SamplingApprovalDecision> {
    const existing = this.pendingByTurn.get(input.turnId);
    if (existing)
      return Promise.reject(new Error("Sampling approval is already pending."));

    return new Promise((resolve, reject) => {
      const approval: PendingApproval = {
        id: crypto.randomUUID(),
        turnId: input.turnId,
        messageCount: input.messageCount,
        createdAt: new Date().toISOString(),
        resolve,
        reject,
        signal,
        onAbort: () => {
          this.pendingByTurn.delete(input.turnId);
          reject(new Error("Sampling approval was cancelled."));
        },
      };
      if (signal?.aborted) {
        approval.onAbort();
        return;
      }
      signal?.addEventListener("abort", approval.onAbort, { once: true });
      this.pendingByTurn.set(input.turnId, approval);
    });
  }

  pending(turnId: string): SamplingApprovalRequest | null {
    const pending = this.pendingByTurn.get(turnId);
    if (!pending) return null;
    return {
      id: pending.id,
      turnId: pending.turnId,
      messageCount: pending.messageCount,
      createdAt: pending.createdAt,
    };
  }

  decide(turnId: string, decision: SamplingApprovalDecision): boolean {
    const pending = this.pendingByTurn.get(turnId);
    if (!pending) return false;
    this.pendingByTurn.delete(turnId);
    pending.signal?.removeEventListener("abort", pending.onAbort);
    pending.resolve(decision);
    return true;
  }

  cancel(turnId: string): void {
    const pending = this.pendingByTurn.get(turnId);
    if (!pending) return;
    this.pendingByTurn.delete(turnId);
    pending.signal?.removeEventListener("abort", pending.onAbort);
    pending.reject(new Error("Sampling approval was cancelled."));
  }
}
