"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { otpRequestSchema, type DepartmentDTO, type PublicQueueDTO } from "@smartopd/shared";
import { api, getDepartments, randomId } from "@/lib/api";
import { cn } from "@/lib/cn";
import { command, useLive } from "@/lib/realtime";
import { CONTAINER } from "@/lib/layout";
import {PublicHeader} from "@/components/brand";
import { Button, DotText, Field, LedPanel, PanelLabel, Segmented } from "@/components/ui";

type Errors = Partial<Record<"name" | "phone" | "age" | "email" | "dept", string>>;
interface Challenge { challengeId: string; demoCode: string }

function DeptCard({ dept, selected, onSelect }: { dept: DepartmentDTO; selected: boolean; onSelect: () => void }) {
  const { data: q } = useLive<PublicQueueDTO>({
    join: { event: "join:department", payload: { departmentId: dept.id } },
    events: [{ name: "queue:updated" }],
    restPath: `/queue/${dept.id}`,
  });
  const info = !q ? "Checking the queue…" : q.activeDoctors === 0
    ? `${q.waitingCount} waiting · doctors on break`
    : `${q.waitingCount} waiting · about ${Math.max(1, Math.round((q.waitingCount + 1) * q.avgConsultMinutes / q.activeDoctors))} min if you join now`;
  return (
    <label className="block">
      <input type="radio" name="dept" value={dept.id} checked={selected} onChange={onSelect} className="peer sr-only" />
      <span className="flex min-h-[4.5rem] cursor-pointer items-center gap-4 rounded-lg border-2 border-ink-3 bg-white px-4 py-3 peer-checked:border-act peer-checked:bg-sheet peer-checked:ring-4 peer-checked:ring-act/25 peer-focus-visible:outline-3 peer-focus-visible:outline-act">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-panel text-sm font-extrabold tracking-wider text-led">{dept.code}</span>
        <span className="min-w-0">
          <span className="block text-lg font-extrabold leading-tight">{dept.name}</span>
          <span className="block text-sm text-ink-2">{info}</span>
        </span>
      </span>
    </label>
  );
}

export default function CheckIn() {
  const router = useRouter();
  const [depts, setDepts] = useState<DepartmentDTO[]>([]);
  const [form, setForm] = useState({ name: "", phone: "", age: "", email: "", dept: "", priority: "NORMAL" as "NORMAL" | "URGENT" });
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState<1 | 2>(1);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const requestId = useRef(randomId());

  const [deptError, setDeptError] = useState<string | null>(null);
  const loadDepts = () => {
    setDeptError(null);
    void getDepartments().then((r) => (r.ok ? setDepts(r.data) : setDeptError("We couldn't load the departments. The hospital system may be starting up.")));
  };
  useEffect(loadDepts, []);

  const validate = (): boolean => {
    const e: Errors = {};
    if (form.name.trim().length < 2) e.name = "Enter your full name (at least 2 letters).";
    if (!otpRequestSchema.safeParse({ phone: form.phone }).success) e.phone = "Enter a 10-digit mobile number starting with 6, 7, 8 or 9.";
    if (form.age !== "" && !(Number(form.age) >= 0 && Number(form.age) <= 120)) e.age = "Age should be between 0 and 120.";
    if (form.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "Enter a valid email address, or leave it empty.";
    if (!form.dept) e.dept = "Pick the department you're visiting.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const sendCode = async () => {
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    const r = await api<Challenge>("/otp/request", { method: "POST", json: { phone: form.phone } });
    setBusy(false);
    if (!r.ok) return setFormError(r.error.message);
    setChallenge(r.data); setCode(""); setStep(2);
    requestId.current = randomId();
  };

  const verify = async () => {
    setFormError(null);
    if (!/^\d{4}$/.test(code) || !challenge) return setFormError("Enter the 4-digit code shown on the screen.");
    setBusy(true);
    const r = await command<{ tokenId: string }>("token:create", {
      name: form.name.trim(), phone: form.phone, age: form.age === "" ? undefined : Number(form.age), email: form.email.trim() === "" ? undefined : form.email.trim(),
      departmentId: form.dept, priority: form.priority, otpChallengeId: challenge.challengeId, otpCode: code,
    }, requestId.current);
    setBusy(false);
    if (!r.ok) { requestId.current = randomId(); return setFormError(r.error.message); }
    router.push(`/token/${r.data.tokenId}`);
  };

  return (
    <>
      <PublicHeader />
      <main className={cn(CONTAINER, "max-w-[640px] py-8 sm:py-12")}>
        <h1 className="text-3xl font-extrabold tracking-tight">{step === 1 ? "Get your token" : "Confirm your number"}</h1>
        <p className="mt-2 text-base text-ink-2">{step === 1 ? "Takes about a minute. Demo hospital: please use made-up details." : `We sent a code to +91 ${form.phone}.`}</p>

        {step === 1 ? (
          <form className="mt-8 space-y-6" noValidate onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
            <Field label="Full name" autoComplete="name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field
              label="Mobile number" prefix="+91" inputMode="numeric" autoComplete="tel-national" maxLength={10} value={form.phone} error={errors.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
            />
            <Field label="Age (optional)" inputMode="numeric" className="max-w-40" value={form.age} error={errors.age} onChange={(e) => setForm({ ...form, age: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            <Field
              label="Email for alerts (optional)" type="email" inputMode="email" autoComplete="email" value={form.email} error={errors.email}
              hint="Want an email when you're 2nd in line and when you're next? Add it here. We use it only for these alerts."
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <fieldset>
              <legend className="mb-2 text-base font-bold">Department</legend>
              <div className="space-y-2.5">{depts.map((d) => <DeptCard key={d.id} dept={d} selected={form.dept === d.id} onSelect={() => setForm({ ...form, dept: d.id })} />)}</div>
              {deptError && (
                <div role="alert" className="rounded-lg border-2 border-crit-text bg-crit-tint p-3 text-crit-text">
                  <p className="font-bold">{deptError}</p>
                  <Button variant="secondary" className="mt-2" onClick={loadDepts}>Try again</Button>
                </div>
              )}
              {errors.dept && <p className="mt-1.5 text-sm font-bold text-crit-text">{errors.dept}</p>}
            </fieldset>
            <div>
              <p className="mb-2 text-base font-bold" id="prio-label">How urgent is it?</p>
              <Segmented name="priority" label="How urgent is it?" size="lg" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={[{ value: "NORMAL", label: "Routine" }, { value: "URGENT", label: "Urgent" }]} />
              <p className="mt-2 flex gap-2 text-sm text-ink-2"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />A nurse re-checks urgency at the desk. For chest pain, trouble breathing or heavy bleeding, go to Casualty now.</p>
            </div>
            {formError && <p role="alert" className="font-bold text-crit-text">{formError}</p>}
            <Button type="submit" size="xl" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send code"}</Button>
          </form>
        ) : (
          <form className="mt-8 space-y-6" noValidate onSubmit={(e) => { e.preventDefault(); void verify(); }}>
            <LedPanel className="p-5" aria-label="Demo SMS">
              <PanelLabel>Demo SMS · not actually sent</PanelLabel>
              <p className="mt-3 text-sm text-led-ink">Your code is</p>
              <DotText value={challenge?.demoCode ?? ""} className="mt-1 block text-6xl" />
            </LedPanel>
            <Field
              label="4-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code}
              inputClassName="text-center text-3xl font-extrabold tracking-[0.5em]" onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            {formError && <p role="alert" className="font-bold text-crit-text">{formError}</p>}
            <Button type="submit" size="xl" className="w-full" disabled={busy || code.length !== 4}>{busy ? "Getting your token…" : "Verify and get token"}</Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="quiet" onClick={() => { setStep(1); setFormError(null); }}>Change details</Button>
              <Button variant="quiet" onClick={() => void sendCode()} disabled={busy}>Send a new code</Button>
            </div>
          </form>
        )}
      </main>
    </>
  );
}
