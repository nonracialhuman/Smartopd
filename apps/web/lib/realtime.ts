"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import type { Ack } from "@smartopd/shared";
import { api, randomId } from "./api";

const URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000";

let socket: Socket | null = null;
let epoch = 0;
const subs = new Set<() => void>();
const emitChange = () => subs.forEach((f) => f());

/** One socket per tab. The auth callback fetches a fresh short-lived ticket on every (re)connect. */
export function getSocket(): Socket {
  if (typeof window === "undefined") throw new Error("getSocket is client-only");
  if (!socket) {
    socket = io(URL, {
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      auth: (cb) => {
        fetch("/api/auth/socket-ticket", { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => cb(j?.ok && j.data.ticket ? { token: j.data.ticket } : {}))
          .catch(() => cb({}));
      },
    });
  }
  return socket;
}

/** Call after login/logout so the socket reconnects with (or without) a staff ticket. */
export function resetSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  epoch++;
  emitChange();
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function useSocket(): Socket | null {
  const e = useSyncExternalStore(subscribe, () => epoch, () => 0);
  const [s, setS] = useState<Socket | null>(null);
  useEffect(() => { setS(getSocket()); }, [e]);
  return s;
}

export type ConnectionState = "live" | "connecting" | "reconnecting" | "offline";

export function useConnection(): ConnectionState {
  const socket = useSocket();
  const [state, setState] = useState<ConnectionState>("connecting");
  useEffect(() => {
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let everConnected = false;
    const up = () => { everConnected = true; clearTimeout(timer); setState("live"); };
    const down = () => {
      setState(everConnected ? "reconnecting" : "connecting");
      clearTimeout(timer);
      timer = setTimeout(() => setState("offline"), 8000);
    };
    if (socket.connected) up(); else down();
    socket.on("connect", up);
    socket.on("disconnect", down);
    socket.on("connect_error", down);
    return () => { clearTimeout(timer); socket.off("connect", up); socket.off("disconnect", down); socket.off("connect_error", down); };
  }, [socket]);
  return state;
}

export interface LiveEvent<T> {
  name: string;
  map?: (incoming: any, current: T | null) => T | null;
}

export function useLive<T extends { seq: number }>(opts: {
  join: { event: string; payload?: unknown } | null;
  events: LiveEvent<T>[];
  restPath?: string;
}) {
  const socket = useSocket();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(0);
  const dataRef = useRef<T | null>(null);
  const eventsRef = useRef(opts.events);
  eventsRef.current = opts.events;
  const joinKey = JSON.stringify(opts.join);
  const { restPath } = opts;

  const set = useCallback((v: T | null) => {
    dataRef.current = v;
    setData(v);
    setLastUpdate(Date.now());
  }, []);

  // REST: first paint, and a 5 s poll while the socket is down
  useEffect(() => {
    if (!restPath) return;
    let dead = false;
    const pull = async (poll: boolean) => {
      const r = await api<T>(restPath);
      if (dead) return;
      if (r.ok) {
        if (!dataRef.current || r.data.seq >= dataRef.current.seq || poll) { set(r.data); setError(null); }
      } else if (!dataRef.current) setError(r.error.message);
    };
    void pull(false);
    const id = setInterval(() => {
      if (!socket || !socket.connected) { setDegraded(true); void pull(true); }
    }, 5000);
    return () => { dead = true; clearInterval(id); };
  }, [restPath, socket, set]);

  useEffect(() => {
    if (!socket) return;
    const handlers = opts.events.map((ev) => {
      const fn = (incoming: any) => {
        const cur = dataRef.current;
        const next = ev.map ? ev.map(incoming, cur) : (incoming as T);
        if (!next) return;
        if (cur && typeof next.seq === "number" && next.seq < cur.seq) return;
        set(next);
      };
      socket.on(ev.name, fn);
      return [ev.name, fn] as const;
    });
    const join = () => {
      if (!opts.join) return;
      socket.timeout(8000).emit(opts.join.event, opts.join.payload ?? {}, (err: unknown, ack: Ack<T>) => {
        if (err) { setDegraded(true); return; }
        if (ack.ok) { set(ack.data); setError(null); setDegraded(false); }
        else setError(ack.error.message);
      });
    };
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
      handlers.forEach(([n, f]) => socket.off(n, f));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, joinKey, set]);

  return { data, error, degraded, lastUpdate, setData: set };
}

/** Acked socket command with an idempotent REST fallback (same requestId, so a replay is harmless). */
export async function command<T = unknown>(name: string, payload: Record<string, unknown>, requestId: string = randomId()): Promise<Ack<T>> {
  const body = { ...payload, requestId };
  const viaRest = () => api<T>(`/commands/${name}`, { method: "POST", json: body });
  if (typeof window === "undefined") return viaRest();
  const s = getSocket();
  if (!s.connected) return viaRest();
  return new Promise<Ack<T>>((resolve) => {
    s.timeout(8000).emit(name, body, (err: unknown, ack: Ack<T>) => {
      if (err || !ack) void viaRest().then(resolve);
      else resolve(ack);
    });
  });
}

/** Starts at 0 so server and client markup match; every clock must handle now === 0. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
