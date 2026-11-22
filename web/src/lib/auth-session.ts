"use client";

import { useSyncExternalStore } from "react";

export const AUTH_EXPIRED_EVENT = "dms:auth-expired";
const AUTH_SESSION_CHANGED_EVENT = "dms:auth-session-changed";
const ACCESS_TOKEN_KEY = "dms-access-token";
const USERNAME_KEY = "dms-username";
const FULL_NAME_KEY = "dms-full-name";
const DISTRIBUTOR_ID_KEY = "dms-distributor-id";
const DISTRIBUTOR_CODE_KEY = "dms-distributor-code";
const DISTRIBUTOR_NAME_KEY = "dms-distributor-name";
const DISTRIBUTOR_TAX_CODE_KEY = "dms-distributor-tax-code";
const IS_SUPER_ADMIN_KEY = "dms-is-super-admin";
const MUST_CHANGE_PASSWORD_KEY = "dms-must-change-password";
const SERVER_SNAPSHOT = "server";

export interface AuthSnapshot {
  ready: boolean;
  token: string | null;
  username: string;
  fullName: string;
  distributorId: number | null;
  distributorCode: string;
  distributorName: string;
  distributorTaxCode: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}

export interface SaveAuthSessionExtras {
  fullName?: string | null;
  distributorId?: number | null;
  distributorCode?: string | null;
  distributorName?: string | null;
  distributorTaxCode?: string | null;
  isSuperAdmin?: boolean;
  mustChangePassword?: boolean;
}

function getSnapshot(): string {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  const rawDistId = window.sessionStorage.getItem(DISTRIBUTOR_ID_KEY);
  const parsedDistId = rawDistId ? Number(rawDistId) : null;
  return JSON.stringify({
    ready: true,
    token: window.sessionStorage.getItem(ACCESS_TOKEN_KEY),
    username: window.sessionStorage.getItem(USERNAME_KEY) || "",
    fullName: window.sessionStorage.getItem(FULL_NAME_KEY) || "",
    distributorId: parsedDistId && !Number.isNaN(parsedDistId) ? parsedDistId : null,
    distributorCode: window.sessionStorage.getItem(DISTRIBUTOR_CODE_KEY) || "",
    distributorName: window.sessionStorage.getItem(DISTRIBUTOR_NAME_KEY) || "",
    distributorTaxCode: window.sessionStorage.getItem(DISTRIBUTOR_TAX_CODE_KEY) || "",
    isSuperAdmin: window.sessionStorage.getItem(IS_SUPER_ADMIN_KEY) === "true",
    mustChangePassword: window.sessionStorage.getItem(MUST_CHANGE_PASSWORD_KEY) === "true",
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
    ? {
        ready: false,
        token: null,
        username: "",
        fullName: "",
        distributorId: null,
        distributorCode: "",
        distributorName: "",
        distributorTaxCode: "",
        isSuperAdmin: false,
        mustChangePassword: false,
      }
    : (JSON.parse(snapshot) as AuthSnapshot);
}

export function getStoredAccessToken(): string | null {
  return typeof window === "undefined"
    ? null
    : window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function saveAuthSession(
  token: string,
  username: string,
  extras?: SaveAuthSessionExtras,
): void {
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
  window.sessionStorage.setItem(USERNAME_KEY, username);
  if (extras) {
    if (extras.fullName !== undefined) {
      window.sessionStorage.setItem(FULL_NAME_KEY, extras.fullName || "");
    }
    if (extras.distributorId !== undefined) {
      if (extras.distributorId !== null) {
        window.sessionStorage.setItem(DISTRIBUTOR_ID_KEY, String(extras.distributorId));
      } else {
        window.sessionStorage.removeItem(DISTRIBUTOR_ID_KEY);
      }
    }
    if (extras.distributorCode !== undefined) {
      window.sessionStorage.setItem(DISTRIBUTOR_CODE_KEY, extras.distributorCode || "");
    }
    if (extras.distributorName !== undefined) {
      window.sessionStorage.setItem(DISTRIBUTOR_NAME_KEY, extras.distributorName || "");
    }
    if (extras.distributorTaxCode !== undefined) {
      window.sessionStorage.setItem(DISTRIBUTOR_TAX_CODE_KEY, extras.distributorTaxCode || "");
    }
    if (extras.isSuperAdmin !== undefined) {
      window.sessionStorage.setItem(
        IS_SUPER_ADMIN_KEY,
        extras.isSuperAdmin ? "true" : "false",
      );
    }
    if (extras.mustChangePassword !== undefined) {
      window.sessionStorage.setItem(
        MUST_CHANGE_PASSWORD_KEY,
        extras.mustChangePassword ? "true" : "false",
      );
    }
  }
  emitChange();
}

export function clearAuthSession(expired = false): void {
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  window.sessionStorage.removeItem(USERNAME_KEY);
  window.sessionStorage.removeItem(FULL_NAME_KEY);
  window.sessionStorage.removeItem(DISTRIBUTOR_ID_KEY);
  window.sessionStorage.removeItem(DISTRIBUTOR_CODE_KEY);
  window.sessionStorage.removeItem(DISTRIBUTOR_NAME_KEY);
  window.sessionStorage.removeItem(DISTRIBUTOR_TAX_CODE_KEY);
  window.sessionStorage.removeItem(IS_SUPER_ADMIN_KEY);
  window.sessionStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
  emitChange();
  if (expired) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}
