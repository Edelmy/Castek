import { useCallback, useEffect, useState } from "react";
import { Layout } from "./registrarCompra";
import { pedir } from "../api";

// [valor en la base de datos, texto que se ve]
const estados = [
  ["pendiente", "Pendiente"],
  ["en_proceso", "En preparación"],
  ["entregado", "Entregado"],
  ["cancelado", "Cancelado"],
  ["no_entregado", "No entregado"],
];
const FINALES = ["entregado", "cancelado", "no_entregado"];   // ya no se pueden cambiar

export default function Pedidos({ rol = "vendedor" }) {
  const [filtro, setFiltro] = useState("");        // "" = todos
  const [pedidos, setPedidos] = useState([]);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { ok, datos } = await pedir(`/gestion/pedidos?estatus=${filtro}`);
    if (ok) { setPedidos(datos); setError(""); } else setError(datos.error);
  }, [filtro]);

  useEffect(() => {
    cargar();
    const reloj = setInterval(cargar, 20000);   // se actualiza solo cada 20 s (llegan pedidos nuevos)
    return () => clearInterval(reloj);
  }, [cargar]);

  async function cambiar(p, nuevo) {
    if (nuevo === p.estatus) return;
    let danado = null;
    if (nuevo === "cancelado" && !window.confirm(`¿Cancelar el pedido ${p.id_ped}? Los productos regresan al inventario.`)) return;
    if (nuevo === "no_entregado") {
      // Si el producto se dañó NO regresa al inventario
      danado = window.confirm("¿El producto se dañó?\nAceptar = sí (NO regresa al inventario)\nCancelar = no (regresa al inventario)");
    }
    const { ok, datos } = await pedir(`/gestion/pedidos/${p.id_ped}/estatus`, "PUT", { estatus: nuevo, actual: p.estatus, danado });
    if (!ok) setError(datos.error);
    cargar();
  }

  return (
    <Layout titulo="Pedidos" rol={rol}>
      <div className="filtros">
        <button className={filtro === "" ? "activo" : ""} onClick={() => setFiltro("")}>Todos</button>
        {estados.map(([valor, texto]) => (
          <button key={valor} className={filtro === valor ? "activo" : ""} onClick={() => setFiltro(valor)}>
            {texto}
          </button>
        ))}
      </div>
      {error && <p className="msj">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>N.º pedido</th><th>Cliente</th><th>Entrega</th>
            <th>Fecha de entrega</th><th>Total</th><th>Estado</th>
            {rol === "admin" && <th>Acciones</th>}
          </tr>
        </thead>
        <tbody>
          {pedidos.map((p) => (
            <tr key={p.id_ped}>
              <td>#{p.id_ped}</td>
              <td title={p.observaciones || ""}>{p.cliente}<br /><small>{p.telefono}</small></td>
              <td title={p.direccion || ""}>
                {p.tipo_entrega === "pickup" ? "PickUp" : "Domicilio"}
                {p.direccion && <><br /><small>{p.direccion}</small></>}
                {p.ubicacion && <><br /><a href={p.ubicacion} target="_blank" rel="noreferrer">Ver mapa</a></>}
              </td>
              <td>{p.fecha_entrega}</td>
              <td>${p.total.toFixed(2)}</td>
              <td>
                <select value={p.estatus} disabled={FINALES.includes(p.estatus)} onChange={(e) => cambiar(p, e.target.value)}>
                  {estados.map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                </select>
                {p.danado && <small> (dañado)</small>}
              </td>
              {rol === "admin" && (
                <td>
                  {!FINALES.includes(p.estatus) && (
                    <button className="peligro" onClick={() => cambiar(p, "cancelado")}>Cancelar</button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {pedidos.length === 0 && <tr className="relleno"><td colSpan={rol === "admin" ? 7 : 6} /></tr>}
        </tbody>
      </table>
    </Layout>
  );
}
