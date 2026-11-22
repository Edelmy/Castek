import { useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";

const categorias = ["Insumos", "Servicios", "Renta", "Nómina", "Otros"];
const hoy = new Date().toLocaleDateString("sv-SE");

export default function Gastos() {
  const [gastos, setGastos] = useState([]);
  const [filtro, setFiltro] = useState("Todas");

  const agregar = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    setGastos((g) => [...g, {
      id: Date.now(),
      fecha: f.get("fecha"),
      concepto: f.get("concepto"),
      categoria: f.get("categoria"),
      monto: Number(f.get("monto")),
    }]);
    e.target.reset();
  };

  const visibles = gastos.filter((g) => filtro === "Todas" || g.categoria === filtro);
  const total = visibles.reduce((s, g) => s + g.monto, 0);

  return (
    <Layout titulo="Gastos" rol="admin">
      <form className="herramientas" onSubmit={agregar}>
        <label>Fecha <input name="fecha" type="date" defaultValue={hoy} required /></label>
        <label>Concepto <input name="concepto" required /></label>
        <label>Categoría
          <select name="categoria">
            {categorias.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Monto <input name="monto" type="number" min="0" step="0.01" required /></label>
        <button className="boton">Registrar gasto</button>
      </form>

      <div className="herramientas">
        <label>Ver categoría
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option>Todas</option>
            {categorias.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <table>
        <thead>
          <tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Monto</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {visibles.map((g) => (
            <tr key={g.id}>
              <td>{g.fecha}</td><td>{g.concepto}</td><td>{g.categoria}</td>
              <td>${g.monto.toFixed(2)}</td>
              <td>
                <button className="peligro" onClick={() => setGastos((l) => l.filter((x) => x.id !== g.id))}>
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
          {!visibles.length && <tr className="relleno"><td /><td /><td /><td /><td /></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan="3">Total de gastos</td><td colSpan="2">${total.toFixed(2)}</td></tr>
        </tfoot>
      </table>
    </Layout>
  );
}