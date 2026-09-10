import { main } from "../server/jobs/check-in-reminder.job";

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
