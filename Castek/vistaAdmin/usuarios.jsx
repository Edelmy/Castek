import { useCallback, useEffect, useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";
import { pedir } from "../api";

const vacio = { nombre: "", ap: "", usuario: "", telefono: "", rol: "Vendedor", password: "" };

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState(vacio);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    const { ok, datos } = await pedir("/admin/usuarios");
    if (ok) setUsuarios(datos);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function crear(e) {
    e.preventDefault();
    setError(""); setAviso("");
    const { ok, datos } = await pedir("/admin/usuarios", "POST", form);
    if (!ok) return setError(datos.error);
    setForm(vacio); setAbierto(false); setAviso("Usuario creado");
    cargar();
  }

  async function alternar(u) {
    setError(""); setAviso("");
    const { ok, datos } = await pedir(`/admin/usuarios/${u.id}/estado`, "PUT", { activo: !u.activo });
    if (!ok) setError(datos.error);
    cargar();
  }

  async function restablecer(u) {
    const nueva = window.prompt(`Nueva contraseña para ${u.usuario} (mínimo 6 caracteres):`);
    if (!nueva) return;
    setError(""); setAviso("");
    const { ok, datos } = await pedir(`/admin/usuarios/${u.id}/password`, "PUT", { password: nueva });
    if (ok) setAviso(`Contraseña de ${u.usuario} restablecida`); else setError(datos.error);
  }

  return (
    <Layout titulo="Usuarios" rol="admin">
      <div className="herramientas">
        <button className="boton" onClick={() => setAbierto(!abierto)}>
          {abierto ? "Cerrar formulario" : "Agregar usuario"}
        </button>
      </div>

      {abierto && (
        <form className="herramientas" onSubmit={crear}>
          <label>Nombre <input name="nombre" value={form.nombre} onChange={cambiar} required /></label>
          <label>Apellido <input name="ap" value={form.ap} onChange={cambiar} required /></label>
          <label>Usuario <input name="usuario" value={form.usuario} onChange={cambiar} required /></label>
          <label>Teléfono <input name="telefono" value={form.telefono} onChange={cambiar} /></label>
          <label>Rol
            <select name="rol" value={form.rol} onChange={cambiar}>
              <option>Vendedor</option>
              <option>Administrador</option>
            </select>
          </label>
          <label>Contraseña <input name="password" type="password" minLength="6" value={form.password} onChange={cambiar} required /></label>
          <button className="boton">Crear usuario</button>
        </form>
      )}
      {error && <p className="msj">{error}</p>}
      {aviso && <p>{aviso}</p>}

      <table>
        <thead>
          <tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} className={u.activo ? "" : "inactiva"}>
              <td>{u.usuario}{u.soy_yo && " (tú)"}</td>
              <td>{u.nombre}</td>
              <td>{u.rol}</td>
              <td>{u.activo ? "Activo" : "Desactivado"}</td>
              <td>
                {u.rol !== "Cliente" && <button onClick={() => restablecer(u)}>Restablecer contraseña</button>}
                <button className={u.activo ? "peligro" : ""} onClick={() => alternar(u)}>
                  {u.activo ? "Desactivar" : "Activar"}
                </button>
              </td>
            </tr>
          ))}
          {usuarios.length === 0 && <tr className="relleno"><td colSpan="5" /></tr>}
        </tbody>
      </table>
    </Layout>
  );
}
