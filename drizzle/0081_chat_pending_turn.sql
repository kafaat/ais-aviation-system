ALTER TABLE `chat_conversations` ADD `pendingMessageId` int;--> statement-breakpoint
ALTER TABLE `chat_conversations` ADD `pendingUntil` timestamp(3);