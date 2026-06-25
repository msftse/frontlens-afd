"use client";

import { useSyncExternalStore } from "react";

/**
 * Two related signals about the active data source:
 *
 *  1. The source the BFF *reported* serving on the last `/api/query` response
 *     (`{ data, source }`) — the truthful badge value.
 *  2. The source the user *selected* via the Demo/Live toggle — sent on every
 *     subsequent request and folded into the react-query cache key so switching
 *     refetches instead of returning another source's cached rows.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

/** Record the source reported by the server. No-op if unchanged. */
export function reportDataSource(name: string | undefined): void {
  if (!name || name === current) return;
  current = name;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactively read the most recent source the server reported (null until one arrives). */
export function useReportedDataSource(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

// ---------------------------------------------------------------------------
// Selected source (the toggle) — drives request bodies + cache keys.
// Persisted to localStorage so the choice survives navigation between pages and
// full reloads, instead of resetting to the default every time the route changes.
// ---------------------------------------------------------------------------
const STORAGE_KEY = "frontlens.source";

function readPersistedSource(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

let selected: string | null = readPersistedSource();
const selListeners = new Set<() => void>();

/** Set the source the user picked (e.g. from the header toggle) and persist it. */
export function setSelectedSource(name: string | null): void {
  const v = name || null;
  if (v === selected) return;
  selected = v;
  if (typeof window !== "undefined") {
    try {
      if (v) window.localStorage.setItem(STORAGE_KEY, v);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota / disabled storage */
    }
  }
  for (const l of selListeners) l();
}

/** The currently selected source name, or null for the server default. */
export function getSelectedSource(): string | null {
  return selected;
}

function selSubscribe(cb: () => void): () => void {
  selListeners.add(cb);
  return () => {
    selListeners.delete(cb);
  };
}

/** Reactively read the selected source — use in react-query keys so toggling refetches. */
export function useSelectedSource(): string | null {
  return useSyncExternalStore(
    selSubscribe,
    () => selected,
    () => null,
  );
}
