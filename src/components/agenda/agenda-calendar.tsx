"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DateSelectArg, DatesSetArg, EventClickArg, EventContentArg, EventDropArg, EventInput } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { ChevronLeft, ChevronRight, Clock, Home, Loader2, Plus, Settings2, Store, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label, Select } from "@/components/ui/input";
import { fetchCalendarAction, rescheduleAction, type CalendarBackground, type CalendarEvent } from "@/server/actions/agenda";
import { STATUS_LABELS, isEditable, type AppointmentStatus } from "@/lib/domain/appointments";
import { cn } from "@/lib/utils";

type ViewKey = "day" | "week" | "month";
type StatusFilter = "active" | "all" | AppointmentStatus;
type PlaceFilter = "all" | "home" | "salon";

const VIEW_IDS: Record<ViewKey, { desktop: string; mobile: string }> = {
  day: { desktop: "timeGridDay", mobile: "timeGridDay" },
  week: { desktop: "timeGridWeek", mobile: "listWeek" },
  month: { desktop: "dayGridMonth", mobile: "dayGridMonth" },
};

function useIsDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

export function AgendaCalendar({
  timeZone,
  hasRules,
  initialDate,
  staticData,
}: {
  timeZone: string;
  hasRules: boolean;
  initialDate?: string;
  /** Aperçu local uniquement : données fixes, sans appel serveur. */
  staticData?: { events: CalendarEvent[]; backgrounds: CalendarBackground[] };
}) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<ViewKey>("week");
  const [title, setTitle] = useState("");
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [backgrounds, setBackgrounds] = useState<CalendarBackground[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [place, setPlace] = useState<PlaceFilter>("all");

  const api = () => calendarRef.current?.getApi();

  const load = useCallback(async (start: string, end: string) => {
    if (staticData) {
      setEvents(staticData.events);
      setBackgrounds(staticData.backgrounds);
      return;
    }
    setLoading(true);
    const res = await fetchCalendarAction(start, end);
    setLoading(false);
    if (res.error) setMessage({ type: "error", text: res.error });
    setEvents(res.events);
    setBackgrounds(res.backgrounds);
  }, [staticData]);

  useEffect(() => {
    api()?.changeView(isDesktop ? VIEW_IDS[view].desktop : VIEW_IDS[view].mobile);
  }, [view, isDesktop]);

  // Synchronisation : les réservations en ligne apparaissent sans recharger la page
  // (actualisation toutes les 60 s et au retour sur l'onglet).
  useEffect(() => {
    if (!range || staticData) return;
    const refreshNow = () => {
      if (document.visibilityState === "visible") void load(range.start, range.end);
    };
    const timer = window.setInterval(refreshNow, 60_000);
    document.addEventListener("visibilitychange", refreshNow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, [range, load, staticData]);

  const onDatesSet = (arg: DatesSetArg) => {
    setTitle(arg.view.title);
    if (range && range.start === arg.startStr && range.end === arg.endStr) return;
    setRange({ start: arg.startStr, end: arg.endStr });
    void load(arg.startStr, arg.endStr);
  };

  const visible = useMemo(
    () =>
      events.filter((e) => {
        if (status === "active" && (e.status === "cancelled" || e.status === "no_show")) return false;
        if (status !== "active" && status !== "all" && e.status !== status) return false;
        if (place !== "all" && e.place !== place) return false;
        return true;
      }),
    [events, status, place],
  );

  const fcEvents: EventInput[] = useMemo(
    () => [
      ...backgrounds.map((b, i) => ({
        id: `bg-${i}`,
        start: b.start,
        end: b.end,
        display: "background",
        classNames: [`moka-bg-${b.kind}`],
        title: b.kind === "blocked" ? b.label ?? "Bloqué" : "",
      })),
      ...visible.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        editable: isDesktop && isEditable(e.status),
        classNames: [`moka-ev-${e.place}`, `moka-ev-${e.status}`],
        extendedProps: e,
      })),
    ],
    [backgrounds, visible, isDesktop],
  );

  async function move(arg: EventDropArg | EventResizeDoneArg) {
    const start = arg.event.start;
    const end = arg.event.end;
    if (!start || !end) return arg.revert();
    const duration = Math.round((end.getTime() - start.getTime()) / 60000);
    setMessage(null);
    const res = await rescheduleAction(arg.event.id, start.toISOString(), "endDelta" in arg ? duration : undefined);
    if (!res.ok) {
      arg.revert();
      setMessage({ type: "error", text: res.error ?? "Déplacement impossible." });
    } else {
      setMessage({ type: "success", text: "Rendez-vous déplacé." });
      if (range) void load(range.start, range.end);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!hasRules && (
        <FormAlert type="info">
          Vos horaires ne sont pas encore configurés : aucun rendez-vous ne peut être pris.{" "}
          <Link href="/agenda/disponibilites" className="font-semibold text-primary underline">
            Configurer mes horaires
          </Link>
        </FormAlert>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-10" onClick={() => api()?.prev()} aria-label="Période précédente">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" className="size-10" onClick={() => api()?.next()} aria-label="Période suivante">
              <ChevronRight />
            </Button>
            <Button variant="outline" size="sm" className="h-10" onClick={() => api()?.today()}>
              Aujourd&apos;hui
            </Button>
          </div>
          <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold capitalize sm:text-xl" aria-live="polite">
            {title}
            {loading && <Loader2 className="ml-2 inline size-4 animate-spin text-muted-foreground" aria-label="Chargement" />}
          </h2>
          <div className="flex rounded-full bg-secondary p-1" role="group" aria-label="Vue">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", view === v ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {v === "day" ? "Jour" : v === "week" ? "Semaine" : "Mois"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-36 flex-col gap-1">
            <Label htmlFor="f-status" className="text-xs">
              Statut
            </Label>
            <Select id="f-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9 text-sm">
              <option value="active">Prévus et terminés</option>
              <option value="all">Tous (annulés compris)</option>
              {(Object.keys(STATUS_LABELS) as AppointmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex min-w-36 flex-col gap-1">
            <Label htmlFor="f-place" className="text-xs">
              Lieu
            </Label>
            <Select id="f-place" value={place} onChange={(e) => setPlace(e.target.value as PlaceFilter)} className="h-9 text-sm">
              <option value="all">Domicile et institut</option>
              <option value="home">À domicile</option>
              <option value="salon">En institut</option>
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href="/tournees">
                <Route /> Mes tournées
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link href="/agenda/disponibilites">
                <Settings2 /> Horaires
              </Link>
            </Button>
            <Button asChild size="sm" className="h-9">
              <Link href="/agenda/nouveau">
                <Plus /> Rendez-vous
              </Link>
            </Button>
          </div>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Légende">
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border-l-4 border-brand bg-accent" /> À domicile
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border-l-4 border-ink bg-secondary" /> En institut
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-dashed border-muted-foreground" /> En attente
          </li>
          <li className="flex items-center gap-1.5">
            <span className="moka-legend-blocked size-3 rounded-sm" /> Bloqué
          </li>
          {isDesktop && <li>Glissez un rendez-vous pour le déplacer.</li>}
        </ul>
      </div>

      {message && <FormAlert type={message.type}>{message.text}</FormAlert>}

      <div className="moka-calendar rounded-2xl border border-border bg-card p-2 sm:p-3">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          locale={frLocale}
          timeZone={timeZone}
          initialView={VIEW_IDS.week.desktop}
          initialDate={initialDate}
          headerToolbar={false}
          height="auto"
          expandRows
          nowIndicator
          allDaySlot={false}
          slotMinTime="07:00:00"
          slotMaxTime="21:00:00"
          slotDuration="00:15:00"
          slotLabelInterval="01:00"
          snapDuration="00:15:00"
          firstDay={1}
          weekNumbers={false}
          dayMaxEvents={3}
          selectable={isDesktop}
          selectMirror
          longPressDelay={350}
          eventDurationEditable={isDesktop}
          events={fcEvents}
          datesSet={onDatesSet}
          select={(arg: DateSelectArg) => {
            if (arg.view.type === "dayGridMonth") return;
            router.push(`/agenda/nouveau?debut=${encodeURIComponent(arg.startStr)}`);
          }}
          dateClick={(arg) => {
            if (arg.view.type === "dayGridMonth") {
              setView("day");
              api()?.gotoDate(arg.date);
            } else if (!isDesktop) {
              router.push(`/agenda/nouveau?debut=${encodeURIComponent(arg.dateStr)}`);
            }
          }}
          eventClick={(arg: EventClickArg) => {
            if (arg.event.display === "background") return;
            arg.jsEvent.preventDefault();
            router.push(`/agenda/${arg.event.id}`);
          }}
          eventDrop={move}
          eventResize={move}
          eventContent={renderEvent}
          noEventsContent="Aucun rendez-vous sur cette période."
        />
      </div>
    </div>
  );
}

function renderEvent(arg: EventContentArg) {
  if (arg.event.display === "background") {
    return arg.event.title ? <span className="moka-bg-label">{arg.event.title}</span> : null;
  }
  const e = arg.event.extendedProps as CalendarEvent;
  const Icon = e.place === "home" ? Home : Store;
  const inactive = e.status !== "pending" && e.status !== "confirmed";
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden px-1 py-0.5 text-[12px] leading-tight">
      <span className="flex items-center gap-1 font-semibold">
        <Icon className="size-3 shrink-0" aria-label={e.place === "home" ? "À domicile" : "En institut"} />
        <span className="truncate">{e.customer}</span>
      </span>
      <span className="truncate">{arg.event.title}</span>
      {arg.timeText && (
        <span className="flex items-center gap-1 opacity-75">
          <Clock className="size-3" /> {arg.timeText}
        </span>
      )}
      {(inactive || e.status === "pending") && <span className="truncate text-[11px] font-semibold uppercase">{STATUS_LABELS[e.status]}</span>}
    </div>
  );
}
