import { useCallback, useEffect, useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";
import { pedir } from "../api";

const vacio = { nombre: "", ap: "", am: "", telefono: "", calle: "", numero: "", cruzamientos: "" };

export default function Clientes() {
  const [clientes, setClientes] = useState([]);
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState(vacio);
  const [editando, setEditando] = useState(null);
  const [abierto, setAbierto] = useState(false);   // muestra u oculta el formulario
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { ok, datos } = await pedir(`/admin/clientes?q=${encodeURIComponent(busca)}`);
    if (ok) setClientes(datos);
  }, [busca]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const cerrar = () => { setForm(vacio); setEditando(null); setAbierto(false); setError(""); };

  async function guardar(e) {
    e.preventDefault();
    setError("");
    const { ok, datos } = editando
      ? await pedir(`/admin/clientes/${editando}`, "PUT", form)
      : await pedir("/admin/clientes", "POST", form);
    if (!ok) return setError(datos.error);
    cerrar();
    cargar();
  }

  const editar = (c) => {
    setEditando(c.id);
    setForm({ nombre: c.nombre, ap: c.ap, am: c.am, telefono: c.telefono, calle: c.calle, numero: c.numero, cruzamientos: c.cruzamientos });
    setAbierto(true);
  };

  async function alternar(c) {
    const { ok, datos } = await pedir(`/admin/clientes/${c.id}/estado`, "PUT", { activo: !c.activo });
    if (!ok) setError(datos.error);
    cargar();
  }

  return (
    <Layout titulo="Clientes" rol="admin">
      <div className="herramientas">
        <input placeholder="Buscar por nombre, apellido o teléfono..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="boton" onClick={() => (abierto ? cerrar() : setAbierto(true))}>
          {abierto ? "Cerrar formulario" : "Agregar cliente"}
        </button>
      </div>

      {abierto && (
        <form className="herramientas" onSubmit={guardar}>
          <label>Nombre <input name="nombre" value={form.nombre} onChange={cambiar} required /></label>
          <label>Apellido paterno <input name="ap" value={form.ap} onChange={cambiar} /></label>
          <label>Apellido materno <input name="am" value={form.am} onChange={cambiar} /></label>
          <label>Teléfono <input name="telefono" value={form.telefono} onChange={cambiar} pattern="[0-9]{10}" title="10 dígitos" /></label>
          <label>Calle <input name="calle" value={form.calle} onChange={cambiar} /></label>
          <label>Núm. <input name="numero" value={form.numero} onChange={cambiar} /></label>
          <label>Cruzamientos <input name="cruzamientos" value={form.cruzamientos} onChange={cambiar} /></label>
          <button className="boton">{editando ? "Guardar cambios" : "Guardar cliente"}</button>
        </form>
      )}
      {error && <p className="msj">{error}</p>}

      <table>
        <thead>
          <tr><th>Nombre</th><th>Apellido</th><th>Teléfono</th><th>Dirección</th><th>Cuenta</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id} className={c.activo ? "" : "inactiva"}>
              <td>{c.nombre}</td>
              <td>{c.ap} {c.am}</td>
              <td>{c.telefono}</td>
              <td>{c.direccion}</td>
              <td>{c.tiene_cuenta ? "Sí" : "No"}</td>
              <td>
                <button onClick={() => editar(c)}>Editar</button>
                <button className={c.activo ? "peligro" : ""} onClick={() => alternar(c)}>
                  {c.activo ? "Desactivar" : "Activar"}
                </button>
              </td>
            </tr>
          ))}
          {clientes.length === 0 && <tr className="relleno"><td colSpan="6" /></tr>}
        </tbody>
      </table>
    </Layout>
  );
}
