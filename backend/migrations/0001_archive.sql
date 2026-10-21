CREATE TABLE `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` integer,
	`locator` text,
	`text` text,
	`method` text
);
--> statement-breakpoint
CREATE INDEX `chunk_source` ON `chunks` (`source`);--> statement-breakpoint
CREATE TABLE `issuances` (
	`id` text PRIMARY KEY NOT NULL,
	`sid` text,
	`payload` text,
	`created` text
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` integer,
	`locator` text,
	`sid` text,
	`name` text,
	`college` text,
	`award` text,
	`year` text,
	`year_basis` text,
	`level` text,
	`amount` text,
	`stage` text,
	`excerpt` text,
	`method` text,
	`record_hash` text
);
--> statement-breakpoint
CREATE INDEX `obs_sid` ON `observations` (`sid`);--> statement-breakpoint
CREATE INDEX `obs_name` ON `observations` (`name`);--> statement-breakpoint
CREATE INDEX `obs_source` ON `observations` (`source`);--> statement-breakpoint
CREATE INDEX `obs_filters` ON `observations` (`year`,`award`,`sid`);--> statement-breakpoint
CREATE UNIQUE INDEX `obs_unique` ON `observations` (`source`,`locator`,`sid`,`name`,`award`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`observation` integer,
	`sid` text,
	`name` text,
	`college` text,
	`award` text,
	`year` text,
	`level` text,
	`decision` text,
	`note` text,
	`reviewer` text,
	`created` text,
	`source_sha` text,
	`record_hash` text
);
--> statement-breakpoint
CREATE INDEX `review_student` ON `reviews` (`sid`);--> statement-breakpoint
CREATE INDEX `review_observation` ON `reviews` (`observation`,`id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text,
	`actual` text,
	`sha` text,
	`size` integer,
	`ext` text,
	`state` text,
	`message` text,
	`pages` integer,
	`mtime_ns` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_path` ON `sources` (`path`);--> statement-breakpoint
CREATE INDEX `source_sha` ON `sources` (`sha`);--> statement-breakpoint
CREATE TABLE `students` (
	`sid` text PRIMARY KEY NOT NULL,
	`name` text,
	`college` text,
	`aliases` text,
	`conflict` integer
);

--> statement-breakpoint
CREATE VIRTUAL TABLE fulltext USING fts5(text,content='chunks',content_rowid='id',tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN INSERT INTO fulltext(rowid,text) VALUES(new.id,new.text); END;
--> statement-breakpoint
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN INSERT INTO fulltext(fulltext,rowid,text) VALUES('delete',old.id,old.text); END;
--> statement-breakpoint
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN INSERT INTO fulltext(fulltext,rowid,text) VALUES('delete',old.id,old.text); INSERT INTO fulltext(rowid,text) VALUES(new.id,new.text); END;
