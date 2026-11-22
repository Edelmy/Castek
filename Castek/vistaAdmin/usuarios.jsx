import { Layout } from "../vistaVendedor/registrarCompra";

export default function Usuarios() {
  return (
    <Layout titulo="Usuarios" rol="admin">
      <div className="herramientas">
        <button className="boton">Agregar usuario</button>
      </div>

      <table>
        <thead>
          <tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          <tr className="relleno"><td /><td /><td /><td /></tr>
        </tbody>
      </table>
    </Layout>
  );
}