import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { pedir } from "../api";
import { Perfil, usePerfil } from "./registro";
import "../styles/registro.css";
import "../styles/historial.css";

export default function Historial() {
  const { datos, aviso, error, guardar } = usePerfil();
  const [pedidos, setPedidos] = useState([]);

  useEffect(() => {
    pedir("/pedidos").then(({ ok, datos }) => ok && setPedidos(datos));
  }, []);

  return (
    <>
      <Navbar />
      <main className="historial">
        <div>
          {datos && <Perfil boton="Actualizar" datos={datos} onGuardar={guardar} />}
          {aviso && <p className="aviso">{aviso}</p>}
          {error && <p className="aviso error-texto">{error}</p>}
        </div>

        <section>
          <h2>Historial de compras</h2>
          <table>
            <thead>
              <tr><th>Núm. compra</th><th>Fecha</th><th>Total de compra</th><th>Estatus</th></tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id_ped}>
                  <td><Link to={`/recibo/${p.id_ped}`}>#{p.id_ped}</Link></td>
                  <td>{p.fecha}</td>
                  <td>${p.total.toFixed(2)}</td>
                  <td>{p.estatus}</td>
                </tr>
              ))}
              {pedidos.length === 0 && <tr className="relleno"><td /><td /><td /><td /></tr>}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
