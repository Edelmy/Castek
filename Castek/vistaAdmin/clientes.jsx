import { Layout } from "../vistaVendedor/registrarCompra";

export default function Clientes() {
  return (
    <Layout titulo="Clientes" rol="admin">
      <div className="herramientas">
        <input placeholder="Buscar cliente..." />
        <button className="boton">Agregar cliente</button>
      </div>

      <table>
        <thead>
          <tr><th>Nombre</th><th>Apellido</th><th>Teléfono</th><th>Dirección</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          <tr className="relleno"><td /><td /><td /><td /><td /></tr>
        </tbody>
      </table>
    </Layout>
  );
}