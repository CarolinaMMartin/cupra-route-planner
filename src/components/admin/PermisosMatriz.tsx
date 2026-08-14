import { Check, Minus, ShieldCheck } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

type Fila = {
  accion: string;
  administrador: boolean;
  asignador: boolean;
  vendedor: boolean;
  nota?: string;
};

const PERMISOS: { grupo: string; filas: Fila[] }[] = [
  {
    grupo: "Cuentas y accesos",
    filas: [
      { accion: "Crear nuevos perfiles (altas de usuario)", administrador: true, asignador: false, vendedor: false, nota: "El registro público está deshabilitado" },
      { accion: "Cambiar rol de un usuario", administrador: true, asignador: false, vendedor: false },
      { accion: "Activar / desactivar vendedores", administrador: true, asignador: true, vendedor: false },
      { accion: "Editar nombre de vendedores", administrador: true, asignador: true, vendedor: false },
      { accion: "Eliminar perfiles", administrador: true, asignador: false, vendedor: false },
      { accion: "Ver el listado completo de perfiles", administrador: true, asignador: true, vendedor: false },
    ],
  },
  {
    grupo: "Asignaciones",
    filas: [
      { accion: "Generar recomendaciones con IA", administrador: true, asignador: true, vendedor: false },
      { accion: "Asignación manual de clientes", administrador: true, asignador: true, vendedor: false },
      { accion: "Gestionar áreas comerciales", administrador: true, asignador: true, vendedor: false },
      { accion: "Programar visitas a cualquier vendedor", administrador: true, asignador: true, vendedor: false },
      { accion: "Autoasignarse clientes / agendar seguimientos", administrador: true, asignador: true, vendedor: true, nota: "El vendedor solo sobre su propia ruta" },
      { accion: "Registrar feedback de visita", administrador: true, asignador: true, vendedor: true },
    ],
  },
  {
    grupo: "Datos y análisis",
    filas: [
      { accion: "Dashboard de ventas e histórico", administrador: true, asignador: false, vendedor: false },
      { accion: "Carga de datos (Excel maestro y ventas)", administrador: true, asignador: false, vendedor: false },
      { accion: "Supervisión de vendedores", administrador: true, asignador: true, vendedor: false },
      { accion: "Ver ficha y briefing de cliente", administrador: true, asignador: true, vendedor: true, nota: "El vendedor ve los clientes de su cartera y ruta" },
      { accion: "Alta y edición de prospectos", administrador: true, asignador: true, vendedor: true },
    ],
  },
];

function Celda({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="w-4 h-4 text-primary mx-auto" />
  ) : (
    <Minus className="w-4 h-4 text-muted-foreground/40 mx-auto" />
  );
}

const PermisosMatriz = () => {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-6">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          Permisos y habilitaciones por rol
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4">
        <div className="bg-card border rounded-lg p-4 space-y-6">
          <p className="text-xs text-muted-foreground">
            Los roles funcionan en cascada: el administrador puede todo lo del asignador, y el asignador todo lo del vendedor.
          </p>
          {PERMISOS.map((grupo) => (
            <div key={grupo.grupo}>
              <h3 className="text-sm font-medium mb-2">{grupo.grupo}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b">
                      <th className="text-left font-normal py-2">Acción</th>
                      <th className="font-normal py-2 w-28">Admin</th>
                      <th className="font-normal py-2 w-28">Asignador</th>
                      <th className="font-normal py-2 w-28">Vendedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.filas.map((fila) => (
                      <tr key={fila.accion} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-4">
                          {fila.accion}
                          {fila.nota && (
                            <span className="block text-xs text-muted-foreground">{fila.nota}</span>
                          )}
                        </td>
                        <td className="py-2"><Celda ok={fila.administrador} /></td>
                        <td className="py-2"><Celda ok={fila.asignador} /></td>
                        <td className="py-2"><Celda ok={fila.vendedor} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default PermisosMatriz;
