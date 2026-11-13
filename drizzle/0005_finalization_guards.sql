-- Finalization serializes through the calculation lock also used by line writes.
CREATE FUNCTION validate_finalized_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='FINALIZED' AND EXISTS (
   SELECT 1 FROM payroll.payroll_line_items WHERE payroll_calculation_id=NEW.id
   AND (multiplier IS NULL OR gross_amount IS NULL OR included_minutes IS NULL
     OR payable_minutes IS NULL OR additional_amount IS NULL
     OR included_minutes+payable_minutes<>duration_minutes)
 ) THEN RAISE EXCEPTION 'unresolved payroll lines cannot be finalized' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER finalized_line_completeness BEFORE INSERT OR UPDATE ON payroll.payroll_calculations FOR EACH ROW EXECUTE FUNCTION validate_finalized_lines();
--> statement-breakpoint
CREATE FUNCTION protect_session_basis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.employee_id,NEW.calculation_version,NEW.clock_in_at,NEW.clock_out_at,NEW.work_policy_id,NEW.input_snapshot)
 IS DISTINCT FROM (OLD.employee_id,OLD.calculation_version,OLD.clock_in_at,OLD.clock_out_at,OLD.work_policy_id,OLD.input_snapshot)
 AND EXISTS (SELECT 1 FROM work_segments WHERE work_session_id=OLD.id)
 THEN RAISE EXCEPTION 'session with segments requires a new calculation version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER session_basis_preservation BEFORE UPDATE ON work_sessions FOR EACH ROW EXECUTE FUNCTION protect_session_basis();
--> statement-breakpoint
ALTER TABLE work_sessions ADD CONSTRAINT complete_session_inputs CHECK (status<>'COMPLETE' OR (clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL AND actual_work_minutes IS NOT NULL AND break_minutes IS NOT NULL AND required_work_minutes IS NOT NULL));
--> statement-breakpoint
ALTER TABLE payroll.payroll_line_items ADD CONSTRAINT line_allocation_total CHECK (included_minutes IS NULL OR payable_minutes IS NULL OR included_minutes+payable_minutes=duration_minutes);
