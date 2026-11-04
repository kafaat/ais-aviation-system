CREATE TABLE `cache_namespace_generations` (
	`scopeHash` varchar(64) NOT NULL,
	`generation` varchar(36) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cache_namespace_generations_scopeHash` PRIMARY KEY(`scopeHash`)
);
