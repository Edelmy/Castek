import { useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";

const mesActual = new Date().toLocaleDateString("sv-SE").slice(0, 7); // AAAA-MM

export default function Caja() {
  const [mes, setMes] = useState(mesActual);
  const [aviso, setAviso] = useState("");

  const respaldar = () => {
    if (window.confirm(`¿Ejecutar el respaldo manual de ${mes}?`)) {
      setAviso(`Respaldo de ${mes} solicitado.`);
    }
  };

  return (
    <Layout titulo="Caja y utilidades" rol="admin">
      <div className="herramientas">
        <label>Mes <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></label>
      </div>

      <div className="cifras">
        <div>Ventas<b>$0.00</b></div>
        <div>Gastos<b>$0.00</b></div>
        <div>Utilidad real<b>$0.00</b></div>
      </div>
      <p>Utilidad real = Ventas − Gastos</p>

      <section className="cierre">
        <h2>Cierre de mes</h2>
        <p>Genera una copia de seguridad de la base de datos al terminar el mes.</p>
        <button className="boton" onClick={respaldar}>Respaldar base de datos</button>
        {aviso && <small>{aviso}</small>}
      </section>
    </Layout>
  );
}