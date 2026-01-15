import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Profiles from "./pages/Profiles";
import ClientesDashboard from "./pages/ClientesDashboard";
import ProspectosDashboard from "./pages/ProspectosDashboard";
import AreasManager from "./pages/AreasManager";
import VendedorDashboard from "./pages/VendedorDashboard";
import SupervisionVendedores from "./pages/SupervisionVendedores";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/clientes-dashboard" element={<ClientesDashboard />} />
          <Route path="/prospectos-dashboard" element={<ProspectosDashboard />} />
          <Route path="/areas" element={<AreasManager />} />
          <Route path="/vendedor-dashboard" element={<VendedorDashboard />} />
          <Route path="/supervision-vendedores" element={<SupervisionVendedores />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
