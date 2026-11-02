import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Board from "./pages/Board";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-center">Loading...</div>;
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={!loading && user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <Protected>
            <Board />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
