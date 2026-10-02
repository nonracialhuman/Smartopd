import Link from "next/link";
import { BedDouble, Clock3, Siren } from "lucide-react";
import { CONTAINER } from "@/lib/layout";
import {Footer, PublicHeader} from "@/components/brand";
import { LiveBoard } from "@/components/live-board";
import { TokenRoute } from "@/components/token-route";
import { buttonClass } from "@/lib/button";
import { cn } from "@/lib/cn";

export default function Home() {
  return (
    <>
      <PublicHeader />
      <main>
        <section className={cn(CONTAINER, "grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-14 lg:py-16")}>
          <div>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">Wait for your number, not in the corridor.</h1>
            <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-ink-2">
              Check in from your phone, get a digital token and watch your place in line move in real time. When the doctor calls you, your screen tells you which room to walk to.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/checkin" className={buttonClass("primary", "lg")}>Get a token →</Link>
              <Link href="/beds" className={buttonClass("secondary", "lg")}>Live bed board</Link>
            </div>
            <p className="mt-4 text-base text-ink-2">Works in any phone browser. No app, no account.</p>
          </div>
          <LiveBoard />
        </section>

        <section className="border-t border-rule bg-sheet/60">
          <div className={cn(CONTAINER, "grid gap-10 py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-14")}>
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight">Your token, from check-in to consultation</h2>
              <p className="mt-3 max-w-[34rem] text-lg text-ink-2">One number follows you through the visit. The screen on your phone is the same board the front desk sees.</p>
            </div>
            <div>
              <TokenRoute stops={["Check in", "Wait anywhere", "Called", "Consultation"]} current={1} />
              <ul className="mt-10 grid gap-6 sm:grid-cols-2">
                <li className="flex gap-3">
                  <Siren className="mt-1 size-6 shrink-0 text-ink-2" aria-hidden />
                  <p className="text-base text-ink-2"><strong className="text-ink">Urgent cases move up.</strong> A nurse re-checks urgency at the desk, so the order always follows medical need first.</p>
                </li>
                <li className="flex gap-3">
                  <Clock3 className="mt-1 size-6 shrink-0 text-ink-2" aria-hidden />
                  <p className="text-base text-ink-2"><strong className="text-ink">The wait is an estimate that corrects itself.</strong> It uses how long consultations are really taking today and how many doctors are on duty.</p>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className={cn(CONTAINER, "grid gap-6 py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-14")}>
          <h2 className="text-3xl font-extrabold tracking-tight">For doctors and ward staff</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="text-xl font-extrabold">Doctors</h3>
              <p className="mt-2 text-base text-ink-2">Call the next patient with one large button. A double tap never skips anyone, and urgency can be changed from the queue.</p>
              <Link href="/login?next=/doctor" className={buttonClass("secondary", "md", "mt-4")}>Doctor sign in</Link>
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-xl font-extrabold"><BedDouble className="size-5" aria-hidden />Ward staff</h3>
              <p className="mt-2 text-base text-ink-2">Keep General, ICU and Oxygen bed status current from one grid. The wall board changes in the same second.</p>
              <Link href="/login?next=/admin" className={buttonClass("secondary", "md", "mt-4")}>Ward console sign in</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
