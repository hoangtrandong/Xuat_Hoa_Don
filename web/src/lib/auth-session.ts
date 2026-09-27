"use client";

import { useSyncExternalStore } from "react";

export const AUTH_EXPIRED_EVENT = "dms:auth-expired";
const AUTH_SESSION_CHANGED_EVENT = "dms:auth-session-changed";
const ACCESS_TOKEN_KEY = "dms-access-token";
const USERNAME_KEY = "dms-username";
const SERVER_SNAPSHOT = "server";

interface AuthSnapshot {
  ready: boolean;
  token: string | null;
  username: string;
}

function getSnapshot(): string {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  return JSON.stringify({
    ready: true,
    token: window.sessionStorage.getItem(ACCESS_TOKEN_KEY),
    username: window.sessionStorage.getItem(USERNAME_KEY) || "",
  });
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(AUTH_SESSION_CHANGED_EVENT, onStoreChange);
  return () => window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, onStoreChange);
}

function emitChange() {
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
}

export function useAuthSession(): AuthSnapshot {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SERVER_SNAPSHOT,
  );
  return snapshot === SERVER_SNAPSHOT
    ? { ready: false, token: null, username: "" }
    : JSON.parse(snapshot) as AuthSnapshot;
}

export function getStoredAccessToken(): string | null {
  return typeof window === "undefined"
    ? null
    : window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function saveAuthSession(token: string, username: string): void {
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  window.sessionStorage.setItem(USERNAME_KEY, username);
  emitChange();
}

export function clearAuthSession(expired = false): void {
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  window.sessionStorage.removeItem(USERNAME_KEY);
  emitChange();
  if (expired) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}
