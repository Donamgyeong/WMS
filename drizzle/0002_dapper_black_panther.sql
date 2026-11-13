CREATE TABLE "employee_policy_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"work_policy_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "work_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"clock_in_from" time DEFAULT '08:00' NOT NULL,
	"clock_in_to" time DEFAULT '10:00' NOT NULL,
	"daily_work_minutes" integer DEFAULT 480 NOT NULL,
	"break_minutes" integer DEFAULT 60 NOT NULL,
	"half_day_work_minutes" integer DEFAULT 240 NOT NULL,
	"half_day_break_minutes" integer,
	"regular_multiplier" numeric DEFAULT '1.0' NOT NULL,
	"overtime_multiplier" numeric DEFAULT '1.5' NOT NULL,
	"night_overtime_multiplier" numeric DEFAULT '2.0' NOT NULL,
	"holiday_multiplier" numeric,
	"unresolved_policies" jsonb DEFAULT '["ALLOCATION", "ALLOWANCE_COMPARISON", "HALF_DAY", "OVERTIME_APPROVAL", "HOLIDAY", "CORRECTION_APPROVAL", "WEEKLY_ALERT", "ROUNDING", "TAX"]'::jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "policy_name_version" UNIQUE("name","version"),
	CONSTRAINT "policy_values" CHECK ("work_policies"."version">0 AND "work_policies"."daily_work_minutes">=0 AND "work_policies"."break_minutes">=0 AND "work_policies"."half_day_work_minutes">=0 AND ("work_policies"."half_day_break_minutes" IS NULL OR "work_policies"."half_day_break_minutes">=0) AND "work_policies"."clock_in_from"<="work_policies"."clock_in_to" AND "work_policies"."regular_multiplier">0 AND "work_policies"."overtime_multiplier">0 AND "work_policies"."night_overtime_multiplier">0 AND ("work_policies"."holiday_multiplier" IS NULL OR "work_policies"."holiday_multiplier">0))
);
--> statement-breakpoint
CREATE TABLE "employee_calendar_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "holiday_calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"calendar_id" text NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"holiday_type" text NOT NULL,
	"is_paid" boolean,
	"source" text NOT NULL,
	CONSTRAINT "holiday_calendar_date_name" UNIQUE("calendar_id","holiday_date","name")
);
--> statement-breakpoint
CREATE TABLE "leave_records" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"external_leave_id" text,
	"leave_type" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"approved_status" text NOT NULL,
	"synced_at" timestamp with time zone,
	CONSTRAINT "leave_records_external_leave_id_unique" UNIQUE("external_leave_id"),
	CONSTRAINT "leave_interval" CHECK ("leave_records"."start_at"<"leave_records"."end_at")
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"work_date" date NOT NULL,
	"day_type" text NOT NULL,
	"required_work_minutes" integer,
	"holiday_id" text,
	"is_work_scheduled" boolean NOT NULL,
	CONSTRAINT "employee_work_date" UNIQUE("employee_id","work_date"),
	CONSTRAINT "schedule_minutes" CHECK ("work_schedules"."required_work_minutes" IS NULL OR "work_schedules"."required_work_minutes">=0)
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"event_id" text NOT NULL,
	"requested_change" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'UNDECIDED' NOT NULL,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "correction_approver" CHECK ("attendance_corrections"."status"<>'APPROVED' OR "attendance_corrections"."approved_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"work_session_id" text,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"workplace_id" text,
	"verification_status" text NOT NULL,
	"verification_evidence" jsonb NOT NULL,
	"request_id" text NOT NULL,
	CONSTRAINT "event_request" UNIQUE("employee_id","request_id"),
	CONSTRAINT "event_employee_key" UNIQUE("id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "work_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"work_session_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_minutes" numeric(14, 6) NOT NULL,
	"is_overtime" boolean NOT NULL,
	"is_night" boolean NOT NULL,
	"is_holiday_work" boolean NOT NULL,
	"applied_multiplier" numeric,
	"calculation_version" integer NOT NULL,
	CONSTRAINT "segment_values" CHECK ("work_segments"."started_at"<"work_segments"."ended_at" AND "work_segments"."duration_minutes">0 AND "work_segments"."calculation_version">0 AND ("work_segments"."applied_multiplier" IS NULL OR "work_segments"."applied_multiplier">0))
);
--> statement-breakpoint
CREATE TABLE "work_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"work_date" date NOT NULL,
	"clock_in_at" timestamp with time zone,
	"clock_out_at" timestamp with time zone,
	"break_minutes" numeric(14, 6),
	"actual_work_minutes" numeric(14, 6),
	"required_work_minutes" numeric(14, 6),
	"calculation_version" integer NOT NULL,
	"work_policy_id" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "session_employee_key" UNIQUE("id","employee_id"),
	CONSTRAINT "session_date_version" UNIQUE("employee_id","work_date","calculation_version"),
	CONSTRAINT "session_values" CHECK ("work_sessions"."calculation_version">0 AND ("work_sessions"."clock_out_at" IS NULL OR "work_sessions"."clock_in_at"<"work_sessions"."clock_out_at") AND ("work_sessions"."break_minutes" IS NULL OR "work_sessions"."break_minutes">=0) AND ("work_sessions"."actual_work_minutes" IS NULL OR "work_sessions"."actual_work_minutes">=0) AND ("work_sessions"."required_work_minutes" IS NULL OR "work_sessions"."required_work_minutes">=0))
);
--> statement-breakpoint
CREATE TABLE "workplace_ip_ranges" (
	"id" text PRIMARY KEY NOT NULL,
	"workplace_id" text NOT NULL,
	"ip_network" "cidr" NOT NULL,
	CONSTRAINT "workplace_network" UNIQUE("workplace_id","ip_network")
);
--> statement-breakpoint
CREATE TABLE "workplaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"gps_radius_meters" integer NOT NULL,
	CONSTRAINT "workplace_coordinates" CHECK ("workplaces"."latitude" BETWEEN -90 AND 90 AND "workplaces"."longitude" BETWEEN -180 AND 180 AND "workplaces"."gps_radius_meters">0)
);
--> statement-breakpoint
CREATE TABLE "payroll"."audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll"."compensation_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"included_overtime_minutes" integer DEFAULT 960 NOT NULL,
	"fixed_overtime_allowance" numeric(24, 8),
	"allocation_policy" text DEFAULT 'UNDECIDED' NOT NULL,
	"allowance_comparison_policy" text DEFAULT 'UNDECIDED' NOT NULL,
	CONSTRAINT "contract_employee_key" UNIQUE("id","employee_id"),
	CONSTRAINT "contract_values" CHECK ("payroll"."compensation_contracts"."included_overtime_minutes">=0 AND ("payroll"."compensation_contracts"."fixed_overtime_allowance" IS NULL OR "payroll"."compensation_contracts"."fixed_overtime_allowance">=0))
);
--> statement-breakpoint
CREATE TABLE "payroll"."hourly_rate_histories" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"hourly_rate" numeric(24, 8) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "rate_positive" CHECK ("payroll"."hourly_rate_histories"."hourly_rate">0)
);
--> statement-breakpoint
CREATE TABLE "payroll"."payroll_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"payroll_calculation_id" text NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll"."payroll_calculations" (
	"id" text PRIMARY KEY NOT NULL,
	"payroll_period_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"regular_minutes" numeric(14, 6) NOT NULL,
	"overtime_minutes" numeric(14, 6) NOT NULL,
	"night_overtime_minutes" numeric(14, 6) NOT NULL,
	"included_overtime_minutes" numeric(14, 6) NOT NULL,
	"payable_overtime_minutes" numeric(14, 6),
	"regular_pay" numeric(24, 8) NOT NULL,
	"additional_overtime_pay" numeric(24, 8),
	"total_calculated_pay" numeric(24, 8),
	"calculation_version" integer NOT NULL,
	"status" text DEFAULT 'UNRESOLVED' NOT NULL,
	"unresolved_reasons" jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	CONSTRAINT "payroll_employee_version" UNIQUE("payroll_period_id","employee_id","calculation_version"),
	CONSTRAINT "calculation_values" CHECK ("payroll"."payroll_calculations"."calculation_version">0 AND "payroll"."payroll_calculations"."regular_minutes">=0 AND "payroll"."payroll_calculations"."overtime_minutes">=0 AND "payroll"."payroll_calculations"."night_overtime_minutes" BETWEEN 0 AND "payroll"."payroll_calculations"."overtime_minutes" AND "payroll"."payroll_calculations"."included_overtime_minutes" BETWEEN 0 AND "payroll"."payroll_calculations"."overtime_minutes" AND ("payroll"."payroll_calculations"."payable_overtime_minutes" IS NULL OR "payroll"."payroll_calculations"."payable_overtime_minutes"="payroll"."payroll_calculations"."overtime_minutes"-"payroll"."payroll_calculations"."included_overtime_minutes") AND "payroll"."payroll_calculations"."regular_pay">=0 AND ("payroll"."payroll_calculations"."additional_overtime_pay" IS NULL OR "payroll"."payroll_calculations"."additional_overtime_pay">=0) AND ("payroll"."payroll_calculations"."total_calculated_pay" IS NULL OR "payroll"."payroll_calculations"."total_calculated_pay"="payroll"."payroll_calculations"."regular_pay"+"payroll"."payroll_calculations"."additional_overtime_pay")),
	CONSTRAINT "unresolved_amounts" CHECK (("payroll"."payroll_calculations"."status"='UNRESOLVED' AND "payroll"."payroll_calculations"."additional_overtime_pay" IS NULL AND "payroll"."payroll_calculations"."total_calculated_pay" IS NULL) OR ("payroll"."payroll_calculations"."status"<>'UNRESOLVED' AND "payroll"."payroll_calculations"."additional_overtime_pay" IS NOT NULL AND "payroll"."payroll_calculations"."total_calculated_pay" IS NOT NULL AND "payroll"."payroll_calculations"."payable_overtime_minutes" IS NOT NULL AND "payroll"."payroll_calculations"."unresolved_reasons"='[]'::jsonb))
);
--> statement-breakpoint
CREATE TABLE "payroll"."payroll_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"payroll_calculation_id" text NOT NULL,
	"work_segment_id" text,
	"duration_minutes" numeric(14, 6) NOT NULL,
	"hourly_rate" numeric(24, 8) NOT NULL,
	"multiplier" numeric(24, 8),
	"gross_amount" numeric(24, 8),
	"included_minutes" numeric(14, 6),
	"payable_minutes" numeric(14, 6),
	"additional_amount" numeric(24, 8),
	"basis_snapshot" jsonb NOT NULL,
	CONSTRAINT "line_values" CHECK ("payroll"."payroll_line_items"."duration_minutes">0 AND "payroll"."payroll_line_items"."hourly_rate">0 AND ("payroll"."payroll_line_items"."multiplier" IS NULL OR "payroll"."payroll_line_items"."multiplier">0) AND ("payroll"."payroll_line_items"."gross_amount" IS NULL OR "payroll"."payroll_line_items"."gross_amount">=0) AND ("payroll"."payroll_line_items"."included_minutes" IS NULL OR "payroll"."payroll_line_items"."included_minutes" BETWEEN 0 AND "payroll"."payroll_line_items"."duration_minutes") AND ("payroll"."payroll_line_items"."payable_minutes" IS NULL OR "payroll"."payroll_line_items"."payable_minutes" BETWEEN 0 AND "payroll"."payroll_line_items"."duration_minutes") AND ("payroll"."payroll_line_items"."additional_amount" IS NULL OR "payroll"."payroll_line_items"."additional_amount">=0))
);
--> statement-breakpoint
CREATE TABLE "payroll"."payroll_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "period_dates" UNIQUE("period_start","period_end"),
	CONSTRAINT "period_interval" CHECK ("payroll"."payroll_periods"."period_start"<"payroll"."payroll_periods"."period_end"),
	CONSTRAINT "period_finalized_at" CHECK (("payroll"."payroll_periods"."status"='FINALIZED')=("payroll"."payroll_periods"."finalized_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "manager_id" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employee_no" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "hired_at" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "terminated_at" date;--> statement-breakpoint
ALTER TABLE "employee_policy_assignments" ADD CONSTRAINT "employee_policy_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_policy_assignments" ADD CONSTRAINT "employee_policy_assignments_work_policy_id_work_policies_id_fk" FOREIGN KEY ("work_policy_id") REFERENCES "public"."work_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_calendar_assignments" ADD CONSTRAINT "employee_calendar_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_calendar_assignments" ADD CONSTRAINT "employee_calendar_assignments_calendar_id_holiday_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."holiday_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_holiday_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."holiday_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_records" ADD CONSTRAINT "leave_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_holiday_id_holidays_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holidays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_approved_by_employees_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_event_id_employee_id_attendance_events_id_employee_id_fk" FOREIGN KEY ("event_id","employee_id") REFERENCES "public"."attendance_events"("id","employee_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_work_session_id_employee_id_work_sessions_id_employee_id_fk" FOREIGN KEY ("work_session_id","employee_id") REFERENCES "public"."work_sessions"("id","employee_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_segments" ADD CONSTRAINT "work_segments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_segments" ADD CONSTRAINT "work_segments_work_session_id_employee_id_work_sessions_id_employee_id_fk" FOREIGN KEY ("work_session_id","employee_id") REFERENCES "public"."work_sessions"("id","employee_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_work_policy_id_work_policies_id_fk" FOREIGN KEY ("work_policy_id") REFERENCES "public"."work_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workplace_ip_ranges" ADD CONSTRAINT "workplace_ip_ranges_workplace_id_workplaces_id_fk" FOREIGN KEY ("workplace_id") REFERENCES "public"."workplaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_employees_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."compensation_contracts" ADD CONSTRAINT "compensation_contracts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."hourly_rate_histories" ADD CONSTRAINT "hourly_rate_histories_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_calculation_id_payroll_calculations_id_fk" FOREIGN KEY ("payroll_calculation_id") REFERENCES "payroll"."payroll_calculations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."payroll_calculations" ADD CONSTRAINT "payroll_calculations_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."payroll_calculations" ADD CONSTRAINT "payroll_calculations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."payroll_calculations" ADD CONSTRAINT "payroll_calculations_contract_id_employee_id_compensation_contracts_id_employee_id_fk" FOREIGN KEY ("contract_id","employee_id") REFERENCES "payroll"."compensation_contracts"("id","employee_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."payroll_line_items" ADD CONSTRAINT "payroll_line_items_payroll_calculation_id_payroll_calculations_id_fk" FOREIGN KEY ("payroll_calculation_id") REFERENCES "payroll"."payroll_calculations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll"."payroll_line_items" ADD CONSTRAINT "payroll_line_items_work_segment_id_work_segments_id_fk" FOREIGN KEY ("work_segment_id") REFERENCES "public"."work_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_employee_time" ON "attendance_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_employee_no_unique" UNIQUE("employee_no");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "department_not_self_parent" CHECK ("departments"."parent_id" IS DISTINCT FROM "departments"."id");