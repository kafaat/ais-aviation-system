import { beforeEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ archive: vi.fn() }));
vi.mock("../services/ai-chat-booking.service", () => ({
  archiveOldConversations: boundary.archive,
}));
vi.mock("../services/loyalty.service", () => ({
  processExpiredMiles: vi.fn(),
}));
import { runConversationCleanupJob } from "../jobs/loyalty-cleanup.job";

beforeEach(() => boundary.archive.mockReset());
it("reports committed archives and partial failure without discarding successful work", async () => {
  boundary.archive.mockResolvedValue({ archivedCount: 101, failedCount: 1 });
  expect(await runConversationCleanupJob(7)).toMatchObject({
    success: false,
    archivedCount: 101,
    failedCount: 1,
  });
  expect(boundary.archive).toHaveBeenCalledWith(7);
});
it("reports full cleanup success using the existing default age", async () => {
  boundary.archive.mockResolvedValue({ archivedCount: 2, failedCount: 0 });
  expect(await runConversationCleanupJob()).toEqual({
    success: true,
    archivedCount: 2,
    failedCount: 0,
  });
  expect(boundary.archive).toHaveBeenCalledWith(30);
});
