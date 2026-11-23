// Dirección de Flask. Si algún día cambia el puerto, solo se cambia aquí.
export const SERVIDOR = "";   // vacío = mismo sitio; Vite reenvía /api a Flask (ver vite.config.js)
export const API = `${SERVIDOR}/api`;

// Atajo para hablar con Flask. Siempre manda la cookie de sesión.
//   pedir("/pedidos")                          -> GET
//   pedir("/pedidos", "POST", { items: [] })   -> POST con JSON
// Devuelve { ok, datos }  (datos es lo que respondió Flask; si falló, datos.error es el mensaje)
export async function pedir(ruta, metodo = "GET", cuerpo) {
  const opciones = { method: metodo, credentials: "include" };
  if (cuerpo instanceof FormData) {
    opciones.body = cuerpo; // el navegador pone solo el tipo de contenido
  } else if (cuerpo !== undefined) {
    opciones.headers = { "Content-Type": "application/json" };
    opciones.body = JSON.stringify(cuerpo);
  }
  try {
    const r = await fetch(`${API}${ruta}`, opciones);
    const datos = await r.json().catch(() => ({}));
    return { ok: r.ok, datos };
  } catch {
    return { ok: false, datos: { error: "No se pudo conectar con el servidor. ¿Está encendido Flask?" } };
  }
}
