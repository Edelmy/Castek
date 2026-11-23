import { useCallback, useEffect, useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";
import { pedir } from "../api";
import CampoNumero from "../components/CampoNumero";
import FiltroFechas from "../components/FiltroFechas";

const hoy = new Date().toLocaleDateString("sv-SE");

export default function Gastos() {
  const [gastos, setGastos] = useState([]);
  const [tipo, setTipo] = useState("");         // "" = todos
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { ok, datos } = await pedir(`/admin/gastos?tipo=${tipo}&desde=${desde}&hasta=${hasta}`);
    if (ok) setGastos(datos);
  }, [tipo, desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  async function agregar(e) {
    e.preventDefault();
    setError("");
    const formulario = e.target;
    const { ok, datos } = await pedir("/admin/gastos", "POST", Object.fromEntries(new FormData(formulario)));
    if (!ok) return setError(datos.error);
    formulario.reset();
    cargar();
  }

  async function eliminar(g) {
    if (!window.confirm(`¿Eliminar el gasto "${g.concepto}"?`)) return;
    const { ok, datos } = await pedir(`/admin/gastos/${g.id}/desactivar`, "POST");
    if (!ok) setError(datos.error);
    cargar();
  }

  const total = gastos.reduce((s, g) => s + g.monto, 0);

  return (
    <Layout titulo="Gastos" rol="admin">
      <form className="herramientas" onSubmit={agregar}>
        <label>Fecha <input name="fecha" type="date" defaultValue={hoy} max={hoy} required /></label>
        <label>Concepto <input name="concepto" required /></label>
        <label>Descripción <input name="descripcion" /></label>
        <label>Tipo
          <select name="tipo">
            <option value="variable">Variable (insumos, etc.)</option>
            <option value="fijo">Fijo (renta, servicios...)</option>
          </select>
        </label>
        <label>Monto <CampoNumero tipo="decimal" name="monto" required /></label>
        <button className="boton">Registrar gasto</button>
      </form>
      {error && <p className="msj">{error}</p>}

      <div className="herramientas">
        <label>Ver tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="variable">Variables</option>
            <option value="fijo">Fijos</option>
          </select>
        </label>
        <FiltroFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      </div>

      <table>
        <thead>
          <tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Monto</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {gastos.map((g) => (
            <tr key={g.id}>
              <td>{g.fecha}</td>
              <td title={g.descripcion}>{g.concepto}</td>
              <td>{g.tipo === "fijo" ? "Fijo" : "Variable"}</td>
              <td>${g.monto.toFixed(2)}</td>
              <td><button className="peligro" onClick={() => eliminar(g)}>Eliminar</button></td>
            </tr>
          ))}
          {gastos.length === 0 && <tr className="relleno"><td colSpan="5" /></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan="3">Total de gastos</td><td colSpan="2">${total.toFixed(2)}</td></tr>
        </tfoot>
      </table>
    </Layout>
  );
}
