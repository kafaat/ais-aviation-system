/**
 * Loyalty Cleanup Job
 *
 * Scheduled job to process expired miles and cleanup old data
 * Should run daily at midnight
 */

import { processExpiredMiles } from "../services/loyalty.service";
import { archiveOldConversations } from "../services/ai-chat-booking.service";

/**
 * Process expired miles for all loyalty accounts
 */
export async function runMilesExpirationJob(): Promise<{
  success: boolean;
  processedAccounts: number;
  totalExpiredMiles: number;
  error?: string;
}> {
  console.info("[LoyaltyCleanupJob] Starting miles expiration processing...");

  try {
    const result = await processExpiredMiles();

    console.info(
      `[LoyaltyCleanupJob] Completed: ${result.processedAccounts} accounts processed, ${result.totalExpiredMiles} miles expired`
    );

    return {
      success: true,
      processedAccounts: result.processedAccounts,
      totalExpiredMiles: result.totalExpiredMiles,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[LoyaltyCleanupJob] Error:", errorMessage);

    return {
      success: false,
      processedAccounts: 0,
      totalExpiredMiles: 0,
      error: errorMessage,
    };
  }
}

/**
 * Archive old chat conversations
 */
export async function runConversationCleanupJob(
  olderThanDays: number = 30
): Promise<{
  success: boolean;
  archivedCount: number;
  error?: string;
}> {
  console.info(
    `[ConversationCleanupJob] Starting conversation cleanup (older than ${olderThanDays} days)...`
  );

  try {
    const archivedCount = await archiveOldConversations(olderThanDays);

    console.info(
      `[ConversationCleanupJob] Completed: ${archivedCount} conversations archived`
    );

    return {
      success: true,
      archivedCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[ConversationCleanupJob] Error:", errorMessage);

    return {
      success: false,
      archivedCount: 0,
      error: errorMessage,
    };
  }
}

/**
 * Run all cleanup jobs
 */
export async function runAllCleanupJobs(): Promise<{
  milesExpiration: Awaited<ReturnType<typeof runMilesExpirationJob>>;
  conversationCleanup: Awaited<ReturnType<typeof runConversationCleanupJob>>;
}> {
  console.info("[CleanupJobs] Starting all cleanup jobs...");

  const [milesExpiration, conversationCleanup] = await Promise.all([
    runMilesExpirationJob(),
    runConversationCleanupJob(),
  ]);

  console.info("[CleanupJobs] All cleanup jobs completed");

  return {
    milesExpiration,
    conversationCleanup,
  };
}
