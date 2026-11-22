import { useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";
import { pedir } from "../api";

const tipos = {
  caja: "Caja (ingresos, gastos y utilidad por día)",
  productos: "Ventas por producto",
  favoritos: "Productos favoritos",
};

const primerDia = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toLocaleDateString("sv-SE");
const hoy = new Date().toLocaleDateString("sv-SE");

export default function Reportes() {
  const [tipo, setTipo] = useState("caja");
  const [desde, setDesde] = useState(primerDia);
  const [hasta, setHasta] = useState(hoy);
  const [reporte, setReporte] = useState(null);   // { columnas, filas, dinero }
  const [error, setError] = useState("");

  async function generar() {
    setError("");
    const { ok, datos } = await pedir(`/admin/reportes/${tipo}?desde=${desde}&hasta=${hasta}`);
    if (ok) setReporte(datos); else { setReporte(null); setError(datos.error); }
  }

  const formato = (valor, col) => (reporte.dinero.includes(col) ? `$${valor.toFixed(2)}` : valor);

  return (
    <Layout titulo="Reportes" rol="admin">
      <div className="herramientas">
        <label>Reporte
          <select value={tipo} onChange={(e) => { setTipo(e.target.value); setReporte(null); }}>
            {Object.entries(tipos).map(([clave, texto]) => <option key={clave} value={clave}>{texto}</option>)}
          </select>
        </label>
        {tipo !== "favoritos" && (
          <>
            <label>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          </>
        )}
        <button className="boton" onClick={generar}>Generar</button>
        <button className="boton" onClick={() => window.print()} disabled={!reporte}>Imprimir</button>
      </div>
      {error && <p className="msj">{error}</p>}

      {reporte && (
        <table>
          <thead>
            <tr>{reporte.columnas.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {reporte.filas.map((fila, i) => (
              <tr key={i}>{fila.map((v, col) => <td key={col}>{formato(v, col)}</td>)}</tr>
            ))}
            {reporte.filas.length === 0 && (
              <tr><td colSpan={reporte.columnas.length}>No hay datos en ese periodo</td></tr>
            )}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
