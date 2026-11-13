"use client";
import { useEffect, useRef } from "react";
import { ConfigurationEditor, type ConfigurationRequest } from "./editor";
export function ConfigurationDialog({ request, onClose, onSaved }: { request: ConfigurationRequest | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = request ? ({ "department.save": "부서", "employee.create": "직원", "employee.save": "직원", "employee.status": "계정 상태", "password.reset": "비밀번호", "workplace.save": "근무지", "policy.create": "근무 정책", "policy.assign": "정책 배정" }[request.action] + (request.id || request.name || request.employeeId ? " 수정" : " 추가")) : "";
  useEffect(() => { if (request && !dialog.current?.open) dialog.current?.showModal(); }, [request]);
  return <dialog ref={dialog} className="ws-config-dialog" aria-label={title} onClose={onClose}>
    {request && <>
      <div className="ws-config-dialog-header"><h2>{title}</h2><button type="button" onClick={() => dialog.current?.close()}>닫기</button></div>
      <ConfigurationEditor key={JSON.stringify(request)} request={request} onSaved={onSaved} />
    </>}
  </dialog>;
}
