import { useCallback, useEffect, useState } from "react";
import { Layout } from "../vistaVendedor/registrarCompra";
import { pedir } from "../api";
import CampoNumero from "../components/CampoNumero";

const mesActual = new Date().toLocaleDateString("sv-SE").slice(0, 7); // AAAA-MM
const dinero = (n) => `$${n.toFixed(2)}`;

export default function Caja() {
  const [mes, setMes] = useState(mesActual);
  const [datos, setDatos] = useState({ ventas: 0, gastos: 0, utilidad: 0, cortes: [] });
  const [inicial, setInicial] = useState("0");
  const [obs, setObs] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    const { ok, datos: d } = await pedir(`/admin/caja?mes=${mes}`);
    if (ok) setDatos(d); else setError(d.error);
  }, [mes]);

  useEffect(() => { cargar(); }, [cargar]);

  async function hacerCorte(e) {
    e.preventDefault();
    setError(""); setAviso("");
    const { ok, datos: d } = await pedir("/admin/corte", "POST", { monto_inicial: inicial, observaciones: obs });
    if (!ok) return setError(d.error);
    setAviso("Corte de hoy registrado");
    setObs("");
    cargar();
  }

  async function respaldar() {
    if (!window.confirm("¿Generar ahora una copia de seguridad de la base de datos?")) return;
    setError(""); setAviso("Generando respaldo...");
    const { ok, datos: d } = await pedir("/admin/respaldo", "POST");
    if (ok) setAviso(d.mensaje); else { setAviso(""); setError(d.error); }
  }

  return (
    <Layout titulo="Caja y utilidades" rol="admin">
      <div className="herramientas">
        <label>Mes <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></label>
      </div>

      <div className="cifras">
        <div>Ventas<b>{dinero(datos.ventas)}</b></div>
        <div>Gastos<b>{dinero(datos.gastos)}</b></div>
        <div>Utilidad real<b>{dinero(datos.utilidad)}</b></div>
      </div>
      <p>Utilidad real = Ventas − Gastos (ventas canceladas y gastos eliminados no cuentan)</p>

      <section className="cierre">
        <h2>Corte de caja de hoy</h2>
        <form className="herramientas" onSubmit={hacerCorte}>
          <label>Dinero con el que se abrió la caja <CampoNumero tipo="decimal" value={inicial} onChange={(e) => setInicial(e.target.value)} /></label>
          <label>Observaciones <input value={obs} onChange={(e) => setObs(e.target.value)} /></label>
          <button className="boton">Hacer corte de hoy</button>
        </form>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Inicial</th><th>Ventas</th><th>Gastos</th><th>Monto final</th><th>Observaciones</th></tr>
          </thead>
          <tbody>
            {datos.cortes.map((c) => (
              <tr key={c.id}>
                <td>{c.fecha}</td><td>{dinero(c.inicial)}</td><td>{dinero(c.ventas)}</td>
                <td>{dinero(c.gastos)}</td><td><b>{dinero(c.final)}</b></td><td>{c.observaciones}</td>
              </tr>
            ))}
            {datos.cortes.length === 0 && <tr className="relleno"><td colSpan="6" /></tr>}
          </tbody>
        </table>
      </section>

      <section className="cierre">
        <h2>Cierre de mes</h2>
        <p>Genera una copia de seguridad de la base de datos al terminar el mes.</p>
        <button className="boton" onClick={respaldar}>Respaldar base de datos</button>
      </section>

      {error && <p className="msj">{error}</p>}
      {aviso && <p>{aviso}</p>}
    </Layout>
  );
}
