import { Link } from "react-router-dom";
import { Layout } from "./registrarCompra";

export default function Ventas({ rol = "vendedor" }) {
  return (
    <Layout titulo="Ventas" rol={rol}>
      <div className="herramientas">
        <label>Desde <input type="date" /></label>
        <label>Hasta <input type="date" /></label>
        <Link className="boton" to={`/${rol}/registrar`}>Registrar venta</Link>
      </div>

      <table>
        <thead>
          <tr><th>N.º venta</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th><th>Total</th></tr>
        </thead>
        <tbody>
          <tr className="relleno"><td /><td /><td /><td /><td /></tr>
        </tbody>
      </table>
    </Layout>
  );
}