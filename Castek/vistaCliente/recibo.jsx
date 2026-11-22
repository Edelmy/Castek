import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { pedir } from "../api";
import "../styles/recibo.css";

export default function Recibo() {
  const { id } = useParams(); // el número del pedido viene en la dirección: /recibo/5
  const [pedido, setPedido] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    pedir(`/pedidos/${id}`).then(({ ok, datos }) => (ok ? setPedido(datos) : setError(datos.error)));
  }, [id]);

  if (error) {
    return (
      <>
        <Navbar />
        <main className="recibo"><p>{error}</p><Link className="boton" to="/menu">Volver al menú</Link></main>
      </>
    );
  }
  if (!pedido) return <Navbar />;

  return (
    <>
      <Navbar />
      <main className="recibo">

        <header>
          <img src="/imagenes/cupcake.png" alt="" />
          <div>
            <h2>¡ Compra registrada !</h2>
            <p>Gracias por tu preferencia ♡</p>
          </div>
        </header>

        <dl>
          <dt>🎫 N.º de pedido:</dt><dd>{pedido.id_ped}</dd>
          <dt>📅 Fecha:</dt><dd>{pedido.fecha}</dd>
          <dt>🚚 Entrega:</dt><dd>{pedido.fecha_entrega} ({pedido.tipo_entrega === "pickup" ? "PickUp" : "Domicilio"})</dd>
          <dt>👤 Cliente</dt><dd>{pedido.cliente}</dd>
          <dt>$$ Total:</dt><dd>${pedido.total.toFixed(2)}</dd>
        </dl>

        <hr />

        <table>
          <thead>
            <tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr>
          </thead>
          <tbody>
            {pedido.detalle.map((d, i) => (
              <tr key={i}>
                <td>{d.producto}</td>
                <td>{d.cantidad}</td>
                <td>${d.precio.toFixed(2)}</td>
                <td>${d.subtotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p>¡Gracias por tu compra!</p>
      </main>
    </>
  );
}
