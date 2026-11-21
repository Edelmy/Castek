import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/carrito.css";

export default function Carrito({ carrito, poner, productos }) {
  const items = productos
    .filter((p) => carrito[p.id])
    .map((p) => ({ ...p, cantidad: carrito[p.id] }));

  const articulos = items.reduce((s, i) => s + i.cantidad, 0);
  const total = items.reduce((s, i) => s + i.cantidad * i.precio, 0);

  return (
    <>
      <Navbar />
      <main className="pedido">

        {/* Datos del cliente: se llenarán con la base de datos */}
        <form>
          <label htmlFor="cliente">Cliente:</label>
          <input id="cliente" />

          <label htmlFor="telefono">Teléfono:</label>
          <input id="telefono" />

          <label htmlFor="entrega">Tipo de entrega:</label>
          <select id="entrega">
            <option>PickUp</option>
            <option>Domicilio</option>
          </select>

          <label htmlFor="fecha">Fecha de entrega:</label>
          <input id="fecha" type="date" />

          <label htmlFor="comentarios">Comentarios:</label>
          <input id="comentarios" />
        </form>

        <section>
          <table>
            <thead>
              <tr>
                <th>Producto</th><th>Cantidad</th><th>Precio Unitario</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <button onClick={() => poner(i.id, 0)} aria-label="Quitar">✕</button>
                    {i.nombre}
                  </td>
                  <td>{i.cantidad}</td>
                  <td>${i.precio.toFixed(2)}</td>
                  <td>${(i.cantidad * i.precio).toFixed(2)}</td>
                </tr>
              ))}
              <tr className="relleno"><td /><td /><td /><td /></tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3">Total de artículos: {articulos}</td>
                <td>${total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <Link className="boton" to="/recibo">Realizar pedido</Link>
        </section>

      </main>
    </>
  );
}