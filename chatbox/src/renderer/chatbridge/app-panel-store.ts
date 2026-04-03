import { create } from "zustand";

interface ActiveApp {
  appId: string;
  appName: string;
  appUrl: string;
  toolCallId: string;
  sessionId: string; // which chat session opened this app
}

interface PendingChatMessages {
  userText: string;
  assistantText: string;
}

interface PendingToolInvocation {
  toolName: string;
  toolCallId: string;
  params: Record<string, unknown>;
}

interface AppPanelState {
  activeApp: ActiveApp | null;
  // Map of sessionId -> app state (so we can restore when switching sessions)
  sessionApps: Record<string, ActiveApp>;
  openApp: (app: ActiveApp) => void;
  closeApp: () => void;
  // Switch to a session — shows its app if it has one, hides otherwise
  switchSession: (sessionId: string | null) => void;
  pendingChatMessages: PendingChatMessages | null;
  setPendingChatMessages: (msgs: PendingChatMessages) => void;
  clearPendingChatMessages: () => void;
  // Queue of tool invocations to forward to the iframe
  pendingToolInvocations: PendingToolInvocation[];
  queueToolInvocation: (inv: PendingToolInvocation) => void;
  clearPendingToolInvocations: () => PendingToolInvocation[];
}

export const useAppPanelStore = create<AppPanelState>((set, get) => ({
  activeApp: null,
  sessionApps: {},
  openApp: (app) =>
    set((state) => ({
      activeApp: app,
      sessionApps: { ...state.sessionApps, [app.sessionId]: app },
    })),
  closeApp: () =>
    set((state) => {
      if (!state.activeApp) return { activeApp: null };
      const { [state.activeApp.sessionId]: _, ...rest } = state.sessionApps;
      return { activeApp: null, sessionApps: rest };
    }),
  switchSession: (sessionId) =>
    set((state) => {
      if (!sessionId) return { activeApp: null };
      const app = state.sessionApps[sessionId] || null;
      return { activeApp: app };
    }),
  pendingChatMessages: null,
  setPendingChatMessages: (msgs) => set({ pendingChatMessages: msgs }),
  clearPendingChatMessages: () => set({ pendingChatMessages: null }),
  pendingToolInvocations: [],
  queueToolInvocation: (inv) =>
    set((state) => ({
      pendingToolInvocations: [...state.pendingToolInvocations, inv],
    })),
  clearPendingToolInvocations: () => {
    const current = get().pendingToolInvocations;
    set({ pendingToolInvocations: [] });
    return current;
  },
}));
