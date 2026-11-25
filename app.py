import glob
import os
import shutil
import subprocess
import sys
import threading
import uuid
from datetime import date, datetime, time, timedelta
from functools import wraps
from getpass import getpass#es para no mostrar la contraseña mientras la escribe

import psycopg2#permite la conexión con Postgre
from flask import Flask, jsonify, request, send_from_directory, session #jsonify convierte datos en respuestas JSON para enviarlas a react
from flask_cors import CORS#hace que flask y react se comuniquen apesar de estar en puertos distintos
from werkzeug.security import check_password_hash, generate_password_hash

from cifrado import cifrar, descifrar   # cifrado de los datos del cliente (ver cifrado.py)

app = Flask(__name__)
app.secret_key = 'secret_key' # Clave para proteger la sesión (la cookie del usuario)
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024   # las imágenes subidas pueden pesar máximo 5 MB

# Carpeta donde se guardan las imágenes de referencia de las direcciones
CARPETA_IMAGENES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
EXTENSIONES = {'png', 'jpg', 'jpeg', 'webp', 'gif'}

# React corre en otro puerto (5173), así que hay que permitirle hablar con Flask
CORS(app, supports_credentials=True, origins=['http://localhost:5173'])


# Cada rol de la aplicación usa SU cuenta de PostgreSQL. Así la base de datos
# (y no solo Flask) impide lo que ese rol no puede hacer.
# Si algún día las cambias con ALTER ROLE, ponlas aquí o en variables de entorno.
HOST, PUERTO, BASE = 'localhost', 5432, 'castekDB'   # dónde está PostgreSQL y cómo se llama la base

CUENTAS = {
    'postgres': ('postgres', os.environ.get('PG_CLAVE_POSTGRES', '190305-D')),   # solo para crear-usuario
    'auth':     ('castek_auth',     os.environ.get('PG_CLAVE_AUTH',     'CAMBIAR_castek_auth')),
    'Cliente':       ('castek_cliente',  os.environ.get('PG_CLAVE_CLIENTE',  'CAMBIAR_castek_cliente')),
    'Vendedor':      ('castek_vendedor', os.environ.get('PG_CLAVE_VENDEDOR', 'CAMBIAR_castek_vendedor')),
    'Administrador': ('castek_admin',    os.environ.get('PG_CLAVE_ADMIN',    'CAMBIAR_castek_admin')),
}


def Conexion(cuenta='postgres'):
    # Abre la conexión a PostgreSQL con la cuenta indicada (ver CUENTAS)
    usuario, clave = CUENTAS[cuenta]
    try:
        return psycopg2.connect(host=HOST, port=PUERTO, dbname=BASE, user=usuario, password=clave)
    except UnicodeDecodeError:
        # En Windows en español, PostgreSQL manda sus errores con acentos (ó, é) y Python no
        # logra leerlos. Es decir: la conexión FALLÓ, pero el texto del error no se puede mostrar.
        raise SystemExit(
            f"\nNo se pudo conectar a PostgreSQL con el usuario '{usuario}'.\n"
            "Causas más comunes:\n"
            f"  1. La contraseña de '{usuario}' no es la que está en app.py (diccionario CUENTAS).\n"
            "  2. PostgreSQL está apagado (Servicios de Windows -> postgresql).\n"
            "  3. La base 'castekDB' no existe o se escribió distinto.\n"
        )


def conexion_de_sesion():
    # La conexión que corresponde al rol de quien tiene la sesión abierta
    conn = Conexion(session['rol'])
    # Le avisa a la base QUIÉN es la persona (sale de la sesión, nunca del navegador).
    # Los triggers de bitácora lo usan para anotar quién hizo cada cambio.
    cur = conn.cursor()
    cur.execute("SELECT set_config('app.id_usuario', %s, false)", (str(session['id']),))
    conn.commit()
    return conn


# UNA SESIÓN POR USUARIO
# Se recuerda en memoria qué cuentas están en uso: { nombre de usuario: {token, visto} }.
# La pantalla avisa cada ~45 s que sigue abierta; si pasan 3 minutos sin avisos (cerraron la
# pestaña sin salir) la cuenta se libera sola. Si Flask se reinicia, todos deben entrar de nuevo.
SESIONES = {}
CANDADO_SESIONES = threading.Lock()
LIBERAR_TRAS = timedelta(minutes=3)


@app.before_request
def vigilar_sesion():
    # Cada petición a /api renueva "visto". Si la sesión de esta cookie ya no es la vigente, se cierra.
    if 'id' not in session or not request.path.startswith('/api/'):
        return None
    with CANDADO_SESIONES:
        activa = SESIONES.get(session.get('usuario'))
        if activa is None or activa['token'] != session.get('token'):
            session.clear()
        else:
            activa['visto'] = datetime.now()
    return None


def cerrar_sesiones_de(id_usuario):
    # Cuando el administrador desactiva a alguien o le cambia la contraseña, su sesión abierta se cierra
    if id_usuario == session.get('id'):
        return
    with CANDADO_SESIONES:
        for nombre in [n for n, a in SESIONES.items() if a.get('id') == id_usuario]:
            del SESIONES[nombre]


# LOGIN
@app.post('/api/login')
def login():
    datos = request.get_json() # lo que manda React: {"usuario": "...", "password": "..."}
    usuario = datos.get('usuario', '').strip()
    password = datos.get('password', '')

    conn = Conexion('auth')   # el "portero": solo puede consultar usuarios para el login
    cur = conn.cursor()
    cur.execute(
        """SELECT u.id_usuario, u.nom_usua, u.contrasena, r.nom_rol
           FROM usuario u
           JOIN rol r ON r.id_rol = u.id_rol
           WHERE u.nom_usua = %s AND u.estado = TRUE""",
        (usuario,),
    )
    fila = cur.fetchone()      # None si el usuario no existe
    conn.close()

    # Se compara la contraseña escrita contra el HASH guardado en la base.
    if fila is None or not check_password_hash(fila[2], password):
        return jsonify(error='Usuario o contraseña incorrectos'), 401

    # Si esa cuenta ya está abierta en otro navegador/equipo, no se deja entrar.
    # (Desde el mismo navegador sí: la cookie trae el mismo token.)
    with CANDADO_SESIONES:
        activa = SESIONES.get(fila[1])
        en_uso = (activa is not None
                  and datetime.now() - activa['visto'] < LIBERAR_TRAS
                  and session.get('token') != activa['token'])
        if en_uso:
            return jsonify(error='Esta sesión está siendo utilizada por otra persona. '
                                 'Intenta más tarde o pide que cierre su sesión.'), 409
        token = uuid.uuid4().hex
        SESIONES[fila[1]] = {'token': token, 'visto': datetime.now(), 'id': fila[0]}

    # Se guarda en la sesión quién es y qué rol tiene.
    session.clear()
    session['token'] = token
    session['id'] = fila[0]
    session['usuario'] = fila[1]
    session['rol'] = fila[3]

    # React recibe el rol y con eso decide qué pantalla mostrar.
    return jsonify(usuario=fila[1], rol=fila[3])
#-------------------------------------------------------------------------------------


# ESTA ES LA RUTA NUEVA: React la llama al abrir o recargar la página
# para saber si ya hay una sesión abierta y con qué rol.
@app.get('/api/me')
def me():
    if 'id' not in session:
        return jsonify(error='Sin sesión'), 401
    return jsonify(usuario=session['usuario'], rol=session['rol'])


@app.post('/api/logout')
def logout():
    with CANDADO_SESIONES:   # libera la cuenta para que otra persona pueda entrar
        activa = SESIONES.get(session.get('usuario'))
        if activa and activa['token'] == session.get('token'):
            del SESIONES[session['usuario']]
    session.clear()
    return jsonify(mensaje='Sesión cerrada')


# ---------------------------------------------------------------- MENÚ
@app.get('/api/productos')
def productos():
    if 'id' not in session:
        return jsonify(error='Sin sesión'), 401

    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT pv.id_tipo_prod_vent, p.id_prod, p.nom_prod, pv.precio, t.nom_tipo_venta, p.stock
           FROM producto p
           JOIN presentprodvent pv ON pv.id_prod = p.id_prod
           JOIN tipoventa t        ON t.id_tipo_venta = pv.id_tipo_venta
           WHERE p.estado = TRUE
           ORDER BY p.id_prod"""
    )
    filas = cur.fetchall()
    conn.close()

    # id = la presentación (producto + cómo se vende). Es lo que usará el carrito.
    return jsonify([
        {'id': f[0], 'id_prod': f[1], 'nombre': f[2], 'precio': float(f[3]), 'tipo': f[4], 'stock': f[5]}
        for f in filas
    ])


# ---------------------------------------------------------------- AYUDAS
def solo_rol(*roles):
    # Decorador: la ruta solo funciona si hay sesión y el rol es uno de los indicados
    def decorador(funcion):
        @wraps(funcion)
        def envuelta(*args, **kwargs):
            if 'id' not in session:
                return jsonify(error='Sin sesión'), 401
            if session['rol'] not in roles:
                return jsonify(error='No tienes permiso para esto'), 403
            return funcion(*args, **kwargs)
        return envuelta
    return decorador


def mensaje_de(error):
    # Saca el texto que escribieron los triggers con RAISE EXCEPTION (ej. "Stock insuficiente...")
    return (error.diag.message_primary or str(error)) if hasattr(error, 'diag') else str(error)


def datos_cliente(cur):
    # (id_client, id_direc) del cliente que tiene la sesión abierta, o None
    cur.execute('SELECT id_client, id_direc FROM cliente WHERE id_usuario = %s', (session['id'],))
    return cur.fetchone()


# ---------------------------------------------------------------- CREAR CUENTA (pública)
@app.post('/api/registro')
def registro():
    d = request.get_json() or {}
    usuario = d.get('usuario', '').strip()
    password = d.get('password', '')
    nombre = d.get('nombre', '').strip()
    if not usuario or not nombre or not d.get('ap', '').strip() or len(password) < 6:
        return jsonify(error='Escribe tu nombre, tu apellido paterno, un usuario y una contraseña de al menos 6 caracteres'), 400

    conn = Conexion('auth')
    cur = conn.cursor()
    try:
        # La función de la base SIEMPRE crea el usuario con rol Cliente
        cur.execute(
            'SELECT registrar_cliente(%s, %s, %s, %s, %s, %s, %s, %s, %s)',
            (usuario, generate_password_hash(password), cifrar(nombre),
             cifrar(d.get('ap', '').strip() or None), cifrar(d.get('am', '').strip() or None),
             cifrar(d.get('telefono', '').strip() or None), cifrar(d.get('calle', '').strip() or None),
             cifrar(d.get('numero', '').strip() or None), cifrar(d.get('cruzamientos', '').strip() or None)),
        )
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        return jsonify(error='Ese usuario ya existe, elige otro'), 409
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(mensaje='Cuenta creada, ya puedes iniciar sesión'), 201


# ---------------------------------------------------------------- PERFIL DEL CLIENTE
@app.get('/uploads/<nombre>')
def ver_imagen(nombre):
    return send_from_directory(CARPETA_IMAGENES, nombre)


@app.get('/api/perfil')
@solo_rol('Cliente')
def perfil_ver():
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT c.nombre, c.ap, c.am, c.telefono, d.calle, d.numero, d.cruzamientos,
                  d.ima_ref, d.com_ref, d.link_ubi
           FROM cliente c LEFT JOIN direccion d ON d.id_direc = c.id_direc
           WHERE c.id_usuario = %s""",
        (session['id'],),
    )
    f = cur.fetchone()
    conn.close()
    if f is None:
        return jsonify(error='Tu cuenta no tiene registro de cliente'), 404
    claves = ['nombre', 'ap', 'am', 'telefono', 'calle', 'numero', 'cruzamientos', 'imagen', 'comentario', 'ubicacion']
    return jsonify({k: (descifrar(v) or '') for k, v in zip(claves, f)})   # descifra los datos del cliente


@app.put('/api/perfil')
@solo_rol('Cliente')
def perfil_guardar():
    f = request.form   # el formulario llega como FormData (porque puede traer una imagen)
    nombre = f.get('nombre', '').strip()
    calle = f.get('calle', '').strip()
    if not nombre or not calle:
        return jsonify(error='El nombre y la calle son obligatorios'), 400

    # Si subió una imagen nueva, se guarda con un nombre único
    imagen = None
    archivo = request.files.get('imagen')
    if archivo and archivo.filename:
        ext = archivo.filename.rsplit('.', 1)[-1].lower()
        if ext not in EXTENSIONES:
            return jsonify(error='La imagen debe ser png, jpg, jpeg, webp o gif'), 400
        os.makedirs(CARPETA_IMAGENES, exist_ok=True)
        nom_archivo = f'{uuid.uuid4().hex}.{ext}'
        archivo.save(os.path.join(CARPETA_IMAGENES, nom_archivo))
        imagen = f'/uploads/{nom_archivo}'

    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cli = datos_cliente(cur)
        if cli is None:
            return jsonify(error='Tu cuenta no tiene registro de cliente'), 404
        id_client, id_direc = cli

        # Todo lo que se guarda del domicilio va cifrado (la ruta de la imagen no: es solo un nombre de archivo)
        datos_dir = (cifrar(calle), cifrar(f.get('numero', '').strip()), cifrar(f.get('cruzamientos', '').strip()),
                     cifrar(f.get('comentario', '').strip()), cifrar(f.get('ubicacion', '').strip()))
        if id_direc is None:
            cur.execute(
                """INSERT INTO direccion (calle, numero, cruzamientos, com_ref, link_ubi, ima_ref)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING id_direc""",
                datos_dir + (imagen,),
            )
            id_direc = cur.fetchone()[0]
        else:
            # Si no subió imagen nueva, se conserva la que ya tenía (COALESCE)
            cur.execute(
                """UPDATE direccion SET calle=%s, numero=%s, cruzamientos=%s, com_ref=%s, link_ubi=%s,
                          ima_ref = COALESCE(%s, ima_ref)
                   WHERE id_direc = %s""",
                datos_dir + (imagen, id_direc),
            )

        cur.execute(
            'UPDATE cliente SET nombre=%s, ap=%s, am=%s, telefono=%s, id_direc=%s WHERE id_client=%s',
            (cifrar(nombre), cifrar(f.get('ap', '').strip() or None), cifrar(f.get('am', '').strip() or None),
             cifrar(f.get('telefono', '').strip() or None), id_direc, id_client),
        )
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(mensaje='Datos guardados')


# ---------------------------------------------------------------- PEDIDOS DEL CLIENTE
@app.post('/api/pedidos')
@solo_rol('Cliente')
def pedido_crear():
    d = request.get_json() or {}
    items = d.get('items') or []
    tipo = d.get('tipo_entrega', 'pickup')
    try:
        fecha = date.fromisoformat(d.get('fecha_entrega', ''))
    except ValueError:
        return jsonify(error='Elige la fecha de entrega'), 400
    if fecha < date.today():
        return jsonify(error='La fecha de entrega no puede ser anterior a hoy'), 400
    if tipo not in ('pickup', 'domicilio'):
        return jsonify(error='Tipo de entrega no válido'), 400
    if not items:
        return jsonify(error='Tu pedido está vacío'), 400

    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cli = datos_cliente(cur)
        if cli is None:
            return jsonify(error='Tu cuenta no tiene registro de cliente'), 404
        id_client, id_direc = cli
        if tipo == 'domicilio' and id_direc is None:
            return jsonify(error='Para entrega a domicilio primero guarda tu dirección en tu perfil'), 400

        # La base exige que la entrega no sea anterior a "ahora"; si se pide para hoy, se toma el final del día
        entrega = datetime.combine(fecha, time(23, 59))
        cur.execute(
            """INSERT INTO pedidos (fecha_entrega, observaciones, tipo_entrega, id_client)
               VALUES (%s, %s, %s, %s) RETURNING id_ped""",
            (entrega, (d.get('observaciones') or '').strip() or None, tipo, id_client),
        )
        id_ped = cur.fetchone()[0]

        lineas = []
        for it in items:
            cantidad = int(it.get('cantidad', 0))
            if cantidad <= 0:
                raise ValueError('Cantidad no válida')
            # id = presentación (producto + cómo se vende). Aquí se saca cuál es cuál.
            cur.execute('SELECT id_prod, id_tipo_venta FROM presentprodvent WHERE id_tipo_prod_vent = %s', (it.get('id'),))
            pres = cur.fetchone()
            if pres is None:
                raise ValueError('Uno de los productos ya no existe')
            lineas.append((pres[0], pres[1], cantidad))

        # Los productos se insertan SIEMPRE ordenados por id_prod. Si dos pedidos se hacen a la vez
        # y cada uno recorre los productos en distinto orden, PostgreSQL puede trabarlos (deadlock).
        for id_prod, id_tipo, cantidad in sorted(lineas):
            # No se manda precio ni total: los calculan los triggers de la base de datos
            cur.execute(
                'INSERT INTO detallepedido (cantidad, id_prod, id_tipo_venta, id_ped) VALUES (%s, %s, %s, %s)',
                (cantidad, id_prod, id_tipo, id_ped),
            )
        conn.commit()
    except (psycopg2.Error, ValueError, TypeError) as e:
        conn.rollback()     # si algo falla (ej. no hay stock) no se guarda NADA del pedido
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(id_ped=id_ped), 201


@app.get('/api/pedidos')
@solo_rol('Cliente')
def pedidos_lista():
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT p.id_ped, p.fecha_pedido, p.total, p.estatus
           FROM pedidos p JOIN cliente c ON c.id_client = p.id_client
           WHERE c.id_usuario = %s ORDER BY p.id_ped DESC""",
        (session['id'],),
    )
    filas = cur.fetchall()
    conn.close()
    return jsonify([
        {'id_ped': f[0], 'fecha': f[1].strftime('%d/%m/%Y'), 'total': float(f[2]), 'estatus': f[3]}
        for f in filas
    ])


@app.get('/api/pedidos/<int:id_ped>')
@solo_rol('Cliente')
def pedido_ver(id_ped):
    conn = conexion_de_sesion()
    cur = conn.cursor()
    # El "AND c.id_usuario = ..." hace que un cliente NO pueda ver pedidos de otro
    cur.execute(
        """SELECT p.id_ped, p.fecha_pedido, p.fecha_entrega, p.total, p.estatus, p.tipo_entrega,
                  c.nombre, c.ap
           FROM pedidos p JOIN cliente c ON c.id_client = p.id_client
           WHERE p.id_ped = %s AND c.id_usuario = %s""",
        (id_ped, session['id']),
    )
    p = cur.fetchone()
    if p is None:
        conn.close()
        return jsonify(error='Pedido no encontrado'), 404
    cur.execute(
        """SELECT pr.nom_prod, tv.nom_tipo_venta, dp.cantidad, dp.precio_uni, dp.sub_total
           FROM detallepedido dp
           JOIN producto pr  ON pr.id_prod = dp.id_prod
           JOIN tipoventa tv ON tv.id_tipo_venta = dp.id_tipo_venta
           WHERE dp.id_ped = %s ORDER BY dp.id_det_ped""",
        (id_ped,),
    )
    filas = cur.fetchall()
    conn.close()
    return jsonify(
        id_ped=p[0], fecha=p[1].strftime('%d/%m/%Y'), fecha_entrega=p[2].strftime('%d/%m/%Y'),
        total=float(p[3]), estatus=p[4], tipo_entrega=p[5], cliente=f'{descifrar(p[6])} {descifrar(p[7]) or ""}'.strip(),
        detalle=[{'producto': f[0], 'tipo': f[1], 'cantidad': f[2], 'precio': float(f[3]), 'subtotal': float(f[4])} for f in filas],
    )


# ---------------------------------------------------------------- FAVORITOS DEL CLIENTE
@app.get('/api/favoritos')
@solo_rol('Cliente')
def favoritos_lista():
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT f.id_prod FROM favorito f JOIN cliente c ON c.id_client = f.id_client
           WHERE c.id_usuario = %s AND f.activo = TRUE""",
        (session['id'],),
    )
    ids = [f[0] for f in cur.fetchall()]
    conn.close()
    return jsonify(ids)


@app.put('/api/favoritos/<int:id_prod>')
@solo_rol('Cliente')
def favorito_cambiar(id_prod):
    activo = bool((request.get_json() or {}).get('activo'))
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cli = datos_cliente(cur)
        if cli is None:
            return jsonify(error='Tu cuenta no tiene registro de cliente'), 404
        # Si ya existía la fila solo cambia "activo"; si no, se crea. Nunca se borra nada.
        cur.execute(
            """INSERT INTO favorito (id_client, id_prod, activo) VALUES (%s, %s, %s)
               ON CONFLICT (id_client, id_prod) DO UPDATE SET activo = EXCLUDED.activo""",
            (cli[0], id_prod, activo),
        )
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(mensaje='ok')


# ---------------------------------------------------------------- VENTAS (Vendedor y Administrador)
PERSONAL = ('Vendedor', 'Administrador')


@app.get('/api/clientes')
@solo_rol(*PERSONAL)
def clientes_lista():
    # Para elegir al cliente al registrar una venta (si no se elige, es venta de mostrador)
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute("SELECT id_client, nombre, ap FROM cliente WHERE estado = TRUE")
    filas = cur.fetchall()
    conn.close()
    lista = [{'id': f[0], 'nombre': f'{descifrar(f[1])} {descifrar(f[2]) or ""}'.strip()} for f in filas]
    lista.sort(key=lambda c: c['nombre'].lower())      # se ordena aquí, ya descifrado
    return jsonify(lista)


@app.post('/api/ventas')
@solo_rol(*PERSONAL)
def venta_crear():
    d = request.get_json() or {}
    items = d.get('items') or []
    metodo = d.get('metodo_pago', 'efectivo')
    if metodo not in ('efectivo', 'transferencia'):
        return jsonify(error='Método de pago no válido'), 400
    if not items:
        return jsonify(error='Agrega al menos un producto'), 400

    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        lineas = []
        for it in items:
            cantidad = int(it.get('cantidad', 0))
            if cantidad <= 0:
                raise ValueError('Cantidad no válida')
            cur.execute('SELECT id_prod, id_tipo_venta FROM presentprodvent WHERE id_tipo_prod_vent = %s', (it.get('id'),))
            pres = cur.fetchone()
            if pres is None:
                raise ValueError('Uno de los productos ya no existe')
            lineas.append((pres[0], pres[1], cantidad))

        # El vendedor sale de la SESIÓN (no del navegador). El total lo calculan los triggers.
        cur.execute(
            'INSERT INTO venta (metodo_pago, id_usuario, id_client) VALUES (%s, %s, %s) RETURNING id_venta',
            (metodo, session['id'], d.get('id_client') or None),
        )
        id_venta = cur.fetchone()[0]
        for id_prod, id_tipo, cantidad in sorted(lineas):      # ordenados para evitar deadlocks
            cur.execute(
                'INSERT INTO detalleventa (cantidad, id_prod, id_tipo_venta, id_venta) VALUES (%s, %s, %s, %s)',
                (cantidad, id_prod, id_tipo, id_venta),
            )
        conn.commit()
    except (psycopg2.Error, ValueError, TypeError) as e:
        conn.rollback()      # si falla algo (ej. sin stock) no se guarda NADA de la venta
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(id_venta=id_venta), 201


@app.get('/api/ventas')
@solo_rol(*PERSONAL)
def ventas_lista():
    # Fechas AAAA-MM-DD (opcionales). El vendedor ve SOLO sus ventas; el administrador, todas.
    try:
        desde = date.fromisoformat(request.args.get('desde', '')) if request.args.get('desde') else None
        hasta = date.fromisoformat(request.args.get('hasta', '')) if request.args.get('hasta') else None
    except ValueError:
        return jsonify(error='Fecha no válida'), 400
    es_admin = session['rol'] == 'Administrador'

    conn = conexion_de_sesion()
    cur = conn.cursor()
    filtro_fechas = (desde, desde, hasta, hasta)
    if es_admin:
        cur.execute(
            """SELECT v.id_venta, v.fecha_vent, v.total, v.estado, v.metodo_pago, c.nombre, c.ap, u.nombre
               FROM venta v
               LEFT JOIN cliente c ON c.id_client = v.id_client
               JOIN usuario u      ON u.id_usuario = v.id_usuario
               WHERE (%s::date IS NULL OR v.fecha_vent >= %s::date)
                 AND (%s::date IS NULL OR v.fecha_vent < %s::date + 1)
               ORDER BY v.id_venta DESC""",
            filtro_fechas,
        )
    else:
        # El vendedor no puede leer la tabla usuario, así que su nombre sale de la sesión
        cur.execute(
            """SELECT v.id_venta, v.fecha_vent, v.total, v.estado, v.metodo_pago, c.nombre, c.ap, %s
               FROM venta v
               LEFT JOIN cliente c ON c.id_client = v.id_client
               WHERE (%s::date IS NULL OR v.fecha_vent >= %s::date)
                 AND (%s::date IS NULL OR v.fecha_vent < %s::date + 1)
                 AND v.id_usuario = %s
               ORDER BY v.id_venta DESC""",
            (session['usuario'],) + filtro_fechas + (session['id'],),
        )
    filas = cur.fetchall()
    conn.close()
    return jsonify([
        {'id_venta': f[0], 'fecha': f[1].strftime('%d/%m/%Y %H:%M'), 'total': float(f[2]), 'activa': f[3],
         'metodo_pago': f[4], 'cliente': f'{descifrar(f[5])} {descifrar(f[6]) or ""}'.strip() if f[5] else 'Mostrador', 'vendedor': f[7]}
        for f in filas
    ])


@app.get('/api/ventas/<int:id_venta>')
@solo_rol(*PERSONAL)
def venta_ver(id_venta):
    es_admin = session['rol'] == 'Administrador'
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT v.id_venta, v.fecha_vent, v.total, v.estado, v.metodo_pago, c.nombre, c.ap
           FROM venta v LEFT JOIN cliente c ON c.id_client = v.id_client
           WHERE v.id_venta = %s AND (%s OR v.id_usuario = %s)""",
        (id_venta, es_admin, session['id']),
    )
    v = cur.fetchone()
    if v is None:
        conn.close()
        return jsonify(error='Venta no encontrada'), 404
    cur.execute(
        """SELECT pr.nom_prod, tv.nom_tipo_venta, dv.cantidad, dv.precio_uni, dv.sub_total
           FROM detalleventa dv
           JOIN producto pr  ON pr.id_prod = dv.id_prod
           JOIN tipoventa tv ON tv.id_tipo_venta = dv.id_tipo_venta
           WHERE dv.id_venta = %s ORDER BY dv.id_dv""",
        (id_venta,),
    )
    filas = cur.fetchall()
    conn.close()
    return jsonify(
        id_venta=v[0], fecha=v[1].strftime('%d/%m/%Y %H:%M'), total=float(v[2]), activa=v[3], metodo_pago=v[4],
        cliente=f'{descifrar(v[5])} {descifrar(v[6]) or ""}'.strip() if v[5] else 'Mostrador',
        detalle=[{'producto': f[0], 'tipo': f[1], 'cantidad': f[2], 'precio': float(f[3]), 'subtotal': float(f[4])} for f in filas],
    )


@app.post('/api/ventas/<int:id_venta>/cancelar')
@solo_rol(*PERSONAL)
def venta_cancelar(id_venta):
    # Nunca se borra: se marca como cancelada y el trigger devuelve el stock.
    # "AND estado" evita cancelar dos veces (doble clic); el vendedor solo cancela las suyas.
    es_admin = session['rol'] == 'Administrador'
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cur.execute(
            'UPDATE venta SET estado = FALSE WHERE id_venta = %s AND estado AND (%s OR id_usuario = %s) RETURNING id_venta',
            (id_venta, es_admin, session['id']),
        )
        if cur.fetchone() is None:
            conn.rollback()
            return jsonify(error='La venta no existe, ya estaba cancelada o no es tuya'), 404
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(mensaje='Venta cancelada')


# ---------------------------------------------------------------- PEDIDOS (Vendedor y Administrador)
ESTATUS = ('pendiente', 'en_proceso', 'entregado', 'cancelado', 'no_entregado')


@app.get('/api/gestion/pedidos')
@solo_rol(*PERSONAL)
def gestion_pedidos():
    estatus = request.args.get('estatus') or None    # vacío = todos
    if estatus and estatus not in ESTATUS:
        return jsonify(error='Estatus no válido'), 400
    try:   # fechas AAAA-MM-DD (opcionales): se filtra por la fecha de ENTREGA
        desde = date.fromisoformat(request.args['desde']) if request.args.get('desde') else None
        hasta = date.fromisoformat(request.args['hasta']) if request.args.get('hasta') else None
    except ValueError:
        return jsonify(error='Fecha no válida'), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT p.id_ped, c.nombre, c.ap, c.telefono, p.tipo_entrega, p.fecha_entrega, p.total, p.estatus,
                  p.danado, p.observaciones, d.calle, d.numero, d.cruzamientos, d.link_ubi
           FROM pedidos p
           JOIN cliente c        ON c.id_client = p.id_client
           LEFT JOIN direccion d ON d.id_direc = c.id_direc
           WHERE (%s::text IS NULL OR p.estatus = %s)
             AND (%s::date IS NULL OR p.fecha_entrega >= %s::date)
             AND (%s::date IS NULL OR p.fecha_entrega < %s::date + 1)
           ORDER BY (p.estatus IN ('pendiente', 'en_proceso')) DESC, p.fecha_entrega, p.id_ped""",
        (estatus, estatus, desde, desde, hasta, hasta),
    )
    filas = cur.fetchall()

    # Qué lleva cada pedido (una sola consulta para todos los pedidos de la lista)
    items = {}
    if filas:
        cur.execute(
            """SELECT dp.id_ped, dp.cantidad, pr.nom_prod, tv.nom_tipo_venta
               FROM detallepedido dp
               JOIN producto pr  ON pr.id_prod = dp.id_prod
               JOIN tipoventa tv ON tv.id_tipo_venta = dp.id_tipo_venta
               WHERE dp.id_ped = ANY(%s) ORDER BY dp.id_ped, pr.nom_prod""",
            ([f[0] for f in filas],),
        )
        for id_ped, cant, nombre, tipo in cur.fetchall():
            items.setdefault(id_ped, []).append({'cantidad': cant, 'producto': nombre, 'presentacion': tipo})
    conn.close()

    def direccion(f):
        partes = [descifrar(f[10]), descifrar(f[11]), descifrar(f[12])]
        return ', '.join(x for x in partes if x) or None

    return jsonify([
        {'id_ped': f[0], 'cliente': f'{descifrar(f[1])} {descifrar(f[2]) or ""}'.strip(), 'telefono': descifrar(f[3]), 'tipo_entrega': f[4],
         'fecha_entrega': f[5].strftime('%d/%m/%Y'), 'total': float(f[6]), 'estatus': f[7], 'danado': f[8],
         'observaciones': f[9], 'direccion': direccion(f) if f[4] == 'domicilio' else None, 'ubicacion': descifrar(f[13]),
         'productos': items.get(f[0], [])}
        for f in filas
    ])


@app.put('/api/gestion/pedidos/<int:id_ped>/estatus')
@solo_rol(*PERSONAL)
def gestion_pedido_estatus(id_ped):
    d = request.get_json() or {}
    nuevo, actual = d.get('estatus'), d.get('actual')
    if nuevo not in ESTATUS or actual not in ESTATUS:
        return jsonify(error='Estatus no válido'), 400
    pago = d.get('metodo_pago') or 'efectivo'
    if nuevo == 'entregado' and pago not in ('efectivo', 'transferencia'):
        return jsonify(error='Método de pago no válido'), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        # Al pasar a "entregado" el trigger t_pedido_a_venta crea la venta y lee el método de pago
        # de esta variable (true = solo vale dentro de esta transacción).
        cur.execute("SELECT set_config('app.metodo_pago', %s, true)", (pago,))
        # "AND estatus = actual": si otra persona ya lo cambió, este cambio no pisa el suyo.
        # El trigger devuelve el stock al cancelar / no entregar (salvo que esté dañado).
        cur.execute(
            """UPDATE pedidos SET estatus = %s, danado = COALESCE(%s, danado)
               WHERE id_ped = %s AND estatus = %s RETURNING id_ped""",
            (nuevo, d.get('danado'), id_ped, actual),
        )
        if cur.fetchone() is None:
            conn.rollback()
            return jsonify(error='Otra persona ya cambió este pedido. Actualiza la lista.'), 409
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(mensaje='Estatus actualizado')


# ---------------------------------------------------------------- ADMINISTRADOR
# Todas las rutas /api/admin/... usan la cuenta castek_admin. Nada se borra: "eliminar" = desactivar.
ADMIN = solo_rol('Administrador')


def correr(cur, conn, sql, params=()):
    # Ejecuta y confirma; si la base se niega (permiso, trigger, restricción) devuelve el mensaje
    try:
        cur.execute(sql, params)
        conn.commit()
        return None
    except psycopg2.Error as e:
        conn.rollback()
        return mensaje_de(e)


# ----- Productos (una fila = producto + cómo se vende) -----
@app.get('/api/admin/productos')
@ADMIN
def admin_productos():
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT pv.id_tipo_prod_vent, p.id_prod, p.nom_prod, p.descripcion, pv.precio,
                  t.id_tipo_venta, t.nom_tipo_venta, p.stock, p.estado
           FROM producto p
           JOIN presentprodvent pv ON pv.id_prod = p.id_prod
           JOIN tipoventa t        ON t.id_tipo_venta = pv.id_tipo_venta
           ORDER BY p.id_prod, t.id_tipo_venta"""
    )
    filas = cur.fetchall()
    conn.close()
    return jsonify([
        {'id': f[0], 'id_prod': f[1], 'nombre': f[2], 'descripcion': f[3] or '', 'precio': float(f[4]),
         'id_tipo_venta': f[5], 'tipo': f[6], 'stock': f[7], 'activo': f[8]}
        for f in filas
    ])


@app.get('/api/admin/tipos-venta')
@ADMIN
def admin_tipos_venta():
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute('SELECT id_tipo_venta, nom_tipo_venta FROM tipoventa ORDER BY id_tipo_venta')
    filas = cur.fetchall()
    conn.close()
    return jsonify([{'id': f[0], 'nombre': f[1]} for f in filas])


def leer_producto(d):
    # Valida lo que manda React. Devuelve (datos, error)
    nombre = (d.get('nombre') or '').strip()
    try:
        precio = float(d.get('precio'))
        stock = int(d.get('stock') or 0)
        tipo = int(d.get('id_tipo_venta'))
    except (TypeError, ValueError):
        return None, 'Revisa el precio, la existencia y la presentación'
    if not nombre or precio < 0 or stock < 0:
        return None, 'Escribe el nombre; el precio y la existencia no pueden ser negativos'
    return (nombre, (d.get('descripcion') or '').strip() or None, precio, stock, tipo), None


@app.post('/api/admin/productos')
@ADMIN
def admin_producto_crear():
    datos, error = leer_producto(request.get_json() or {})
    if error:
        return jsonify(error=error), 400
    nombre, descripcion, precio, stock, tipo = datos
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cur.execute('INSERT INTO producto (nom_prod, descripcion, stock) VALUES (%s, %s, %s) RETURNING id_prod',
                    (nombre, descripcion, stock))
        id_prod = cur.fetchone()[0]
        cur.execute('INSERT INTO presentprodvent (precio, id_tipo_venta, id_prod) VALUES (%s, %s, %s)',
                    (precio, tipo, id_prod))
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(id_prod=id_prod), 201


@app.put('/api/admin/productos/<int:id_pres>')
@ADMIN
def admin_producto_editar(id_pres):
    datos, error = leer_producto(request.get_json() or {})
    if error:
        return jsonify(error=error), 400
    nombre, descripcion, precio, stock, tipo = datos
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cur.execute('SELECT id_prod FROM presentprodvent WHERE id_tipo_prod_vent = %s', (id_pres,))
        fila = cur.fetchone()
        if fila is None:
            return jsonify(error='Producto no encontrado'), 404
        cur.execute('UPDATE producto SET nom_prod=%s, descripcion=%s, stock=%s WHERE id_prod=%s',
                    (nombre, descripcion, stock, fila[0]))
        cur.execute('UPDATE presentprodvent SET precio=%s, id_tipo_venta=%s WHERE id_tipo_prod_vent=%s',
                    (precio, tipo, id_pres))
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(mensaje='Producto actualizado')


@app.put('/api/admin/productos/<int:id_prod>/estado')
@ADMIN
def admin_producto_estado(id_prod):
    activo = bool((request.get_json() or {}).get('activo'))
    conn = conexion_de_sesion()
    cur = conn.cursor()
    error = correr(cur, conn, 'UPDATE producto SET estado = %s WHERE id_prod = %s', (activo, id_prod))
    conn.close()
    return (jsonify(error=error), 400) if error else jsonify(mensaje='ok')


# ----- Clientes -----
def leer_cliente(f):
    nombre = (f.get('nombre') or '').strip()
    if not nombre:
        return None, 'El nombre es obligatorio'
    tel = (f.get('telefono') or '').strip()
    if tel and not (tel.isdigit() and len(tel) == 10):
        return None, 'El teléfono debe tener 10 dígitos'
    limpio = lambda k: (f.get(k) or '').strip() or None
    return {'nombre': nombre, 'ap': limpio('ap'), 'am': limpio('am'), 'telefono': tel or None,
            'calle': limpio('calle'), 'numero': limpio('numero'), 'cruzamientos': limpio('cruzamientos')}, None


@app.get('/api/admin/clientes')
@ADMIN
def admin_clientes():
    q = (request.args.get('q') or '').strip().lower()
    conn = conexion_de_sesion()
    cur = conn.cursor()
    # Ya no se puede buscar con ILIKE en SQL: los datos están cifrados. Se traen, se descifran
    # y se filtra/ordena aquí (con pocos cientos de clientes es instantáneo).
    cur.execute(
        """SELECT c.id_client, c.nombre, c.ap, c.am, c.telefono, c.estado, c.id_usuario IS NOT NULL,
                  d.calle, d.numero, d.cruzamientos
           FROM cliente c LEFT JOIN direccion d ON d.id_direc = c.id_direc"""
    )
    filas = cur.fetchall()
    conn.close()
    clientes = []
    for f in filas:
        nombre, ap, am, tel, calle, numero, cruz = (descifrar(x) or '' for x in (f[1], f[2], f[3], f[4], f[7], f[8], f[9]))
        if q and not any(q in x.lower() for x in (nombre, ap, tel)):
            continue
        clientes.append({'id': f[0], 'nombre': nombre, 'ap': ap, 'am': am, 'telefono': tel, 'activo': f[5],
                         'tiene_cuenta': f[6], 'calle': calle, 'numero': numero, 'cruzamientos': cruz,
                         'direccion': ', '.join(x for x in (calle, numero, cruz) if x)})
    clientes.sort(key=lambda c: (not c['activo'], c['nombre'].lower(), c['ap'].lower()))
    return jsonify(clientes)


@app.post('/api/admin/clientes')
@ADMIN
def admin_cliente_crear():
    d, error = leer_cliente(request.get_json() or {})
    if error:
        return jsonify(error=error), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        id_direc = None
        if d['calle']:
            cur.execute('INSERT INTO direccion (calle, numero, cruzamientos) VALUES (%s, %s, %s) RETURNING id_direc',
                        (cifrar(d['calle']), cifrar(d['numero']), cifrar(d['cruzamientos'])))
            id_direc = cur.fetchone()[0]
        cur.execute('INSERT INTO cliente (nombre, ap, am, telefono, id_direc) VALUES (%s, %s, %s, %s, %s) RETURNING id_client',
                    (cifrar(d['nombre']), cifrar(d['ap']), cifrar(d['am']), cifrar(d['telefono']), id_direc))
        nuevo = cur.fetchone()[0]
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(id=nuevo), 201


@app.put('/api/admin/clientes/<int:id_client>')
@ADMIN
def admin_cliente_editar(id_client):
    d, error = leer_cliente(request.get_json() or {})
    if error:
        return jsonify(error=error), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cur.execute('SELECT id_direc FROM cliente WHERE id_client = %s', (id_client,))
        fila = cur.fetchone()
        if fila is None:
            return jsonify(error='Cliente no encontrado'), 404
        id_direc = fila[0]
        if d['calle'] and id_direc is None:
            cur.execute('INSERT INTO direccion (calle, numero, cruzamientos) VALUES (%s, %s, %s) RETURNING id_direc',
                        (cifrar(d['calle']), cifrar(d['numero']), cifrar(d['cruzamientos'])))
            id_direc = cur.fetchone()[0]
        elif d['calle']:
            cur.execute('UPDATE direccion SET calle=%s, numero=%s, cruzamientos=%s WHERE id_direc=%s',
                        (cifrar(d['calle']), cifrar(d['numero']), cifrar(d['cruzamientos']), id_direc))
        cur.execute('UPDATE cliente SET nombre=%s, ap=%s, am=%s, telefono=%s, id_direc=%s WHERE id_client=%s',
                    (cifrar(d['nombre']), cifrar(d['ap']), cifrar(d['am']), cifrar(d['telefono']), id_direc, id_client))
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(mensaje='Cliente actualizado')


@app.put('/api/admin/clientes/<int:id_client>/estado')
@ADMIN
def admin_cliente_estado(id_client):
    activo = bool((request.get_json() or {}).get('activo'))
    conn = conexion_de_sesion()
    cur = conn.cursor()
    error = correr(cur, conn, 'UPDATE cliente SET estado = %s WHERE id_client = %s', (activo, id_client))
    conn.close()
    return (jsonify(error=error), 400) if error else jsonify(mensaje='ok')


# ----- Usuarios (cuentas de acceso) -----
@app.get('/api/admin/usuarios')
@ADMIN
def admin_usuarios():
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT u.id_usuario, u.nom_usua, u.nombre, u.ap, u.telefono, r.nom_rol, u.estado
           FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
           ORDER BY u.estado DESC, r.id_rol, u.nom_usua"""
    )
    filas = cur.fetchall()
    conn.close()
    return jsonify([
        {'id': f[0], 'usuario': f[1], 'nombre': f'{descifrar(f[2])} {descifrar(f[3]) or ""}'.strip(), 'telefono': descifrar(f[4]) or '',
         'rol': f[5], 'activo': f[6], 'soy_yo': f[0] == session['id']}
        for f in filas
    ])


@app.post('/api/admin/usuarios')
@ADMIN
def admin_usuario_crear():
    d = request.get_json() or {}
    usuario, nombre, ap = (d.get('usuario') or '').strip(), (d.get('nombre') or '').strip(), (d.get('ap') or '').strip()
    rol, password = d.get('rol'), d.get('password') or ''
    if rol not in ('Administrador', 'Vendedor'):   # los clientes se registran solos en la pantalla de login
        return jsonify(error='Aquí solo se crean Administradores y Vendedores'), 400
    if not usuario or not nombre or not ap or len(password) < 6:
        return jsonify(error='Escribe nombre, apellido, usuario y una contraseña de al menos 6 caracteres'), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cur.execute(
            """INSERT INTO usuario (nombre, nom_usua, ap, telefono, contrasena, id_rol)
               VALUES (%s, %s, %s, %s, %s, (SELECT id_rol FROM rol WHERE nom_rol = %s))""",
            (nombre, usuario, ap, (d.get('telefono') or '').strip() or None, generate_password_hash(password), rol),
        )
        conn.commit()
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        return jsonify(error='Ese usuario ya existe, elige otro'), 409
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(mensaje='Usuario creado'), 201


@app.put('/api/admin/usuarios/<int:id_usuario>/estado')
@ADMIN
def admin_usuario_estado(id_usuario):
    activo = bool((request.get_json() or {}).get('activo'))
    conn = conexion_de_sesion()
    cur = conn.cursor()
    error = correr(cur, conn, 'UPDATE usuario SET estado = %s WHERE id_usuario = %s', (activo, id_usuario))
    conn.close()
    if not error and not activo:
        cerrar_sesiones_de(id_usuario)
    return (jsonify(error=error), 400) if error else jsonify(mensaje='ok')


@app.put('/api/admin/usuarios/<int:id_usuario>/password')
@ADMIN
def admin_usuario_password(id_usuario):
    password = (request.get_json() or {}).get('password') or ''
    if len(password) < 6:
        return jsonify(error='La contraseña debe tener al menos 6 caracteres'), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    error = correr(cur, conn, 'UPDATE usuario SET contrasena = %s WHERE id_usuario = %s',
                   (generate_password_hash(password), id_usuario))
    conn.close()
    if not error:
        cerrar_sesiones_de(id_usuario)
    return (jsonify(error=error), 400) if error else jsonify(mensaje='Contraseña restablecida')


# ----- Gastos -----
@app.get('/api/admin/gastos')
@ADMIN
def admin_gastos():
    try:
        desde = date.fromisoformat(request.args['desde']) if request.args.get('desde') else None
        hasta = date.fromisoformat(request.args['hasta']) if request.args.get('hasta') else None
    except ValueError:
        return jsonify(error='Fecha no válida'), 400
    tipo = request.args.get('tipo') or None    # vacío = todos
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT id_gas, fecha_gas, concepto, descripcion, tipo, monto FROM gastos
           WHERE estado
             AND (%s::date IS NULL OR fecha_gas >= %s::date) AND (%s::date IS NULL OR fecha_gas <= %s::date)
             AND (%s::text IS NULL OR tipo = %s)
           ORDER BY fecha_gas DESC, id_gas DESC""",
        (desde, desde, hasta, hasta, tipo, tipo),
    )
    filas = cur.fetchall()
    conn.close()
    return jsonify([
        {'id': f[0], 'fecha': f[1].isoformat(), 'concepto': f[2], 'descripcion': f[3] or '', 'tipo': f[4], 'monto': float(f[5])}
        for f in filas
    ])


@app.post('/api/admin/gastos')
@ADMIN
def admin_gasto_crear():
    d = request.get_json() or {}
    concepto = (d.get('concepto') or '').strip()
    tipo = d.get('tipo', 'variable')
    try:
        monto = float(d.get('monto'))
        fecha = date.fromisoformat(d.get('fecha') or date.today().isoformat())
    except (TypeError, ValueError):
        return jsonify(error='Revisa el monto y la fecha'), 400
    if not concepto or monto < 0 or tipo not in ('fijo', 'variable'):
        return jsonify(error='Escribe el concepto, un monto válido y el tipo (fijo o variable)'), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        cur.execute('INSERT INTO gastos (concepto, descripcion, monto, fecha_gas, tipo) VALUES (%s, %s, %s, %s, %s) RETURNING id_gas',
                    (concepto, (d.get('descripcion') or '').strip() or None, monto, fecha, tipo))
        id_gas = cur.fetchone()[0]
        # Queda anotado QUIÉN registró el gasto
        cur.execute('INSERT INTO detallegasto (id_usuario, id_gas) VALUES (%s, %s)', (session['id'], id_gas))
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(id=id_gas), 201


@app.post('/api/admin/gastos/<int:id_gas>/desactivar')
@ADMIN
def admin_gasto_desactivar(id_gas):
    conn = conexion_de_sesion()
    cur = conn.cursor()
    error = correr(cur, conn, 'UPDATE gastos SET estado = FALSE WHERE id_gas = %s AND estado', (id_gas,))
    conn.close()
    return (jsonify(error=error), 400) if error else jsonify(mensaje='Gasto eliminado')


# ----- Caja y utilidades -----
def rango_mes(texto):
    # "2026-11" -> (2026-11-01, 2026-11-30)
    try:
        inicio = date.fromisoformat((texto or date.today().strftime('%Y-%m')) + '-01')
    except ValueError:
        return None, None
    siguiente = date(inicio.year + (inicio.month == 12), inicio.month % 12 + 1, 1)
    return inicio, siguiente - timedelta(days=1)


@app.get('/api/admin/caja')
@ADMIN
def admin_caja():
    inicio, fin = rango_mes(request.args.get('mes'))
    if inicio is None:
        return jsonify(error='Mes no válido'), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT COALESCE(SUM(total), 0) FROM venta
           WHERE estado AND fecha_vent >= %s AND fecha_vent < %s::date + 1""", (inicio, fin))
    ventas = float(cur.fetchone()[0])
    cur.execute('SELECT COALESCE(SUM(monto), 0) FROM gastos WHERE estado AND fecha_gas BETWEEN %s AND %s', (inicio, fin))
    gastos = float(cur.fetchone()[0])
    cur.execute(
        """SELECT id_corte, fecha_corte, monto_inicial, total_ventas, total_gastos, monto_final, observaciones
           FROM corte WHERE estado AND fecha_corte >= %s AND fecha_corte < %s::date + 1
           ORDER BY fecha_corte DESC""", (inicio, fin))
    cortes = [{'id': f[0], 'fecha': f[1].strftime('%d/%m/%Y %H:%M'), 'inicial': float(f[2]), 'ventas': float(f[3]),
               'gastos': float(f[4]), 'final': float(f[5]), 'observaciones': f[6] or ''} for f in cur.fetchall()]
    conn.close()
    return jsonify(ventas=ventas, gastos=gastos, utilidad=round(ventas - gastos, 2), cortes=cortes)


@app.post('/api/admin/corte')
@ADMIN
def admin_corte():
    d = request.get_json() or {}
    try:
        inicial = float(d.get('monto_inicial') or 0)
    except ValueError:
        return jsonify(error='Monto inicial no válido'), 400
    if inicial < 0:
        return jsonify(error='El monto inicial no puede ser negativo'), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    try:
        # La base calcula ventas, gastos y monto final; y solo permite UN corte activo por día
        cur.execute('INSERT INTO corte (monto_inicial, observaciones) VALUES (%s, %s) RETURNING id_corte',
                    (inicial, (d.get('observaciones') or '').strip() or None))
        nuevo = cur.fetchone()[0]
        conn.commit()
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify(error=mensaje_de(e)), 400
    finally:
        conn.close()
    return jsonify(id=nuevo), 201


@app.post('/api/admin/respaldo')
@ADMIN
def admin_respaldo():
    # Copia de seguridad con pg_dump (viene con PostgreSQL). Se guarda en la carpeta "respaldos".
    exe = shutil.which('pg_dump')
    if exe is None:      # en Windows casi nunca está en el Path: se busca en la carpeta de instalación
        encontrados = sorted(glob.glob(r'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe'))
        exe = encontrados[-1] if encontrados else None
    if exe is None:
        return jsonify(error='No encuentro pg_dump (viene con PostgreSQL). Agrega su carpeta bin al Path de Windows.'), 500
    carpeta = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'respaldos')
    os.makedirs(carpeta, exist_ok=True)
    archivo = os.path.join(carpeta, f'castek_{datetime.now():%Y-%m-%d_%H-%M-%S}.sql')
    usuario, clave = CUENTAS['postgres']     # leer TODA la base requiere la cuenta principal
    resultado = subprocess.run(
        [exe, '-h', HOST, '-p', str(PUERTO), '-U', usuario, '-d', BASE, '-f', archivo],
        env={**os.environ, 'PGPASSWORD': clave, 'PGCLIENTENCODING': 'UTF8'}, capture_output=True,
    )
    if resultado.returncode != 0:
        if os.path.exists(archivo):
            os.remove(archivo)
        return jsonify(error='El respaldo falló. Revisa la contraseña de postgres en app.py y que PostgreSQL esté encendido.'), 500
    return jsonify(mensaje=f'Respaldo guardado: respaldos/{os.path.basename(archivo)}')


# ----- Reportes -----
@app.get('/api/admin/reportes/<tipo>')
@ADMIN
def admin_reporte(tipo):
    try:
        desde = date.fromisoformat(request.args['desde']) if request.args.get('desde') else date.today().replace(day=1)
        hasta = date.fromisoformat(request.args['hasta']) if request.args.get('hasta') else date.today()
    except ValueError:
        return jsonify(error='Fecha no válida'), 400
    conn = conexion_de_sesion()
    cur = conn.cursor()
    if tipo == 'caja':
        columnas = ['Fecha', 'Ingresos', 'Gastos', 'Utilidad']
        cur.execute(
            """WITH dias AS (SELECT generate_series(%s::date, %s::date, interval '1 day')::date AS dia),
                    v AS (SELECT fecha_vent::date AS dia, SUM(total) AS t FROM venta WHERE estado GROUP BY 1),
                    g AS (SELECT fecha_gas AS dia, SUM(monto) AS t FROM gastos WHERE estado GROUP BY 1)
               SELECT d.dia, COALESCE(v.t, 0), COALESCE(g.t, 0), COALESCE(v.t, 0) - COALESCE(g.t, 0)
               FROM dias d LEFT JOIN v ON v.dia = d.dia LEFT JOIN g ON g.dia = d.dia
               WHERE v.t IS NOT NULL OR g.t IS NOT NULL ORDER BY d.dia""", (desde, hasta))
        filas = [[f[0].strftime('%d/%m/%Y'), float(f[1]), float(f[2]), float(f[3])] for f in cur.fetchall()]
        dinero = [1, 2, 3]
    elif tipo == 'favoritos':
        columnas = ['Producto', 'Veces marcado como favorito']
        cur.execute(
            """SELECT p.nom_prod, COUNT(*) FROM favorito f JOIN producto p ON p.id_prod = f.id_prod
               WHERE f.activo AND p.estado GROUP BY p.nom_prod ORDER BY COUNT(*) DESC, p.nom_prod LIMIT 20""")
        filas = [[f[0], f[1]] for f in cur.fetchall()]
        dinero = []
    elif tipo == 'productos':
        columnas = ['Producto', 'Presentación', 'Unidades vendidas', 'Importe']
        cur.execute(
            """SELECT pr.nom_prod, tv.nom_tipo_venta, SUM(dv.cantidad), SUM(dv.sub_total)
               FROM detalleventa dv JOIN venta v ON v.id_venta = dv.id_venta
               JOIN producto pr ON pr.id_prod = dv.id_prod JOIN tipoventa tv ON tv.id_tipo_venta = dv.id_tipo_venta
               WHERE v.estado AND v.fecha_vent >= %s AND v.fecha_vent < %s::date + 1
               GROUP BY pr.nom_prod, tv.nom_tipo_venta ORDER BY SUM(dv.cantidad) DESC""", (desde, hasta))
        filas = [[f[0], f[1], int(f[2]), float(f[3])] for f in cur.fetchall()]
        dinero = [3]
    else:
        conn.close()
        return jsonify(error='Reporte desconocido'), 404
    conn.close()
    return jsonify(columnas=columnas, filas=filas, dinero=dinero)


# ---------------------------------------------------------------- CREAR USUARIOS (desde la terminal)
def crear_usuario():
    nombre = input('Nombre real (ej. Ana María): ').strip()
    nom_usua = input('Usuario para iniciar sesión (ej. ana): ').strip()
    ap = input('Apellido paterno: ').strip()
    rol = input('Rol (Administrador / Vendedor / Cliente): ').strip()
    password = getpass('Contraseña: ')

    conn = Conexion()
    cur = conn.cursor()
    cur.execute('SELECT id_rol FROM rol WHERE nom_rol = %s', (rol,))
    fila = cur.fetchone()
    if fila is None:
        print('Ese rol no existe. Revisa que esté escrito igual que en la tabla rol.')
        conn.close()
        return

    if rol == 'Cliente':          # los datos personales del cliente se guardan cifrados
        nombre, ap = cifrar(nombre), cifrar(ap)
    cur.execute(
        'INSERT INTO usuario (nombre, nom_usua, ap, contrasena, id_rol) VALUES (%s, %s, %s, %s, %s) RETURNING id_usuario',
        (nombre, nom_usua, ap, generate_password_hash(password), fila[0]),   # se guarda el hash, no la contraseña
    )
    id_usuario = cur.fetchone()[0]

    # Si es Cliente, también se crea su registro en la tabla cliente, unido a su cuenta.
    # Las dos inserciones se confirman juntas: o se crean las dos o no se crea ninguna.
    if rol == 'Cliente':
        cur.execute(
            'INSERT INTO cliente (nombre, ap, id_usuario) VALUES (%s, %s, %s)',
            (nombre, ap, id_usuario),
        )

    conn.commit()
    conn.close()
    print('Usuario creado' + (' (con su registro de cliente)' if rol == 'Cliente' else ''))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'crear-usuario':
        crear_usuario()
    else:
        app.run(debug=True, port=5000)