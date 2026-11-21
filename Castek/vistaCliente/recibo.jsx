import Navbar from "../components/Navbar";
import "../styles/recibo.css";

export default function Recibo() {
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

        <p>¡Gracias por tu compra!</p>
      </main>
    </>
  );
}