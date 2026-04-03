import { create } from "zustand";

interface AppContextState {
  contexts: Record<string, Record<string, unknown>>;
  updateContext: (appId: string, state: Record<string, unknown>) => void;
  clearContext: (appId: string) => void;
  getContexts: () => Record<string, Record<string, unknown>>;
}

export const useAppContextStore = create<AppContextState>((set, get) => ({
  contexts: {},

  updateContext: (appId: string, state: Record<string, unknown>) => {
    set((prev) => ({
      contexts: { ...prev.contexts, [appId]: state },
    }));
  },

  clearContext: (appId: string) => {
    set((prev) => {
      const { [appId]: _, ...rest } = prev.contexts;
      return { contexts: rest };
    });
  },

  getContexts: () => get().contexts,
}));
