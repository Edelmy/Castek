import { useState } from "react";
import { Layout } from "./registrarCompra";

const estados = ["Todos", "Pendiente", "En preparación", "Listo", "Entregado"];

export default function Pedidos() {
  const [filtro, setFiltro] = useState("Todos");

  return (
    <Layout titulo="Pedidos">
      <div className="filtros">
        {estados.map((e) => (
          <button
            key={e}
            className={filtro === e ? "activo" : ""}
            onClick={() => setFiltro(e)}
          >
            {e}
          </button>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>N.º pedido</th><th>Cliente</th><th>Entrega</th>
            <th>Fecha de entrega</th><th>Total</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          <tr className="relleno"><td /><td /><td /><td /><td /><td /></tr>
        </tbody>
      </table>
    </Layout>
  );
}