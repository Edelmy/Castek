import { useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";

const reportes = {
  "Caja": ["Fecha", "Ingresos", "Gastos", "Utilidad"],
  "Productos favoritos": ["Producto", "Veces marcado como favorito"],
};

export default function Reportes() {
  const [tipo, setTipo] = useState("Caja");
  const columnas = reportes[tipo];

  return (
    <Layout titulo="Reportes" rol="admin">
      <div className="herramientas">
        <label>Reporte
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {Object.keys(reportes).map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>Desde <input type="date" /></label>
        <label>Hasta <input type="date" /></label>
        <button className="boton">Generar</button>
        <button className="boton" onClick={() => window.print()}>Imprimir</button>
      </div>

      <table>
        <thead>
          <tr>{columnas.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          <tr className="relleno"><td colSpan={columnas.length} /></tr>
        </tbody>
      </table>
    </Layout>
  );
}