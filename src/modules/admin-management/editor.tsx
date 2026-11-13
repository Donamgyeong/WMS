"use client";
import { useCallback, useEffect, useState } from "react";
import { LocationPicker } from "./location-picker";
import { roleLabel } from "@/modules/identity/role-labels";
import type { Configuration } from "./service";
type Fields = Record<string, string>;
const actions = {
  "department.save": "부서 등록·수정",
  "employee.create": "직원 계정 발급",
  "employee.save": "직원 정보·권한 수정",
  "employee.status": "계정 활성 상태 변경",
  "password.reset": "임시 비밀번호 재설정",
  "workplace.save": "근무지 등록·수정",
  "policy.create": "정책 새 버전 생성",
  "policy.assign": "직원 정책 배정",
};
export type Action = keyof typeof actions;
export type ConfigurationRequest = { action: Action; id?: string; name?: string; employeeId?: string; workPolicyId?: string };
export function ConfigurationEditor({ request, onSaved }: { request: ConfigurationRequest; onSaved: () => Promise<void> }) {
  const [data, setData] = useState<Configuration>();
  const [action, setAction] = useState<Action>(request.action);
  const [fields, setFields] = useState<Fields>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/configuration", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setData(result);
    setFields({ ...targetFields(result, request.action, request.id ?? ""), ...(request.name ? { name: request.name } : {}), ...(request.employeeId ? { employeeId: request.employeeId } : {}), ...(request.workPolicyId ? { workPolicyId: request.workPolicyId } : {}) });
  }, [request]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  const set = (key: string, value: string) => setFields(f => ({ ...f, [key]: value }));
  const input = (key: string, label: string, type = "text", required = false) => <label>{label}<input name={key} type={type} required={required} value={fields[key] ?? ""} onChange={e => set(key, e.target.value)} autoComplete={type === "password" ? "new-password" : "off"} maxLength={type === "password" ? 128 : 254} /></label>;
  const options = (key: string, label: string, rows: { id: string; name: string }[], required = false) => <label>{label}<select name={key} required={required} value={fields[key] ?? ""} onChange={e => set(key, e.target.value)}><option value="">{required ? "선택하세요" : "없음"}</option>{rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>;
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!data || busy) return;
    setBusy(true); setError(""); setMessage("");
    const body: Record<string, unknown> = { ...fields, id: fields.id || undefined, action, revision: data.revision };
    if (action.startsWith("employee.") && action !== "employee.status") {
      body.roles = (fields.roles ?? "EMPLOYEE").split(",").filter(Boolean);
      body.departmentIds = (fields.roles ?? "EMPLOYEE").split(",").includes("MANAGER") ? (fields.departmentIds ?? "").split(",").filter(Boolean) : [];
    }
    if (action === "employee.status") body.active = fields.active === "true";
    if (action === "workplace.save") body.networks = (fields.networks ?? "").split(/\s+/).filter(Boolean);
    try {
      const response = await fetch("/api/admin/configuration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage("저장했습니다. 본인 계정·권한 변경 시 다시 로그인하세요.");
      await load(); await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "저장에 실패했습니다."); }
    finally { setBusy(false); }
  }
  const people = data?.people ?? [], departments = data?.departments ?? [];
  const employeeForm = action === "employee.save" || action === "employee.create";
  const isManager = (fields.roles ?? "EMPLOYEE").split(",").includes("MANAGER");
  function changeAction(next: Action) {
    setAction(next);
    setFields(data ? targetFields(data, next, request.id ?? "") : {});
    setError(""); setMessage("");
  }
  return <section className="ws-live-card ws-config" aria-label="관리 데이터 편집">
    {request.action === "employee.save" && <div className="ws-config-modes" role="group" aria-label="직원 수정 항목">
      {(["employee.save", "employee.status", "password.reset"] as const).map(mode => <button type="button" key={mode} disabled={busy} aria-label={actions[mode]} aria-pressed={action === mode} onClick={() => changeAction(mode)}>{{ "employee.save": "정보·권한", "employee.status": "계정 상태", "password.reset": "비밀번호" }[mode]}</button>)}
    </div>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data && <form onSubmit={save}>
      <fieldset disabled={busy} className="ws-config-fields" aria-label={actions[action]}>
      {action === "department.save" && <>{input("name", "부서명", "text", true)}{options("parentId", "상위 부서", departments.filter(d => d.id !== fields.id))}{options("managerId", "지정 부서장", people.filter(p => p.active))}</>}
      {employeeForm && <>{input("name", "직원 이름", "text", true)}{action === "employee.create" && <>{input("email", "직원 이메일", "email", true)}{input("password", "임시 비밀번호", "password", true)}</>}{input("employeeNo", "사번")}{options("departmentId", "소속 부서", departments)}{input("hiredAt", "입사일", "date")}{input("terminatedAt", "퇴사일", "date")}<fieldset className="ws-config-choices"><legend>역할</legend><div className="ws-config-choice-list">{["EMPLOYEE", "MANAGER", "ADMIN"].map(role => <label key={role}><input type="checkbox" checked={(fields.roles ?? "EMPLOYEE").split(",").includes(role)} onChange={e => { const roles = new Set((fields.roles ?? "EMPLOYEE").split(",").filter(Boolean)); if (e.target.checked) roles.add(role); else roles.delete(role); setFields(f => ({ ...f, roles: [...roles].join(","), departmentIds: roles.has("MANAGER") ? f.departmentIds ?? "" : "" })); }} />{roleLabel(role)}</label>)}</div></fieldset><fieldset className="ws-config-choices" disabled={!isManager || busy}><legend>부서장 담당 부서</legend><p>{isManager ? "선택한 부서의 지정 부서장으로 반영되며 기존 부서장은 교체됩니다." : "부서장 역할을 선택하면 담당 부서를 고를 수 있습니다."}</p><div className="ws-config-choice-list">{departments.map(d => <label key={d.id}><input type="checkbox" checked={isManager && (fields.departmentIds ?? "").split(",").includes(d.id)} onChange={e => { const ids = new Set((fields.departmentIds ?? "").split(",").filter(Boolean)); if (e.target.checked) ids.add(d.id); else ids.delete(d.id); set("departmentIds", [...ids].join(",")); }} />{d.name}</label>)}</div>{!departments.length && <p>등록된 부서가 없습니다.</p>}</fieldset><p>직원 수정 시 기존 로그인 세션이 종료됩니다. 과거 소속 이력은 이번 관리 범위에 포함되지 않습니다.</p></>}
      {action === "employee.status" && <label>변경할 계정 상태<select required value={fields.active ?? ""} onChange={e => set("active", e.target.value)}><option value="">선택하세요</option><option value="true">활성</option><option value="false">비활성</option></select></label>}
      {action === "password.reset" && <>{input("password", "임시 비밀번호", "password", true)}<p>12~128자. 기존 세션을 종료하고 다음 로그인에서 비밀번호 변경을 요구합니다.</p></>}
      {action === "workplace.save" && <>{input("name", "근무지명", "text", true)}<LocationPicker key={fields.id ?? "new"} latitude={fields.latitude ?? ""} longitude={fields.longitude ?? ""} disabled={busy} onChange={(latitude, longitude) => setFields(f => ({ ...f, latitude, longitude }))} /><label>허용 CIDR (한 줄에 하나)<textarea value={fields.networks ?? ""} onChange={e => set("networks", e.target.value)} /></label><p>GPS 반경 100m 고정. 저장 이후 요청에 적용하며 과거 검증 증거는 보존합니다. CIDR을 비우면 PC 출퇴근이 허용되지 않습니다.</p></>}
      {action === "policy.create" && <>{input("name", "정책명", "text", true)}<label>기존 정책에서 새 버전 생성<select value="" onChange={e => set("name", e.target.value)}><option value="">기존 정책 선택</option>{[...new Set(data.policies.map(p => p.name))].map(name => <option key={name}>{name}</option>)}</select></label><p>확정 근무 규칙으로 새 버전을 생성합니다. 08~10시 출근 · 실근로 480분 · 휴게 60분 · 반차 240분 · 배율 1.0/1.5/2.0. 미정 정책은 유지합니다. 같은 이름의 이전 정책·배정은 새 적용일에 종료하고 대상 직원 배정을 새 버전으로 이어갑니다.</p><p>전환 대상: {data.assignments.filter(a => data.policies.some(p => p.id === a.workPolicyId && p.name === fields.name) && (!a.effectiveTo || a.effectiveTo > (fields.effectiveFrom ?? ""))).map(a => people.find(p => p.id === a.employeeId)?.name ?? a.employeeId).join(", ") || "없음"} · 적용일 {fields.effectiveFrom || "미선택"}</p></>}
      {action === "policy.assign" && <>{options("employeeId", "정책 배정 직원", people.filter(p => p.active), true)}{options("workPolicyId", "배정 정책", data.policies.map(p => ({ id: p.id, name: `${p.name} v${p.version} (${p.effectiveFrom}~${p.effectiveTo ?? "종료 없음"})` })), true)}<p>새 적용 시작일에 걸친 기존 배정은 해당 날짜에 종료됩니다. 새 배정 종료 후 이전 정책이 자동 복원되지 않습니다. 열린 근무와 과거 계산은 변경하지 않습니다.</p></>}
      {action.startsWith("policy.") && <>{input("effectiveFrom", "적용 시작일", "date", true)}{input("effectiveTo", "적용 종료일 (제외)", "date")}<p>내일 이후 적용만 지원합니다. 소급 변경과 자동 재계산은 제공하지 않습니다.</p></>}
      <div className="ws-config-actions"><button type="submit" disabled={busy || (action === "workplace.save" && (!fields.latitude || !fields.longitude))}>{busy ? "저장 중…" : "변경 저장"}</button></div>
      </fieldset>
    </form>}
  </section>;
}

function targetFields(data: Configuration, action: Action, id: string): Fields {
    let values: Fields = { id };
    if (action === "department.save") {
      const d = data.departments.find(d => d.id === id);
      if (d) values = { id, name: d.name, parentId: d.parentId ?? "", managerId: d.managerId ?? "" };
    } else if (action === "workplace.save") {
      const w = data.workplaces.find(w => w.id === id);
      if (w) values = { id, name: w.name, latitude: w.latitude, longitude: w.longitude, networks: data.ranges.filter(r => r.workplaceId === id).map(r => r.ipNetwork).join("\n") };
    } else if (action === "policy.assign") {
      const assignment = data.assignments.find(a => a.id === id);
      if (assignment) values = { employeeId: assignment.employeeId, workPolicyId: assignment.workPolicyId };
    } else {
      const p = data.people.find(p => p.id === id);
      if (p) values = { id, name: p.name, employeeNo: p.employeeNo ?? "", departmentId: p.departmentId ?? "", hiredAt: p.hiredAt ?? "", terminatedAt: p.terminatedAt ?? "", active: String(p.active), roles: data.roles.filter(r => r.employeeId === id).map(r => r.role).join(","), departmentIds: data.managed.filter(m => m.employeeId === id).map(m => m.departmentId).join(",") };
    }
    return values;
}
