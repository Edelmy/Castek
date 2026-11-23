import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "./registrarCompra";
import { pedir } from "../api";
import FiltroFechas from "../components/FiltroFechas";

export default function Ventas({ rol = "vendedor" }) {
  const [ventas, setVentas] = useState([]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { ok, datos } = await pedir(`/ventas?desde=${desde}&hasta=${hasta}`);
    if (ok) { setVentas(datos); setError(""); } else setError(datos.error);
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  async function cancelar(v) {
    if (!window.confirm(`¿Cancelar la venta ${v.id_venta}? Los productos regresan al inventario.`)) return;
    const { ok, datos } = await pedir(`/ventas/${v.id_venta}/cancelar`, "POST");
    if (!ok) setError(datos.error);
    cargar();
  }

  const totalActivas = ventas.filter((v) => v.activa).reduce((s, v) => s + v.total, 0);

  return (
    <Layout titulo="Ventas" rol={rol}>
      <div className="herramientas">
        <Link className="boton" to={`/${rol}/registrar`}>Registrar venta</Link>
      </div>
      <FiltroFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} cantidad={ventas.length} nombre="ventas" />
      {error && <p className="msj">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>N.º venta</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th>
            <th>Pago</th><th>Total</th><th>Estado</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {ventas.map((v) => (
            <tr key={v.id_venta} className={v.activa ? "" : "inactiva"}>
              <td><Link to={`/${rol}/recibo/${v.id_venta}`}>#{v.id_venta}</Link></td>
              <td>{v.fecha}</td><td>{v.cliente}</td><td>{v.vendedor}</td>
              <td>{v.metodo_pago}</td><td>${v.total.toFixed(2)}</td>
              <td>{v.activa ? "Activa" : "Cancelada"}</td>
              <td>{v.activa && <button className="peligro" onClick={() => cancelar(v)}>Cancelar</button>}</td>
            </tr>
          ))}
          {ventas.length === 0 && <tr className="relleno"><td colSpan="8" /></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan="5">Total de ventas activas</td><td colSpan="3">${totalActivas.toFixed(2)}</td></tr>
        </tfoot>
      </table>
    </Layout>
  );
}
