import { useState } from "react";
import { Layout } from "./registrarCompra";

const estados = ["Todos", "Pendiente", "En preparación", "Listo", "Entregado"];

export default function Pedidos({ rol = "vendedor" }) {
  const [filtro, setFiltro] = useState("Todos");
  const admin = rol === "admin";

  return (
    <Layout titulo="Pedidos" rol={rol}>
      <div className="filtros">
        {estados.map((e) => (
          <button key={e} className={filtro === e ? "activo" : ""} onClick={() => setFiltro(e)}>
            {e}
          </button>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>N.º pedido</th><th>Cliente</th><th>Entrega</th>
            <th>Fecha de entrega</th><th>Total</th><th>Estado</th>
            {admin && <th>Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {/* Fila de muestra: se repetirá por cada pedido */}
          <tr className="relleno">
            <td /><td /><td /><td /><td />
            <td>
              <select>
                {estados.slice(1).map((e) => <option key={e}>{e}</option>)}
              </select>
            </td>
            {admin && <td><button className="peligro">Eliminar</button></td>}
          </tr>
        </tbody>
      </table>
    </Layout>
  );
}