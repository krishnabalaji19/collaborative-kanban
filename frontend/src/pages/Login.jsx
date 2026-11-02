import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (mode === "register" && form.password !== form.confirm) {
      return setError("Passwords do not match");
    }
    setBusy(true);
    try {
      if (mode === "register") {
        await api.post("/auth/register", {
          name: form.name,
          email: form.email,
          password: form.password,
        });
      }
      await login(form.email, form.password);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-center">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Collaborative Kanban</h1>
        <p className="muted">
          {mode === "login"
            ? "Sign in to your workspace"
            : "Create your account"}
        </p>

        {mode === "register" && (
          <input
            className="input"
            placeholder="Full name"
            value={form.name}
            onChange={set("name")}
            required
          />
        )}
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={set("email")}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={set("password")}
          required
        />
        {mode === "register" && (
          <input
            className="input"
            type="password"
            placeholder="Confirm password"
            value={form.confirm}
            onChange={set("confirm")}
            required
          />
        )}

        {error && <div className="error">{error}</div>}

        <button className="btn primary" disabled={busy}>
          {busy ? "Please wait..." : mode === "login" ? "Sign in" : "Register"}
        </button>

        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>

        <p className="hint">Demo: rahul@abc.com / password123</p>
      </form>
    </div>
  );
}
