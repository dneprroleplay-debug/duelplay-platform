"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import CenterModal from "./CenterModal";
import ConfirmModal from "./ConfirmModal";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "default";
  busy?: boolean;
};

type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  multiline?: boolean;
  required?: boolean;
};

type AlertOptions = {
  title?: string;
  message: string;
  confirmText?: string;
};

type DialogContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  alert: (options: AlertOptions) => Promise<void>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

type ConfirmState = ConfirmOptions & { open: boolean };
type PromptState = PromptOptions & { open: boolean; value: string };
type AlertState = AlertOptions & { open: boolean };

export function DuelDialogProvider({ children }: { children: React.ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [alertState, setAlertState] = useState<AlertState | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const promptResolver = useRef<((value: string | null) => void) | null>(null);
  const alertResolver = useRef<(() => void) | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const closeConfirm = useCallback((value: boolean) => {
    const resolver = confirmResolver.current;
    confirmResolver.current = null;
    setConfirmState(null);
    resolver?.(value);
  }, []);

  const closePrompt = useCallback((value: string | null) => {
    const resolver = promptResolver.current;
    promptResolver.current = null;
    setPromptState(null);
    resolver?.(value);
  }, []);

  const closeAlert = useCallback(() => {
    const resolver = alertResolver.current;
    alertResolver.current = null;
    setAlertState(null);
    resolver?.();
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    // A second request resolves the first one as "cancelled" instead of
    // leaving it pending forever, and the resolver is replaced atomically so a
    // double click can never resolve the same promise twice.
    confirmResolver.current?.(false);
    confirmResolver.current = resolve;
    setConfirmState({ ...options, open: true });
  }), []);

  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => {
    promptResolver.current?.(null);
    promptResolver.current = resolve;
    setPromptState({ ...options, open: true, value: options.defaultValue ?? "" });
  }), []);

  const alert = useCallback((options: AlertOptions) => new Promise<void>((resolve) => {
    alertResolver.current?.();
    alertResolver.current = resolve;
    setAlertState({ ...options, open: true });
  }), []);

  // Remember the element that opened the dialog so the focus can be restored
  // when it closes.
  useEffect(() => {
    if (confirmState || promptState || alertState) {
      lastFocused.current = (document.activeElement as HTMLElement | null) ?? null;
      return;
    }
    const target = lastFocused.current;
    lastFocused.current = null;
    if (target && typeof target.focus === "function" && document.contains(target)) target.focus();
  }, [confirmState, promptState, alertState]);

  const promptValue = promptState?.value ?? "";
  const promptBlocked = Boolean(promptState?.required) && promptValue.trim().length === 0;

  // Keyboard support: Escape cancels, Enter confirms (Ctrl/Cmd+Enter for a
  // multiline prompt, where Enter must insert a line break).
  useEffect(() => {
    if (!confirmState && !promptState && !alertState) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmState) closeConfirm(false);
        else if (promptState) closePrompt(null);
        else closeAlert();
        return;
      }
      if (event.key !== "Enter") return;
      if (confirmState) {
        if (confirmState.busy) return;
        event.preventDefault();
        closeConfirm(true);
        return;
      }
      if (alertState) {
        event.preventDefault();
        closeAlert();
        return;
      }
      if (promptState) {
        if (promptState.multiline && !(event.ctrlKey || event.metaKey)) return;
        if (promptBlocked) return;
        event.preventDefault();
        closePrompt(promptValue);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [alertState, closeAlert, closeConfirm, closePrompt, confirmState, promptBlocked, promptState, promptValue]);

  return <DialogContext.Provider value={{ confirm, prompt, alert }}>
    {children}
    <ConfirmModal
      open={Boolean(confirmState)}
      title={confirmState?.title || "Confirmation"}
      message={confirmState?.message || ""}
      confirmText={confirmState?.confirmText || "Confirm"}
      cancelText={confirmState?.cancelText || "Cancel"}
      tone={confirmState?.tone || "default"}
      busy={confirmState?.busy}
      onConfirm={() => closeConfirm(true)}
      onCancel={() => closeConfirm(false)}
    />
    <CenterModal open={Boolean(promptState)} title={promptState?.title || "Enter a value"} onClose={() => closePrompt(null)}>
      {promptState?.message && <p className="mb-4 text-sm leading-6 text-zinc-400">{promptState.message}</p>}
      {promptState?.multiline
        ? <textarea autoFocus className="input min-h-32 resize-y" value={promptState.value} placeholder={promptState.placeholder} onChange={(event) => setPromptState((current) => current ? { ...current, value: event.target.value } : current)}/>
        : <input autoFocus className="input" value={promptState?.value || ""} placeholder={promptState?.placeholder} onChange={(event) => setPromptState((current) => current ? { ...current, value: event.target.value } : current)}/>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => closePrompt(null)} className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-3 text-sm font-bold text-zinc-300 transition hover:border-white/20 hover:text-white">{promptState?.cancelText || "Cancel"}</button>
        <button type="button" disabled={promptBlocked} onClick={() => closePrompt(promptValue)} className="rounded-xl bg-[var(--theme-accent)] px-4 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{promptState?.confirmText || "Confirm"}</button>
      </div>
    </CenterModal>
    <CenterModal open={Boolean(alertState)} title={alertState?.title || "Notice"} onClose={closeAlert}>
      <p className="text-sm leading-6 text-zinc-300">{alertState?.message || ""}</p>
      <button type="button" autoFocus onClick={closeAlert} className="mt-5 w-full rounded-xl bg-[var(--theme-accent)] px-4 py-3 text-sm font-black text-black transition hover:brightness-110">{alertState?.confirmText || "OK"}</button>
    </CenterModal>
  </DialogContext.Provider>;
}

export function useDuelDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useDuelDialog must be used inside DuelDialogProvider");
  return context;
}
