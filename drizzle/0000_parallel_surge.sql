CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`institution` text NOT NULL,
	`account_type` text NOT NULL,
	`display_name` text NOT NULL,
	`currency` text NOT NULL,
	`external_identifier_masked` text,
	`external_account_number` text,
	`ownership_type` text DEFAULT 'shared' NOT NULL,
	`owner_member_id` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`owner_member_id`) REFERENCES `household_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `accounts_external_account_number_idx` ON `accounts` (`external_account_number`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`change_source` text NOT NULL,
	`rule_id` text,
	`note` text,
	`timestamp` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_idx` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `error_log` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`severity` text NOT NULL,
	`error_code` text NOT NULL,
	`category` text NOT NULL,
	`operation` text NOT NULL,
	`context_json` text DEFAULT '{}' NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`root_cause` text
);
--> statement-breakpoint
CREATE INDEX `error_log_code_idx` ON `error_log` (`error_code`);--> statement-breakpoint
CREATE INDEX `error_log_timestamp_idx` ON `error_log` (`timestamp`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text DEFAULT 'EUR' NOT NULL,
	`date` text NOT NULL,
	`rate` real NOT NULL,
	`source` text NOT NULL,
	`is_exact_date` integer NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_rates_lookup_idx` ON `exchange_rates` (`base_currency`,`quote_currency`,`date`);--> statement-breakpoint
CREATE TABLE `household_members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`color` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`institution` text NOT NULL,
	`account_id` text,
	`file_name` text NOT NULL,
	`file_hash` text NOT NULL,
	`imported_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`status` text DEFAULT 'committed' NOT NULL,
	`rows_inspected` integer DEFAULT 0 NOT NULL,
	`rows_imported` integer DEFAULT 0 NOT NULL,
	`rows_duplicate` integer DEFAULT 0 NOT NULL,
	`rows_transfer_suggested` integer DEFAULT 0 NOT NULL,
	`rows_warning` integer DEFAULT 0 NOT NULL,
	`rows_error` integer DEFAULT 0 NOT NULL,
	`exchange_rate_status` text DEFAULT 'n/a' NOT NULL,
	`undone_at` text,
	`undone_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `import_row_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`import_batch_id` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`issue_type` text NOT NULL,
	`message` text NOT NULL,
	`raw_row_json` text NOT NULL,
	`related_transaction_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_row_issues_batch_idx` ON `import_row_issues` (`import_batch_id`);--> statement-breakpoint
CREATE TABLE `priorities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `priorities_name_idx` ON `priorities` (`name`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`precedence` integer DEFAULT 100 NOT NULL,
	`match_merchant_contains` text,
	`match_description_contains` text,
	`match_institution` text,
	`match_account_id` text,
	`match_amount_min` real,
	`match_amount_max` real,
	`match_direction` text,
	`set_category_id` text,
	`set_priority_id` text,
	`set_ownership_type` text,
	`set_owner_member_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`match_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`set_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`set_priority_id`) REFERENCES `priorities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`set_owner_member_id`) REFERENCES `household_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rules_precedence_idx` ON `rules` (`precedence`);--> statement-breakpoint
CREATE TABLE `savings_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`linked_account_id` text NOT NULL,
	`target_balance_eur` real NOT NULL,
	`target_date` text,
	`starting_balance_eur` real,
	`starting_balance_as_of` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`linked_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `savings_goals_linked_account_active_idx` ON `savings_goals` (`linked_account_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`import_batch_id` text,
	`account_id` text NOT NULL,
	`source_file_name` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`original_row_json` text NOT NULL,
	`transaction_date` text NOT NULL,
	`posting_date` text,
	`merchant` text,
	`original_description` text NOT NULL,
	`cleaned_description` text NOT NULL,
	`original_amount` real NOT NULL,
	`original_currency` text NOT NULL,
	`eur_amount` real,
	`exchange_rate` real,
	`exchange_rate_date` text,
	`exchange_rate_source` text,
	`conversion_status` text DEFAULT 'exact' NOT NULL,
	`direction` text NOT NULL,
	`category_id` text,
	`priority_id` text,
	`ownership_type` text DEFAULT 'unassigned' NOT NULL,
	`owner_member_id` text,
	`review_status` text DEFAULT 'ok' NOT NULL,
	`review_reasons_json` text DEFAULT '[]' NOT NULL,
	`confidence_reason` text,
	`applied_rule_id` text,
	`duplicate_fingerprint` text NOT NULL,
	`possible_transfer_id` text,
	`transfer_status` text DEFAULT 'none' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`priority_id`) REFERENCES `priorities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `household_members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transactions_account_idx` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`transaction_date`);--> statement-breakpoint
CREATE INDEX `transactions_fingerprint_idx` ON `transactions` (`duplicate_fingerprint`);--> statement-breakpoint
CREATE INDEX `transactions_batch_idx` ON `transactions` (`import_batch_id`);--> statement-breakpoint
CREATE INDEX `transactions_review_idx` ON `transactions` (`review_status`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);