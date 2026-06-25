"use client";

import { useCallback, useSyncExternalStore } from "react";

export interface SavedView {
  id: string;
  name: string;
  /** nuqs-encoded query string (without leading "?"). */
  search: string;
  createdAt: number;
}

const KEY = "frontlens.savedViews";
const EMPTY: SavedView[] = [];

// Cached snapshot so useSyncExternalStore gets a stable reference until storage changes.
let cache: SavedView[] = EMPTY;
let cacheRaw: string | null = null;

function read(): SavedView[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    try {
      cache = raw ? (JSON.parse(raw) as SavedView[]) : EMPTY;
    } catch {
      cache = EMPTY;
    }
  }
  return cache;
}

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function write(views: SavedView[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    /* ignore quota / unavailable */
  }
  emit();
}

/** Persisted, shareable filter presets (the filter state is the URL). */
export function useSavedViews() {
  const views = useSyncExternalStore(subscribe, read, () => EMPTY);

  const save = useCallback((name: string, search: string) => {
    write([
      { id: Math.random().toString(36).slice(2), name, search, createdAt: Date.now() },
      ...read().filter((v) => v.name !== name),
    ]);
  }, []);

  const remove = useCallback((id: string) => {
    write(read().filter((v) => v.id !== id));
  }, []);

  return { views, save, remove };
}
