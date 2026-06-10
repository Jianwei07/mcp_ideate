CREATE TABLE `citations` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`source_id` text NOT NULL,
	`page_id` text NOT NULL,
	`page_title` text NOT NULL,
	`page_url` text NOT NULL,
	`heading_path_json` text NOT NULL,
	`block_ids_json` text NOT NULL,
	`score` real NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `citations_turn_id_idx` ON `citations` (`turn_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`timestamp` text NOT NULL,
	`channel` text NOT NULL,
	`origin` text NOT NULL,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`method` text,
	`request_id` text,
	`parent_request_id` text,
	`level` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`duration_ms` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`detail_available` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_turn_sequence_idx` ON `events` (`turn_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `events_request_id_idx` ON `events` (`request_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_updated_at_idx` ON `sessions` (`updated_at`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`query` text NOT NULL,
	`answer` text,
	`rationale` text,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`thinking_requested` integer DEFAULT false NOT NULL,
	`thinking_supported` integer DEFAULT false NOT NULL,
	`prompt_tokens` integer,
	`output_tokens` integer,
	`context_tokens` integer NOT NULL,
	`total_duration_ms` integer,
	`error_code` text,
	`error_message` text,
	`retryable` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `turns_session_id_idx` ON `turns` (`session_id`);--> statement-breakpoint
CREATE INDEX `turns_status_idx` ON `turns` (`status`);