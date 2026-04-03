import { useEffect, useState, type FC, type ReactNode } from "react";
import {
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Title,
  Text,
  Paper,
  Anchor,
  Center,
  Box,
} from "@mantine/core";
import { useAuthStore } from "./auth-store";

const AuthGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, checkSession } = useAuthStore();

  useEffect(() => {
    checkSession();
  }, []);

  if (isLoading) {
    return (
      <Center h="100vh">
        <Text c="dimmed">Loading...</Text>
      </Center>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
};

function LoginPage() {
  const { login, register, error } = useAuthStore();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLocalError(null);
    try {
      if (mode === "register") {
        await register(name, email, password);
      } else {
        await login(email, password);
      }
    } catch (e: any) {
      setLocalError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--chatbox-background-primary)",
      }}
    >
      <Paper
        shadow="md"
        p="xl"
        radius="md"
        style={{ width: 400, maxWidth: "90vw" }}
      >
        <form onSubmit={handleSubmit}>
          <Stack>
            <Title order={2} ta="center">
              ChatBridge
            </Title>
            <Text c="dimmed" size="sm" ta="center">
              {mode === "login"
                ? "Sign in to continue"
                : "Create your account"}
            </Text>

            {mode === "register" && (
              <TextInput
                label="Name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                required
              />
            )}

            <TextInput
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              required
            />

            <PasswordInput
              label="Password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              required
            />

            {(localError || error) && (
              <Text c="red" size="sm">
                {localError || error}
              </Text>
            )}

            <Button type="submit" loading={loading} fullWidth>
              {mode === "login" ? "Sign In" : "Create Account"}
            </Button>

            <Text c="dimmed" size="sm" ta="center">
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <Anchor
                    component="button"
                    type="button"
                    onClick={() => setMode("register")}
                  >
                    Register
                  </Anchor>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <Anchor
                    component="button"
                    type="button"
                    onClick={() => setMode("login")}
                  >
                    Sign in
                  </Anchor>
                </>
              )}
            </Text>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}

export default AuthGate;
