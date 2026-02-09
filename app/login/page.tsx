"use client";

import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";

const buttonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "10px 20px",
  background: "var(--bg-3)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text-0)",
  fontSize: "13px",
  cursor: "pointer",
  width: "100%",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "var(--bg-2)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text-0)",
  fontSize: "13px",
  fontFamily: "var(--mono)",
  width: "100%",
  boxSizing: "border-box",
};

export default function LoginPage() {
  const [methods, setMethods] = useState<{ credentials: boolean; github: boolean } | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth-methods")
      .then((r) => r.json())
      .then(setMethods)
      .catch(() => setMethods({ credentials: true, github: false }));
  }, []);

  async function handleCredentialSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const res = await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0],
        });
        if (res.error) {
          setError(res.error.message || "Sign up failed");
          return;
        }
      } else {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) {
          setError(res.error.message || "Sign in failed");
          return;
        }
      }
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  if (!methods) return null;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100dvh",
      fontFamily: "var(--mono)",
    }}>
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
        width: "280px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "var(--accent)",
          }} />
          <span style={{ fontSize: 18, color: "var(--text-0)", fontWeight: 500 }}>
            claude<span style={{ color: "var(--text-2)" }}>/</span>host
          </span>
        </div>

        {methods.credentials && (
          <form onSubmit={handleCredentialSubmit} style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            width: "100%",
          }}>
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
                autoComplete="name"
              />
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              autoComplete="email"
              required
              autoFocus
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={8}
            />
            {error && (
              <div style={{ color: "var(--error, #f44)", fontSize: "12px" }}>{error}</div>
            )}
            <button type="submit" disabled={loading} style={buttonStyle}>
              {loading ? "..." : mode === "signup" ? "Create account" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-2)",
                fontSize: "12px",
                cursor: "pointer",
                fontFamily: "var(--mono)",
              }}
            >
              {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </form>
        )}

        {methods.credentials && methods.github && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            width: "100%",
            color: "var(--text-2)",
            fontSize: "12px",
          }}>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            or
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          </div>
        )}

        {methods.github && (
          <button
            onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/" })}
            style={buttonStyle}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Sign in with GitHub
          </button>
        )}
      </div>
    </div>
  );
}
