import { create } from "zustand";
import { apiFetch } from "./api-client";
import { settingsStore } from "@/stores/settingsStore";
import { lastUsedModelStore } from "@/stores/lastUsedModelStore";

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

function configureChatBridgeProvider() {
  // Set the default model to ChatBridge so new sessions use our backend
  settingsStore.setState({
    defaultChatModel: {
      provider: "chatbridge",
      model: "chatbridge-default",
    },
  });
  // Also set last used model so it takes effect immediately
  lastUsedModelStore.setState({
    chat: {
      provider: "chatbridge",
      modelId: "chatbridge-default",
    },
  });
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ error: null, isLoading: true });
    try {
      const res = await apiFetch("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Login failed");
      }
      const data = await res.json();
      configureChatBridgeProvider();
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
      throw e;
    }
  },

  register: async (name: string, email: string, password: string) => {
    set({ error: null, isLoading: true });
    try {
      const res = await apiFetch("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Registration failed");
      }
      const data = await res.json();
      configureChatBridgeProvider();
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
      throw e;
    }
  },

  logout: async () => {
    await apiFetch("/api/auth/sign-out", { method: "POST" });
    set({ user: null, isAuthenticated: false });
  },

  checkSession: async () => {
    try {
      const res = await apiFetch("/api/auth/get-session");
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          configureChatBridgeProvider();
          set({ user: data.user, isAuthenticated: true, isLoading: false });
          return;
        }
      }
    } catch {
      // Session check failed
    }
    set({ user: null, isAuthenticated: false, isLoading: false });
  },
}));
