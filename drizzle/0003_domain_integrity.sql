CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
REVOKE ALL ON SCHEMA payroll FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA payroll FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE work_policies ADD CONSTRAINT work_policies_effective_interval CHECK (effective_to IS NULL OR effective_from < effective_to);
--> statement-breakpoint
ALTER TABLE work_policies ADD CONSTRAINT work_policies_no_overlap EXCLUDE USING gist (name WITH =, daterange(effective_from,effective_to,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE employee_policy_assignments ADD CONSTRAINT employee_policy_assignments_effective_interval CHECK (effective_to IS NULL OR effective_from < effective_to);
--> statement-breakpoint
ALTER TABLE employee_policy_assignments ADD CONSTRAINT employee_policy_assignments_no_overlap EXCLUDE USING gist (employee_id WITH =, daterange(effective_from,effective_to,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE employee_calendar_assignments ADD CONSTRAINT employee_calendar_assignments_effective_interval CHECK (effective_to IS NULL OR effective_from < effective_to);
--> statement-breakpoint
ALTER TABLE employee_calendar_assignments ADD CONSTRAINT employee_calendar_assignments_no_overlap EXCLUDE USING gist (employee_id WITH =, calendar_id WITH =, daterange(effective_from,effective_to,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE payroll.hourly_rate_histories ADD CONSTRAINT hourly_rate_histories_effective_interval CHECK (effective_to IS NULL OR effective_from < effective_to);
--> statement-breakpoint
ALTER TABLE payroll.hourly_rate_histories ADD CONSTRAINT hourly_rate_histories_no_overlap EXCLUDE USING gist (employee_id WITH =, daterange(effective_from,effective_to,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE payroll.compensation_contracts ADD CONSTRAINT compensation_contracts_effective_interval CHECK (effective_to IS NULL OR effective_from < effective_to);
--> statement-breakpoint
ALTER TABLE payroll.compensation_contracts ADD CONSTRAINT compensation_contracts_no_overlap EXCLUDE USING gist (employee_id WITH =, daterange(effective_from,effective_to,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE employees ADD CONSTRAINT employee_employment_interval CHECK (terminated_at IS NULL OR hired_at IS NULL OR hired_at <= terminated_at);
--> statement-breakpoint
ALTER TABLE work_segments ADD CONSTRAINT segments_no_overlap EXCLUDE USING gist (employee_id WITH =, calculation_version WITH =, tstzrange(started_at,ended_at,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE payroll.payroll_periods ADD CONSTRAINT periods_no_overlap EXCLUDE USING gist (daterange(period_start,period_end,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE holidays ADD CONSTRAINT holidays_holiday_type_values CHECK (holiday_type IN ('PUBLIC','SUBSTITUTE','COMPANY'));
--> statement-breakpoint
ALTER TABLE work_schedules ADD CONSTRAINT work_schedules_day_type_values CHECK (day_type IN ('WORKDAY','HOLIDAY','DAY_OFF'));
--> statement-breakpoint
ALTER TABLE leave_records ADD CONSTRAINT leave_records_approved_status_values CHECK (approved_status IN ('PENDING','APPROVED','REJECTED','CANCELLED'));
--> statement-breakpoint
ALTER TABLE work_sessions ADD CONSTRAINT work_sessions_status_values CHECK (status IN ('OPEN','COMPLETE','INCOMPLETE','UNRESOLVED'));
--> statement-breakpoint
ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_event_type_values CHECK (event_type IN ('CLOCK_IN','CLOCK_OUT','BREAK_START','BREAK_END'));
--> statement-breakpoint
ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_source_values CHECK (source IN ('PC','MOBILE'));
--> statement-breakpoint
ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_verification_status_values CHECK (verification_status IN ('ACCEPTED','REJECTED','UNVERIFIED'));
--> statement-breakpoint
ALTER TABLE attendance_corrections ADD CONSTRAINT attendance_corrections_status_values CHECK (status IN ('UNDECIDED','PENDING','APPROVED','REJECTED'));
--> statement-breakpoint
ALTER TABLE payroll.payroll_periods ADD CONSTRAINT payroll_periods_status_values CHECK (status IN ('OPEN','CALCULATED','FINALIZED'));
--> statement-breakpoint
ALTER TABLE payroll.payroll_calculations ADD CONSTRAINT payroll_calculations_status_values CHECK (status IN ('UNRESOLVED','CALCULATED','FINALIZED'));
--> statement-breakpoint
CREATE FUNCTION reject_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER preserve_records BEFORE UPDATE OR DELETE ON attendance_events FOR EACH ROW EXECUTE FUNCTION reject_record_mutation();
--> statement-breakpoint
CREATE TRIGGER preserve_records BEFORE UPDATE OR DELETE ON payroll.audit_logs FOR EACH ROW EXECUTE FUNCTION reject_record_mutation();
--> statement-breakpoint
CREATE TRIGGER preserve_records BEFORE UPDATE OR DELETE ON payroll.payroll_adjustments FOR EACH ROW EXECUTE FUNCTION reject_record_mutation();
--> statement-breakpoint
CREATE FUNCTION validate_segment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s work_sessions;
BEGIN
 SELECT * INTO s FROM work_sessions WHERE id=NEW.work_session_id FOR SHARE;
 IF NEW.calculation_version<>s.calculation_version OR NEW.started_at<s.clock_in_at OR NEW.ended_at>s.clock_out_at
 THEN RAISE EXCEPTION 'segment must match session version and bounds' USING ERRCODE='23514'; END IF;
 IF abs(NEW.duration_minutes-extract(epoch FROM (NEW.ended_at-NEW.started_at))/60)>0.000001
 THEN RAISE EXCEPTION 'segment duration does not match timestamps' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER segment_integrity BEFORE INSERT OR UPDATE ON work_segments FOR EACH ROW EXECUTE FUNCTION validate_segment();
--> statement-breakpoint
CREATE FUNCTION protect_payroll_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='FINALIZED' THEN RAISE EXCEPTION 'finalized period is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status='FINALIZED' THEN
  IF NOT EXISTS (SELECT 1 FROM payroll.payroll_calculations WHERE payroll_period_id=OLD.id)
    OR EXISTS (SELECT 1 FROM payroll.payroll_calculations WHERE payroll_period_id=OLD.id AND status<>'FINALIZED')
  THEN RAISE EXCEPTION 'period requires finalized calculations' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER period_immutability BEFORE UPDATE OR DELETE ON payroll.payroll_periods FOR EACH ROW EXECUTE FUNCTION protect_payroll_period();
--> statement-breakpoint
CREATE FUNCTION protect_payroll_calculation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE period_status text; contract_policy text; comparison_policy text; allowance numeric;
BEGIN
 IF TG_OP<>'INSERT' AND OLD.status='FINALIZED' THEN
  RAISE EXCEPTION 'finalized calculation is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.payroll_period_id<>OLD.payroll_period_id THEN
  RAISE EXCEPTION 'calculation period cannot change' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN
  SELECT status INTO period_status FROM payroll.payroll_periods WHERE id=OLD.payroll_period_id FOR UPDATE;
 ELSE
  SELECT status INTO period_status FROM payroll.payroll_periods WHERE id=NEW.payroll_period_id FOR UPDATE;
 END IF;
 IF period_status='FINALIZED' THEN RAISE EXCEPTION 'period is finalized' USING ERRCODE='23514'; END IF;
 IF TG_OP<>'DELETE' THEN
  SELECT allocation_policy,allowance_comparison_policy,fixed_overtime_allowance INTO contract_policy,comparison_policy,allowance FROM payroll.compensation_contracts WHERE id=NEW.contract_id FOR SHARE;
  IF (contract_policy='UNDECIDED' OR comparison_policy='UNDECIDED' OR allowance IS NULL) AND (NEW.status<>'UNRESOLVED' OR NEW.additional_overtime_pay IS NOT NULL OR NEW.total_calculated_pay IS NOT NULL)
  THEN RAISE EXCEPTION 'contract policy is unresolved' USING ERRCODE='23514'; END IF;
  IF NEW.status='FINALIZED' AND NOT EXISTS (SELECT 1 FROM payroll.payroll_line_items WHERE payroll_calculation_id=NEW.id)
  THEN RAISE EXCEPTION 'finalization requires line items' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER calculation_immutability BEFORE INSERT OR UPDATE OR DELETE ON payroll.payroll_calculations FOR EACH ROW EXECUTE FUNCTION protect_payroll_calculation();
--> statement-breakpoint
CREATE FUNCTION protect_payroll_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE calculation_status text; calculation_employee text; segment_employee text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.payroll_calculation_id<>OLD.payroll_calculation_id THEN RAISE EXCEPTION 'line calculation cannot change' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN
  SELECT status INTO calculation_status FROM payroll.payroll_calculations WHERE id=OLD.payroll_calculation_id FOR UPDATE;
 ELSE
  SELECT status,employee_id INTO calculation_status,calculation_employee FROM payroll.payroll_calculations WHERE id=NEW.payroll_calculation_id FOR UPDATE;
  IF NEW.work_segment_id IS NOT NULL THEN
   SELECT employee_id INTO segment_employee FROM work_segments WHERE id=NEW.work_segment_id FOR SHARE;
   IF segment_employee<>calculation_employee THEN RAISE EXCEPTION 'line employee mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF calculation_status='FINALIZED' THEN RAISE EXCEPTION 'finalized line is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER line_immutability BEFORE INSERT OR UPDATE OR DELETE ON payroll.payroll_line_items FOR EACH ROW EXECUTE FUNCTION protect_payroll_line();
--> statement-breakpoint
CREATE FUNCTION protect_referenced_segment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM payroll.payroll_line_items WHERE work_segment_id=OLD.id) THEN
 RAISE EXCEPTION 'payroll source segment is immutable; create a new version' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER segment_preservation BEFORE UPDATE OR DELETE ON work_segments FOR EACH ROW EXECUTE FUNCTION protect_referenced_segment();
--> statement-breakpoint
CREATE INDEX employees_department_id_idx ON employees (department_id);
--> statement-breakpoint
CREATE INDEX attendance_events_work_session_id_idx ON attendance_events (work_session_id);
--> statement-breakpoint
CREATE INDEX work_segments_work_session_id_idx ON work_segments (work_session_id);
--> statement-breakpoint
CREATE INDEX attendance_corrections_event_id_idx ON attendance_corrections (event_id);
--> statement-breakpoint
CREATE INDEX leave_records_employee_id_idx ON leave_records (employee_id, start_at);
--> statement-breakpoint
CREATE INDEX payroll_calculations_contract_id_idx ON payroll.payroll_calculations (contract_id);
--> statement-breakpoint
CREATE INDEX payroll_line_items_payroll_calculation_id_idx ON payroll.payroll_line_items (payroll_calculation_id);
--> statement-breakpoint
CREATE INDEX payroll_line_items_work_segment_id_idx ON payroll.payroll_line_items (work_segment_id);
--> statement-breakpoint
CREATE INDEX payroll_adjustments_payroll_calculation_id_idx ON payroll.payroll_adjustments (payroll_calculation_id);
--> statement-breakpoint
CREATE INDEX audit_logs_actor_id_idx ON payroll.audit_logs (actor_id, occurred_at);
