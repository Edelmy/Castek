// Campo que SOLO acepta números (lo demás se borra al escribir o pegar).
//   tipo="entero"   -> 0-9                       (cantidades, existencia)
//   tipo="decimal"  -> 0-9 y un punto, 2 decimales (precios, montos)
//   tipo="telefono" -> 0-9, máximo 10 dígitos
// Se usa igual que un <input>: value/onChange (controlado) o name/defaultValue (formulario).
const limpiar = {
  entero: (v) => v.replace(/\D/g, ""),
  telefono: (v) => v.replace(/\D/g, "").slice(0, 10),
  decimal: (v) => {
    const t = v.replace(",", ".").replace(/[^\d.]/g, "");
    const [entera, ...resto] = t.split(".");
    return resto.length ? `${entera}.${resto.join("").slice(0, 2)}` : entera;
  },
};

export default function CampoNumero({ tipo = "entero", onChange, ...resto }) {
  return (
    <input
      {...resto}
      type="text"
      inputMode={tipo === "decimal" ? "decimal" : "numeric"}
      autoComplete="off"
      onChange={(e) => {
        e.target.value = limpiar[tipo](e.target.value);   // se corrige antes de guardarlo
        onChange?.(e);
      }}
    />
  );
}
