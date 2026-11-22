import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Layout } from "./registrarCompra";
import { pedir } from "../api";
import "../styles/recibo.css";

export default function ReciboVendedor({ rol = "vendedor" }) {
  const { id } = useParams();
  const { state } = useLocation();        // "recibió" y "cambio" solo se conocen justo después de cobrar
  const [venta, setVenta] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    pedir(`/ventas/${id}`).then(({ ok, datos }) => (ok ? setVenta(datos) : setError(datos.error)));
  }, [id]);

  return (
    <Layout titulo="Recibo" rol={rol} volver={`/${rol}/ventas`}>
      {error && <p className="msj">{error}</p>}
      {venta && (
        <>
          <header>
            <img src="/imagenes/cupcake.png" alt="" />
            <div>
              <h2>{venta.activa ? "¡ Venta registrada !" : "Venta CANCELADA"}</h2>
              <p>Gracias por su preferencia ♡</p>
            </div>
          </header>

          <dl>
            <dt>🎫 N.º de venta:</dt><dd>{venta.id_venta}</dd>
            <dt>📅 Fecha:</dt><dd>{venta.fecha}</dd>
            <dt>👤 Cliente</dt><dd>{venta.cliente}</dd>
            <dt>💳 Pago:</dt><dd>{venta.metodo_pago}</dd>
            <dt>$$ Total:</dt><dd>${venta.total.toFixed(2)}</dd>
            {state?.recibido > 0 && venta.metodo_pago === "efectivo" && (
              <>
                <dt>💵 Recibió:</dt><dd>${state.recibido.toFixed(2)}</dd>
                <dt>↩ Cambio:</dt><dd>${state.cambio.toFixed(2)}</dd>
              </>
            )}
          </dl>

          <hr />

          <table>
            <thead>
              <tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr>
            </thead>
            <tbody>
              {venta.detalle.map((d, i) => (
                <tr key={i}>
                  <td>{d.producto} ({d.tipo})</td>
                  <td>{d.cantidad}</td>
                  <td>${d.precio.toFixed(2)}</td>
                  <td>${d.subtotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p>¡Gracias por su compra!</p>
        </>
      )}

      <Link className="boton" to={`/${rol}/registrar`}>Nueva venta</Link>
    </Layout>
  );
}
