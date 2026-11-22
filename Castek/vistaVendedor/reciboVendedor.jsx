import { Link } from "react-router-dom";
import { Layout } from "./registrarCompra";
import "../styles/recibo.css";

export default function ReciboVendedor({ rol = "vendedor" }) {
  return (
    <Layout titulo="Recibo" rol={rol}>

        <header>
          <img src="/imagenes/cupcake.png" alt="" />
          <div>
            <h2>¡ Venta registrada !</h2>
            <p>Gracias por su preferencia ♡</p>
          </div>
        </header>

        <dl>
          <dt>🎫 N.º de pedido:</dt><dd />
          <dt>📅 Fecha:</dt><dd />
          <dt>👤 Cliente</dt><dd />
          <dt>$$ Total:</dt><dd />
        </dl>

        <hr />

        <table>
          <thead>
            <tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr>
          </thead>
          <tbody>
            <tr className="relleno"><td /><td /><td /><td /></tr>
          </tbody>
        </table>

        <p>¡Gracias por su compra!</p>

        
      <Link className="boton" to={`/${rol}/registrar`}>Nueva venta</Link>
    </Layout>
  );
}