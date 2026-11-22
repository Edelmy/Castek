import os
import sys
import uuid
from datetime import date, datetime, time
from functools import wraps
from getpass import getpass#es para no mostrar la contraseña mientras la escribe

import psycopg2#permite la conexión con Postgre
from flask import Flask, jsonify, request, send_from_directory, session #jsonify convierte datos en respuestas JSON para enviarlas a react
from flask_cors import CORS#hace que flask y react se comuniquen apesar de estar en puertos distintos
from werkzeug.security import check_password_hash, generate_password_hash

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
# Las contraseñas son las que dejó el script 02_roles_privilegios.sql.
# Si algún día las cambias con ALTER ROLE, ponlas aquí o en variables de entorno.
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
        return psycopg2.connect(host='localhost', port=5432, dbname='castekDB', user=usuario, password=clave)
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

    # Se guarda en la sesión quién es y qué rol tiene.
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
def solo_rol(rol):
    # Decorador: la ruta solo funciona si hay sesión y el rol es el indicado
    def decorador(funcion):
        @wraps(funcion)
        def envuelta(*args, **kwargs):
            if 'id' not in session:
                return jsonify(error='Sin sesión'), 401
            if session['rol'] != rol:
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
            (usuario, generate_password_hash(password), nombre,
             d.get('ap', '').strip() or None, d.get('am', '').strip() or None,
             d.get('telefono', '').strip() or None, d.get('calle', '').strip() or None,
             d.get('numero', '').strip() or None, d.get('cruzamientos', '').strip() or None),
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
    return jsonify({k: (v or '') for k, v in zip(claves, f)})


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

        datos_dir = (calle, f.get('numero', '').strip(), f.get('cruzamientos', '').strip(),
                     f.get('comentario', '').strip(), f.get('ubicacion', '').strip())
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
            (nombre, f.get('ap', '').strip() or None, f.get('am', '').strip() or None,
             f.get('telefono', '').strip() or None, id_direc, id_client),
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
        total=float(p[3]), estatus=p[4], tipo_entrega=p[5], cliente=f'{p[6]} {p[7] or ""}'.strip(),
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