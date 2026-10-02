import { Checkbox } from "@/components/ui/checkbox";

export function EnfoqueRegalos({ checked, onChange, disabled = false }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return <div className="space-y-1.5">
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={value => onChange(value === true)} disabled={disabled} />
      Regalos empresariales
    </label>
    <p className="text-xs text-muted-foreground">Empresas, hoteles, estudios profesionales y eventos. Posibles compradores; interés por confirmar.</p>
  </div>;
}
