CREATE TABLE `oauth_login_states` (
	`stateHash` varchar(64) NOT NULL,
	`browserNonceHash` varchar(64) NOT NULL,
	`redirectUri` text NOT NULL,
	`returnTo` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oauth_login_states_stateHash` PRIMARY KEY(`stateHash`)
);
--> statement-breakpoint
CREATE INDEX `oauth_login_states_expires_at_idx` ON `oauth_login_states` (`expiresAt`);