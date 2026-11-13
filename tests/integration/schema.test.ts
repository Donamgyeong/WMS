import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import type { PoolClient } from "pg";
import { testPool } from "../fixtures";
const pool = testPool();
let db: PoolClient;
let employee: string;
const key = () => randomUUID();
async function rejected(query: string, code = "23514") {
  await db.query("SAVEPOINT invalid_input");
  await expect(db.query(query)).rejects.toMatchObject({ code });
  await db.query("ROLLBACK TO SAVEPOINT invalid_input");
}
beforeAll(async () => { await pool.query("SELECT 1"); });
beforeEach(async () => {
  db = await pool.connect();
  await db.query("BEGIN");
  employee = key();
  await db.query("INSERT INTO auth_users(id,name,email) VALUES ($1,'schema test',$2)",[employee,`${employee}@example.com`]);
  await db.query("INSERT INTO employees(id,user_id) VALUES ($1,$1)",[employee]);
  await db.query("INSERT INTO work_policies(id,name,version,effective_from) VALUES ('schema-policy','schema-policy',1,'2026-01-01')");
});
afterEach(async () => { await db.query("ROLLBACK"); db.release(); });
afterAll(async () => { await pool.end(); });
async function session() {
  await db.query(`INSERT INTO work_sessions(id,employee_id,work_date,clock_in_at,clock_out_at,calculation_version,work_policy_id,input_snapshot,status,actual_work_minutes,break_minutes,required_work_minutes)
    VALUES ('schema-session',$1,'2026-11-13','2026-11-13T08:00:00+09','2026-11-13T17:00:00+09',1,'schema-policy','{}','COMPLETE',480,60,480)`,[employee]);
}
async function contract() {
  await db.query("INSERT INTO payroll.compensation_contracts(id,employee_id,effective_from) VALUES ('schema-contract',$1,'2026-01-01')",[employee]);
}
async function calculation() {
  await contract();
  await db.query("INSERT INTO payroll.payroll_periods(id,period_start,period_end) VALUES ('schema-period','2026-11-01','2026-12-01')");
  await db.query(`INSERT INTO payroll.payroll_calculations(id,payroll_period_id,employee_id,contract_id,regular_minutes,overtime_minutes,night_overtime_minutes,included_overtime_minutes,payable_overtime_minutes,regular_pay,calculation_version,unresolved_reasons,input_snapshot)
    VALUES ('schema-calc','schema-period',$1,'schema-contract',480,1200,60,960,240,80000,1,'["ALLOCATION"]','{}')`,[employee]);
}
describe("ERD physical schema", () => {
  it("has all 23 domain tables in their intended schemas", async () => {
    const { rows } = await db.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema IN ('public','payroll')");
    const names = rows.map(r => `${r.table_schema}.${r.table_name}`);
    for (const table of ["departments","employees","employee_roles","work_policies","employee_policy_assignments","workplaces","workplace_ip_ranges","attendance_events","work_sessions","work_segments","attendance_corrections","leave_records","holiday_calendars","holidays","employee_calendar_assignments","work_schedules"]) expect(names).toContain(`public.${table}`);
    for (const table of ["hourly_rate_histories","compensation_contracts","payroll_periods","payroll_calculations","payroll_line_items","payroll_adjustments","audit_logs"]) expect(names).toContain(`payroll.${table}`);
  });
  it("rejects overlapping effective ranges but allows adjacent dates", async () => {
    await db.query("INSERT INTO payroll.hourly_rate_histories(id,employee_id,hourly_rate,effective_from,effective_to) VALUES ('r1',$1,10000,'2026-01-01','2026-02-01')",[employee]);
    await rejected(`INSERT INTO payroll.hourly_rate_histories VALUES ('r2','${employee}',12000,'2026-01-31',NULL)`,'23P01');
    await db.query("INSERT INTO payroll.hourly_rate_histories VALUES ('r3',$1,12000,'2026-02-01',NULL)",[employee]);
    await rejected(`INSERT INTO employee_policy_assignments VALUES ('a','${employee}','schema-policy','2026-02-01','2026-01-01')`);
  });
  it("rejects overlapping contracts and policy assignments", async () => {
    await contract();
    await rejected(`INSERT INTO payroll.compensation_contracts(id,employee_id,effective_from) VALUES ('c2','${employee}','2026-02-01')`,'23P01');
    await db.query("INSERT INTO employee_policy_assignments VALUES ('a1',$1,'schema-policy','2026-01-01',NULL)",[employee]);
    await rejected(`INSERT INTO employee_policy_assignments VALUES ('a2','${employee}','schema-policy','2026-02-01',NULL)`,'23P01');
  });
  it("validates GPS coordinates and native CIDR", async () => {
    await rejected("INSERT INTO workplaces VALUES ('w','invalid',91,127,100)");
    await db.query("INSERT INTO workplaces VALUES ('w','office',37.5,127,100)");
    await rejected("INSERT INTO workplace_ip_ranges VALUES ('ip','w','invalid')",'22P02');
    await db.query("INSERT INTO workplace_ip_ranges VALUES ('ip','w','192.168.1.0/24')");
  });
  it("preserves raw events and prevents duplicate requests", async () => {
    await db.query(`INSERT INTO attendance_events(id,employee_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id)
      VALUES ('e',$1,'CLOCK_IN',now(),'PC','ACCEPTED','{}','request')`,[employee]);
    await rejected("UPDATE attendance_events SET occurred_at=now() WHERE id='e'");
    await rejected("DELETE FROM attendance_events WHERE id='e'");
    await rejected(`INSERT INTO attendance_events(id,employee_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id) VALUES ('e2','${employee}','CLOCK_IN',now(),'PC','ACCEPTED','{}','request')`,'23505');
  });
  it("rejects overlapping segments, wrong versions and incorrect duration", async () => {
    await session();
    const insert = (id: string, start: string, end: string, duration: number, version = 1) => `INSERT INTO work_segments VALUES ('${id}','schema-session','${employee}','2026-11-13T${start}+09','2026-11-13T${end}+09',${duration},false,false,false,NULL,${version})`;
    await db.query(insert('s1','08:00','09:00',60));
    await rejected(insert('s2','08:30','09:30',60),'23P01');
    await db.query(insert('s3','09:00','10:00',60));
    await rejected(insert('s4','10:00','11:00',59));
    await rejected(insert('s5','10:00','11:00',60,2));
  });
  it("keeps unresolved money null while preserving actual and included overtime", async () => {
    await calculation();
    const {rows:[row]} = await db.query("SELECT * FROM payroll.payroll_calculations WHERE id='schema-calc'");
    expect(Number(row.overtime_minutes)).toBe(1200);
    expect(Number(row.included_overtime_minutes)).toBe(960);
    expect(Number(row.payable_overtime_minutes)).toBe(240);
    expect(row.additional_overtime_pay).toBeNull();
    expect(row.total_calculated_pay).toBeNull();
    await rejected("UPDATE payroll.payroll_calculations SET additional_overtime_pay=0,total_calculated_pay=80000,status='CALCULATED',unresolved_reasons='[]' WHERE id='schema-calc'");
    await rejected("UPDATE payroll.payroll_periods SET status='FINALIZED',finalized_at=now() WHERE id='schema-period'");
  });
  it("locks finalized calculations, lines, periods and retains adjustment history", async () => {
    await calculation();
    // Test-only policy names; no production policy or seed is decided by this fixture.
    await db.query("UPDATE payroll.compensation_contracts SET allocation_policy='TEST_ONLY',allowance_comparison_policy='TEST_ONLY',fixed_overtime_allowance=100000 WHERE id='schema-contract'");
    await db.query("INSERT INTO payroll.payroll_line_items(id,payroll_calculation_id,duration_minutes,hourly_rate,basis_snapshot) VALUES ('line','schema-calc',480,10000,'{}')");
    await rejected("UPDATE payroll.payroll_calculations SET status='FINALIZED',additional_overtime_pay=10000,total_calculated_pay=90000,unresolved_reasons='[]' WHERE id='schema-calc'");
    await db.query("UPDATE payroll.payroll_line_items SET multiplier=1,gross_amount=80000,included_minutes=0,payable_minutes=480,additional_amount=0 WHERE id='line'");
    await db.query("UPDATE payroll.payroll_calculations SET status='FINALIZED',additional_overtime_pay=10000,total_calculated_pay=90000,unresolved_reasons='[]' WHERE id='schema-calc'");
    await db.query("UPDATE payroll.payroll_periods SET status='FINALIZED',finalized_at=now() WHERE id='schema-period'");
    await rejected("UPDATE payroll.payroll_calculations SET regular_pay=0 WHERE id='schema-calc'");
    await rejected("DELETE FROM payroll.payroll_line_items WHERE id='line'");
    await rejected("UPDATE payroll.payroll_periods SET status='OPEN',finalized_at=NULL WHERE id='schema-period'");
    await db.query("INSERT INTO payroll.payroll_adjustments(id,payroll_calculation_id,amount,reason,created_by) VALUES ('adj','schema-calc',1000,'test',$1)",[employee]);
    await rejected("DELETE FROM payroll.payroll_adjustments WHERE id='adj'");
  });
  it("enforces foreign keys, unique schedules and explicit day types", async () => {
    await rejected("INSERT INTO employee_policy_assignments VALUES ('missing','absent','schema-policy','2026-01-01',NULL)",'23503');
    await db.query("INSERT INTO work_schedules(id,employee_id,work_date,day_type,is_work_scheduled) VALUES ('sat',$1,'2026-11-14','WORKDAY',true)",[employee]);
    await rejected(`INSERT INTO work_schedules(id,employee_id,work_date,day_type,is_work_scheduled) VALUES ('dup','${employee}','2026-11-14','DAY_OFF',false)`,'23505');
    await rejected(`INSERT INTO work_schedules(id,employee_id,work_date,day_type,is_work_scheduled) VALUES ('bad','${employee}','2026-11-15','INVALID',false)`);
  });
});
