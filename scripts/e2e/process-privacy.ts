import { disposableDatabaseUrl } from "../../e2e/disposable-database";
import { processPrivacyRequests } from "../../server/services/gdpr.service";
import { closePool } from "../../server/db";
disposableDatabaseUrl();
try {
  await processPrivacyRequests();
} finally {
  await closePool();
}
