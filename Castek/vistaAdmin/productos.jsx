import { useCallback, useEffect, useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";
import { pedir } from "../api";

const vacio = { nombre: "", descripcion: "", id_tipo_venta: "", precio: "", stock: "" };

export default function Productos() {
  const [lista, setLista] = useState([]);
  const [tipos, setTipos] = useState([]);        // Pieza / Rebanada / Caja
  const [form, setForm] = useState(vacio);
  const [editando, setEditando] = useState(null); // id de la presentación que se edita
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { ok, datos } = await pedir("/admin/productos");
    if (ok) setLista(datos);
  }, []);

  useEffect(() => {
    cargar();
    pedir("/admin/tipos-venta").then(({ ok, datos }) => {
      if (ok) { setTipos(datos); setForm((f) => ({ ...f, id_tipo_venta: datos[0]?.id ?? "" })); }
    });
  }, [cargar]);

  const cambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const limpiar = () => { setForm({ ...vacio, id_tipo_venta: tipos[0]?.id ?? "" }); setEditando(null); setError(""); };

  async function guardar(e) {
    e.preventDefault();
    setError("");
    const { ok, datos } = editando
      ? await pedir(`/admin/productos/${editando}`, "PUT", form)
      : await pedir("/admin/productos", "POST", form);
    if (!ok) return setError(datos.error);
    limpiar();
    cargar();
  }

  const editar = (p) => {
    setEditando(p.id);
    setForm({ nombre: p.nombre, descripcion: p.descripcion, id_tipo_venta: p.id_tipo_venta, precio: p.precio, stock: p.stock });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function alternar(p) {
    const { ok, datos } = await pedir(`/admin/productos/${p.id_prod}/estado`, "PUT", { activo: !p.activo });
    if (!ok) setError(datos.error);
    cargar();
  }

  return (
    <Layout titulo="Productos" rol="admin">
      <form className="herramientas" onSubmit={guardar}>
        <label>Producto <input name="nombre" value={form.nombre} onChange={cambiar} required /></label>
        <label>Descripción <input name="descripcion" value={form.descripcion} onChange={cambiar} /></label>
        <label>Presentación
          <select name="id_tipo_venta" value={form.id_tipo_venta} onChange={cambiar}>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        <label>Precio <input name="precio" type="number" min="0" step="0.01" value={form.precio} onChange={cambiar} required /></label>
        <label>Existencia <input name="stock" type="number" min="0" value={form.stock} onChange={cambiar} /></label>
        <button className="boton">{editando ? "Guardar cambios" : "Agregar producto"}</button>
        {editando && <button type="button" className="boton" onClick={limpiar}>Cancelar</button>}
      </form>
      {error && <p className="msj">{error}</p>}

      <table>
        <thead>
          <tr><th>Producto</th><th>Presentación</th><th>Precio</th><th>Existencia</th><th>Disponibilidad</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {lista.map((p) => (
            <tr key={p.id} className={p.activo ? "" : "inactiva"}>
              <td title={p.descripcion}>{p.nombre}</td>
              <td>{p.tipo}</td>
              <td>${p.precio.toFixed(2)}</td>
              <td>{p.stock === 0 ? "AGOTADO" : p.stock}</td>
              <td>
                <button aria-pressed={p.activo} onClick={() => alternar(p)}>
                  {p.activo ? "Disponible" : "Desactivado"}
                </button>
              </td>
              <td><button onClick={() => editar(p)}>Editar</button></td>
            </tr>
          ))}
          {lista.length === 0 && <tr className="relleno"><td colSpan="6" /></tr>}
        </tbody>
      </table>
    </Layout>
  );
}
