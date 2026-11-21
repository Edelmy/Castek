import Navbar from "../components/Navbar";
import { Perfil } from "./registro";
import "../styles/registro.css";
import "../styles/historial.css";

export default function Historial() {
  return (
    <>
      <Navbar />
      <main className="historial">
        <Perfil boton="Actualizar" />

        <section>
          <h2>Historial de compras</h2>
          <table>
            <thead>
              <tr><th>Núm. compra</th><th>Fecha</th><th>Total de compra</th></tr>
            </thead>
            <tbody>
              <tr className="relleno"><td /><td /><td /></tr>
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}