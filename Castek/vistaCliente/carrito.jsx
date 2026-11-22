import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { pedir } from "../api";
import { usePerfil } from "./registro";
import "../styles/carrito.css";

export default function Carrito({ carrito, poner, productos, vaciar, recargar }) {
  const navigate = useNavigate();
  const { datos } = usePerfil(); // nombre y teléfono del cliente, desde la base
  const [entrega, setEntrega] = useState("pickup");
  const [fecha, setFecha] = useState("");
  const [comentarios, setComentarios] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const hoy = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD

  const items = productos
    .filter((p) => carrito[p.id])
    .map((p) => ({ ...p, cantidad: carrito[p.id] }));

  const articulos = items.reduce((s, i) => s + i.cantidad, 0);
  const total = items.reduce((s, i) => s + i.cantidad * i.precio, 0);

  async function hacerPedido() {
    setError("");
    setEnviando(true);
    // Solo se manda qué productos y cuántos. Los precios y el total los calcula la base de datos.
    const { ok, datos: r } = await pedir("/pedidos", "POST", {
      tipo_entrega: entrega,
      fecha_entrega: fecha,
      observaciones: comentarios,
      items: items.map((i) => ({ id: i.id, cantidad: i.cantidad })),
    });
    setEnviando(false);
    if (!ok) return setError(r.error);
    vaciar();       // el carrito queda vacío
    recargar();     // el stock cambió, se vuelven a pedir los productos
    navigate(`/recibo/${r.id_ped}`);
  }

  return (
    <>
      <Navbar />
      <main className="pedido">

        <form onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="cliente">Cliente:</label>
          <input id="cliente" value={datos ? `${datos.nombre} ${datos.ap}` : ""} readOnly />

          <label htmlFor="telefono">Teléfono:</label>
          <input id="telefono" value={datos?.telefono ?? ""} readOnly />

          <label htmlFor="entrega">Tipo de entrega:</label>
          <select id="entrega" value={entrega} onChange={(e) => setEntrega(e.target.value)}>
            <option value="pickup">PickUp</option>
            <option value="domicilio">Domicilio</option>
          </select>

          <label htmlFor="fecha">Fecha de entrega:</label>
          <input id="fecha" type="date" min={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} />

          <label htmlFor="comentarios">Comentarios:</label>
          <input id="comentarios" value={comentarios} onChange={(e) => setComentarios(e.target.value)} />
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

          {error && <p className="error-pedido">{error}</p>}
          <button className="boton" onClick={hacerPedido} disabled={enviando || items.length === 0 || !fecha}>
            Realizar pedido
          </button>
        </section>

      </main>
    </>
  );
}