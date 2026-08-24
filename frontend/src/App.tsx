import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/Spinner";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { CampaignNewPage } from "./pages/CampaignNewPage";
import { CampaignDetailPage } from "./pages/CampaignDetailPage";
import { DisparosPage } from "./pages/DisparosPage";
import { DisparoNewPage } from "./pages/DisparoNewPage";
import { DisparoSelectPage } from "./pages/DisparoSelectPage";
import { FlowPage } from "./pages/FlowPage";
import { ConnectPage } from "./pages/ConnectPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AdminPage } from "./pages/AdminPage";

function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink">
        <Spinner className="h-9 w-9" />
      </div>
    );
  }

  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Página pública: apresenta a automação e o passo a passo */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />

        {/* Rotas protegidas */}
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/campanhas" element={<CampaignsPage />} />
            <Route path="/campanhas/nova" element={<CampaignNewPage />} />
            <Route path="/campanhas/:id" element={<CampaignDetailPage />} />
            <Route path="/campanhas/:id/fluxo" element={<FlowPage />} />
            <Route path="/conectar" element={<ConnectPage />} />
            <Route path="/disparos" element={<DisparosPage />} />
            <Route path="/disparos/nova" element={<DisparoNewPage />} />
            <Route path="/disparos/:id/selecionar" element={<DisparoSelectPage />} />
            <Route path="/disparos/:id" element={<CampaignDetailPage />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
            <Route path="/administracao" element={<AdminPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
