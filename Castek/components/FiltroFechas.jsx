// Filtro "Desde / Hasta" con botones rápidos. La lista se actualiza sola al cambiar una fecha.
// "cantidad" = cuántos resultados hay (para avisar cuando el rango no tiene nada).
const hoy = () => new Date().toLocaleDateString("sv-SE");
const primerDiaDelMes = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("sv-SE");
};

export default function FiltroFechas({ desde, hasta, setDesde, setHasta, cantidad, nombre = "resultados" }) {
  const hayFiltro = desde || hasta;
  const invertido = desde && hasta && desde > hasta;

  return (
    <div className="filtro-fechas">
      <label>Desde <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} /></label>
      <label>Hasta <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} /></label>
      <button type="button" onClick={() => { setDesde(hoy()); setHasta(hoy()); }}>Hoy</button>
      <button type="button" onClick={() => { setDesde(primerDiaDelMes()); setHasta(hoy()); }}>Este mes</button>
      <button type="button" onClick={() => { setDesde(""); setHasta(""); }} disabled={!hayFiltro}>Limpiar</button>
      {invertido && <small className="msj">"Desde" no puede ser después de "Hasta".</small>}
      {hayFiltro && !invertido && cantidad !== undefined && (
        <small>{cantidad === 0 ? `No hay ${nombre} en ese rango.` : `Mostrando ${cantidad} ${nombre} del rango elegido.`}</small>
      )}
    </div>
  );
}
