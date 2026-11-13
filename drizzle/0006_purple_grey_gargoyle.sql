ALTER TABLE "work_segments" ALTER COLUMN "is_overtime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_segments" ALTER COLUMN "is_night" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_segments" ALTER COLUMN "is_holiday_work" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_segments" ADD COLUMN "unresolved_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;