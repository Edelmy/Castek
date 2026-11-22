import { useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";
import { productosEjemplo as productos } from "../vistaCliente/menu";

const vacio = { nombre: "", precio: "", existencia: "" };

export default function Productos() {
  const [lista, setLista] = useState(
    productos.map((p) => ({ ...p, existencia: 0, disponible: true }))
  );
  const [form, setForm] = useState(vacio);
  const [editando, setEditando] = useState(null);

  const cambiar = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const cancelar = () => { setForm(vacio); setEditando(null); };

  const guardar = (e) => {
    e.preventDefault();
    const datos = {
      nombre: form.nombre,
      precio: Number(form.precio),
      existencia: Number(form.existencia) || 0,
    };
    setLista((l) =>
      editando
        ? l.map((p) => (p.id === editando ? { ...p, ...datos } : p))
        : [...l, { id: Date.now(), imagen: "", disponible: true, ...datos }]
    );
    cancelar();
  };

  const editar = (p) => {
    setEditando(p.id);
    setForm({ nombre: p.nombre, precio: p.precio, existencia: p.existencia });
  };

  const eliminar = (id) => {
    if (window.confirm("¿Eliminar este producto?")) setLista((l) => l.filter((p) => p.id !== id));
  };

  const alternar = (id) =>
    setLista((l) => l.map((p) => (p.id === id ? { ...p, disponible: !p.disponible } : p)));

  return (
    <Layout titulo="Productos" rol="admin">
      <form className="herramientas" onSubmit={guardar}>
        <label>Producto <input name="nombre" value={form.nombre} onChange={cambiar} required /></label>
        <label>Precio <input name="precio" type="number" min="0" step="0.01" value={form.precio} onChange={cambiar} required /></label>
        <label>Existencia <input name="existencia" type="number" min="0" value={form.existencia} onChange={cambiar} /></label>
        <button className="boton">{editando ? "Guardar cambios" : "Agregar producto"}</button>
        {editando && <button type="button" className="boton" onClick={cancelar}>Cancelar</button>}
      </form>

      <table>
        <thead>
          <tr><th>Producto</th><th>Precio</th><th>Existencia</th><th>Disponibilidad</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          {lista.map((p) => (
            <tr key={p.id}>
              <td>{p.nombre}</td>
              <td>${p.precio.toFixed(2)}</td>
              <td>{p.existencia}</td>
              <td>
                <button aria-pressed={p.disponible} onClick={() => alternar(p.id)}>
                  {p.disponible ? "Disponible" : "Agotado"}
                </button>
              </td>
              <td>
                <button onClick={() => editar(p)}>Editar</button>
                <button className="peligro" onClick={() => eliminar(p.id)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}