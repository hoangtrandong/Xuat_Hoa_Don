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

function readStorageItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
}

function getSnapshot(): string {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  const rawDistId = readStorageItem(DISTRIBUTOR_ID_KEY);
  const parsedDistId = rawDistId ? Number(rawDistId) : null;
  return JSON.stringify({
    ready: true,
    token: readStorageItem(ACCESS_TOKEN_KEY),
    username: readStorageItem(USERNAME_KEY) || "",
    fullName: readStorageItem(FULL_NAME_KEY) || "",
    distributorId: parsedDistId && !Number.isNaN(parsedDistId) ? parsedDistId : null,
    distributorCode: readStorageItem(DISTRIBUTOR_CODE_KEY) || "",
    distributorName: readStorageItem(DISTRIBUTOR_NAME_KEY) || "",
    distributorTaxCode: readStorageItem(DISTRIBUTOR_TAX_CODE_KEY) || "",
    isSuperAdmin: readStorageItem(IS_SUPER_ADMIN_KEY) === "true",
    mustChangePassword: readStorageItem(MUST_CHANGE_PASSWORD_KEY) === "true",
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
  return readStorageItem(ACCESS_TOKEN_KEY);
}

export function saveAuthSession(
  token: string,
  username: string,
  extras?: SaveAuthSessionExtras & { persist?: boolean },
): void {
  const shouldPersist =
    extras?.persist ??
    (typeof window !== "undefined" && Boolean(window.localStorage.getItem(ACCESS_TOKEN_KEY)));
  const targets: Storage[] = [window.sessionStorage];
  if (shouldPersist) {
    targets.push(window.localStorage);
  }
  for (const storage of targets) {
    storage.setItem(ACCESS_TOKEN_KEY, token);
    storage.setItem(USERNAME_KEY, username);
    if (extras) {
      if (extras.fullName !== undefined) {
        storage.setItem(FULL_NAME_KEY, extras.fullName || "");
      }
      if (extras.distributorId !== undefined) {
        if (extras.distributorId !== null) {
          storage.setItem(DISTRIBUTOR_ID_KEY, String(extras.distributorId));
        } else {
          storage.removeItem(DISTRIBUTOR_ID_KEY);
        }
      }
      if (extras.distributorCode !== undefined) {
        storage.setItem(DISTRIBUTOR_CODE_KEY, extras.distributorCode || "");
      }
      if (extras.distributorName !== undefined) {
        storage.setItem(DISTRIBUTOR_NAME_KEY, extras.distributorName || "");
      }
      if (extras.distributorTaxCode !== undefined) {
        storage.setItem(DISTRIBUTOR_TAX_CODE_KEY, extras.distributorTaxCode || "");
      }
      if (extras.isSuperAdmin !== undefined) {
        storage.setItem(
          IS_SUPER_ADMIN_KEY,
          extras.isSuperAdmin ? "true" : "false",
        );
      }
      if (extras.mustChangePassword !== undefined) {
        storage.setItem(
          MUST_CHANGE_PASSWORD_KEY,
          extras.mustChangePassword ? "true" : "false",
        );
      }
    }
  }
  emitChange();
}

export function clearAuthSession(expired = false): void {
  const keys = [
    ACCESS_TOKEN_KEY,
    USERNAME_KEY,
    FULL_NAME_KEY,
    DISTRIBUTOR_ID_KEY,
    DISTRIBUTOR_CODE_KEY,
    DISTRIBUTOR_NAME_KEY,
    DISTRIBUTOR_TAX_CODE_KEY,
    IS_SUPER_ADMIN_KEY,
    MUST_CHANGE_PASSWORD_KEY,
  ];
  for (const storage of [window.sessionStorage, window.localStorage]) {
    for (const key of keys) {
      storage.removeItem(key);
    }
  }
  emitChange();
  if (expired) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}
