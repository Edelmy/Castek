--
-- PostgreSQL database dump
--

\restrict XgqA57Su5duG1eTJG992zpx2gFkE4UzXLTrvh3QhQya8mCSYThhFf0Rwu2IdoBb

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: cambiar_mi_acceso(integer, character varying, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cambiar_mi_acceso(p_id_usuario integer, p_nuevo_nom_usua character varying DEFAULT NULL::character varying, p_nuevo_hash character varying DEFAULT NULL::character varying) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    UPDATE usuario
       SET nom_usua   = COALESCE(p_nuevo_nom_usua, nom_usua),
           contrasena = COALESCE(p_nuevo_hash, contrasena)
     WHERE id_usuario = p_id_usuario
       AND id_rol = (SELECT id_rol FROM rol WHERE nom_rol = 'Cliente');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario cliente no encontrado';
    END IF;
END $$;


ALTER FUNCTION public.cambiar_mi_acceso(p_id_usuario integer, p_nuevo_nom_usua character varying, p_nuevo_hash character varying) OWNER TO postgres;

--
-- Name: f_bitacora(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_bitacora() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_antes   jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
    v_despues jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
BEGIN
    v_antes   := v_antes   - 'contrasena';     -- nunca guardar el hash en la bitácora
    v_despues := v_despues - 'contrasena';

    INSERT INTO bitacora (tabla, operacion, id_registro, id_usuario,
                          conexion, rol_bd, datos_antes, datos_despues)
    VALUES (TG_TABLE_NAME, TG_OP,
            COALESCE(v_despues, v_antes) ->> TG_ARGV[0],
            NULLIF(current_setting('app.id_usuario', true), '')::int,   -- Flask lo manda con set_config
            session_user, current_setting('role', true),
            v_antes, v_despues);
    RETURN NULL;
END $$;


ALTER FUNCTION public.f_bitacora() OWNER TO postgres;

--
-- Name: f_bloquear(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_bloquear() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION '%', TG_ARGV[0];
    RETURN NULL;
END $$;


ALTER FUNCTION public.f_bloquear() OWNER TO postgres;

--
-- Name: f_corte_calcular(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_corte_calcular() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_dia DATE := NEW.fecha_corte::date;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('castek_corte_' || v_dia::text));

    IF EXISTS (SELECT 1 FROM corte WHERE estado AND fecha_corte::date = v_dia) THEN
        RAISE EXCEPTION 'Ya existe un corte activo para el %', v_dia;
    END IF;

    SELECT COALESCE(SUM(total), 0) INTO NEW.total_ventas
      FROM venta WHERE estado AND fecha_vent::date = v_dia;

    SELECT COALESCE(SUM(monto), 0) INTO NEW.total_gastos
      FROM gastos WHERE estado AND fecha_gas = v_dia;

    NEW.monto_final := NEW.monto_inicial + NEW.total_ventas - NEW.total_gastos;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_corte_calcular() OWNER TO postgres;

--
-- Name: f_corte_inmutable(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_corte_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.fecha_corte    IS DISTINCT FROM OLD.fecha_corte
       OR NEW.total_ventas  IS DISTINCT FROM OLD.total_ventas
       OR NEW.total_gastos  IS DISTINCT FROM OLD.total_gastos
       OR NEW.monto_inicial IS DISTINCT FROM OLD.monto_inicial
       OR NEW.monto_final   IS DISTINCT FROM OLD.monto_final THEN
        RAISE EXCEPTION 'Un corte no se puede modificar; solo sus observaciones o anularlo y crear otro';
    END IF;
    IF OLD.estado = FALSE AND NEW.estado = TRUE THEN
        RAISE EXCEPTION 'Un corte anulado no se puede reactivar; crea uno nuevo';
    END IF;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_corte_inmutable() OWNER TO postgres;

--
-- Name: f_detallepedido_antes(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_detallepedido_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_precio  NUMERIC(10,2);
    v_estatus TEXT;
    v_dif     INT;
BEGIN
    SELECT estatus INTO v_estatus FROM pedidos WHERE id_ped = NEW.id_ped
     FOR NO KEY UPDATE;
    IF v_estatus IN ('entregado', 'cancelado', 'no_entregado') THEN
        RAISE EXCEPTION 'El pedido % ya está %, no se puede modificar', NEW.id_ped, v_estatus;
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT precio INTO v_precio FROM presentprodvent
         WHERE id_prod = NEW.id_prod AND id_tipo_venta = NEW.id_tipo_venta;
        IF v_precio IS NULL THEN
            RAISE EXCEPTION 'El producto % no tiene precio para esa presentación', NEW.id_prod;
        END IF;

        UPDATE producto SET stock = stock - NEW.cantidad
         WHERE id_prod = NEW.id_prod AND estado = TRUE AND stock >= NEW.cantidad;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Stock insuficiente o producto inactivo (producto %)', NEW.id_prod;
        END IF;

        NEW.precio_uni := v_precio;
        NEW.sub_total  := v_precio * NEW.cantidad;
    ELSE
        -- UPDATE: solo cambia la cantidad; el stock se ajusta por la diferencia
        v_dif := NEW.cantidad - OLD.cantidad;
        IF v_dif <> 0 THEN
            UPDATE producto SET stock = stock - v_dif
             WHERE id_prod = OLD.id_prod AND stock >= v_dif;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Stock insuficiente para aumentar la cantidad (producto %)', OLD.id_prod;
            END IF;
        END IF;
        NEW.precio_uni := OLD.precio_uni;
        NEW.sub_total  := OLD.precio_uni * NEW.cantidad;
    END IF;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_detallepedido_antes() OWNER TO postgres;

--
-- Name: f_detallepedido_total(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_detallepedido_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    UPDATE pedidos
       SET total = (SELECT COALESCE(SUM(sub_total), 0) FROM detallepedido WHERE id_ped = NEW.id_ped)
     WHERE id_ped = NEW.id_ped;
    RETURN NULL;
END $$;


ALTER FUNCTION public.f_detallepedido_total() OWNER TO postgres;

--
-- Name: f_detalleventa_antes(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_detalleventa_antes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_precio  NUMERIC(10,2);
    v_abierta BOOLEAN;
    v_ped     INT;
BEGIN
    SELECT estado, id_ped INTO v_abierta, v_ped FROM venta WHERE id_venta = NEW.id_venta
     FOR NO KEY UPDATE;
    IF v_abierta IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'La venta % no existe o está cancelada', NEW.id_venta;
    END IF;

    IF v_ped IS NOT NULL THEN                       -- venta que viene de un pedido
        NEW.sub_total := NEW.precio_uni * NEW.cantidad;
        RETURN NEW;
    END IF;

    SELECT precio INTO v_precio FROM presentprodvent
     WHERE id_prod = NEW.id_prod AND id_tipo_venta = NEW.id_tipo_venta;
    IF v_precio IS NULL THEN
        RAISE EXCEPTION 'El producto % no tiene precio para esa presentación', NEW.id_prod;
    END IF;

    UPDATE producto SET stock = stock - NEW.cantidad
     WHERE id_prod = NEW.id_prod AND estado = TRUE AND stock >= NEW.cantidad;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente o producto inactivo (producto %)', NEW.id_prod;
    END IF;

    NEW.precio_uni := v_precio;
    NEW.sub_total  := v_precio * NEW.cantidad;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_detalleventa_antes() OWNER TO postgres;

--
-- Name: f_detalleventa_total(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_detalleventa_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    UPDATE venta
       SET total = (SELECT COALESCE(SUM(sub_total), 0) FROM detalleventa WHERE id_venta = NEW.id_venta)
     WHERE id_venta = NEW.id_venta;
    RETURN NULL;
END $$;


ALTER FUNCTION public.f_detalleventa_total() OWNER TO postgres;

--
-- Name: f_favorito_reactivar(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_favorito_reactivar() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.activo = FALSE AND NEW.activo = TRUE THEN
        NEW.fecha_fav := NOW();
    END IF;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_favorito_reactivar() OWNER TO postgres;

--
-- Name: f_pedido_a_venta(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_pedido_a_venta() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_usuario INT := NULLIF(current_setting('app.id_usuario', true), '')::int;
    v_pago    TEXT := COALESCE(NULLIF(current_setting('app.metodo_pago', true), ''), 'efectivo');
    v_venta   INT;
BEGIN
    IF v_usuario IS NULL THEN
        SELECT u.id_usuario INTO v_usuario
          FROM usuario u JOIN rol r USING (id_rol)
         WHERE r.nom_rol = 'Administrador' AND u.estado ORDER BY u.id_usuario LIMIT 1;
    END IF;

    INSERT INTO venta (metodo_pago, id_usuario, id_client, id_ped)
    VALUES (v_pago, v_usuario, NEW.id_client, NEW.id_ped)
    RETURNING id_venta INTO v_venta;

    INSERT INTO detalleventa (cantidad, precio_uni, sub_total, id_prod, id_tipo_venta, id_venta)
    SELECT cantidad, precio_uni, sub_total, id_prod, id_tipo_venta, v_venta
      FROM detallepedido WHERE id_ped = NEW.id_ped ORDER BY id_prod;
    RETURN NULL;
END $$;


ALTER FUNCTION public.f_pedido_a_venta() OWNER TO postgres;

--
-- Name: f_pedido_antes_insert(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_pedido_antes_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_direc INT;
BEGIN
    NEW.total        := 0;
    NEW.estatus      := 'pendiente';
    NEW.danado       := FALSE;
    NEW.fecha_pedido := NOW();

    IF NEW.fecha_entrega < NEW.fecha_pedido THEN
        RAISE EXCEPTION 'La fecha de entrega no puede ser anterior a la fecha actual';
    END IF;

    IF NEW.tipo_entrega = 'domicilio' THEN
        SELECT id_direc INTO v_direc FROM cliente WHERE id_client = NEW.id_client;
        IF v_direc IS NULL THEN
            RAISE EXCEPTION 'El cliente no tiene dirección registrada para entrega a domicilio';
        END IF;
    END IF;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_pedido_antes_insert() OWNER TO postgres;

--
-- Name: f_pedido_estatus(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_pedido_estatus() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF OLD.estatus IN ('entregado', 'cancelado', 'no_entregado')
       AND (NEW.estatus IS DISTINCT FROM OLD.estatus
            OR NEW.danado IS DISTINCT FROM OLD.danado) THEN
        RAISE EXCEPTION 'El pedido % ya está "%" y no se puede modificar su estatus',
                        OLD.id_ped, OLD.estatus;
    END IF;

    IF NEW.estatus IN ('cancelado', 'no_entregado') AND NOT NEW.danado THEN
        UPDATE producto p
           SET stock = p.stock + d.cantidad
          FROM (SELECT id_prod, SUM(cantidad)::int AS cantidad
                  FROM detallepedido WHERE id_ped = NEW.id_ped GROUP BY id_prod) d
         WHERE p.id_prod = d.id_prod;
    END IF;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_pedido_estatus() OWNER TO postgres;

--
-- Name: f_usuario_validar(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_usuario_validar() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
    v_rol_admin INT;
    v_otros     INT;
BEGIN
    IF NEW.contrasena !~ '^(\$2[abxy]\$|\$argon2(id|i|d)\$|scrypt:|pbkdf2:)' THEN
        RAISE EXCEPTION 'La contraseña debe guardarse como hash, nunca en texto plano';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT id_rol INTO v_rol_admin FROM rol WHERE nom_rol = 'Administrador';
        IF OLD.id_rol = v_rol_admin AND OLD.estado
           AND (NEW.estado = FALSE OR NEW.id_rol <> v_rol_admin) THEN
            SELECT COUNT(*) INTO v_otros FROM usuario
             WHERE id_rol = v_rol_admin AND estado AND id_usuario <> OLD.id_usuario;
            IF v_otros = 0 THEN
                RAISE EXCEPTION 'No se puede desactivar ni cambiar de rol al único administrador activo';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END $_$;


ALTER FUNCTION public.f_usuario_validar() OWNER TO postgres;

--
-- Name: f_validar_rol_usuario(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_validar_rol_usuario() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_id  INT := (to_jsonb(NEW) ->> 'id_usuario')::int;
    v_rol TEXT;
BEGIN
    IF v_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT r.nom_rol INTO v_rol
      FROM usuario u JOIN rol r USING (id_rol)
     WHERE u.id_usuario = v_id;

    IF v_rol IS NULL OR NOT (v_rol = ANY (string_to_array(TG_ARGV[0], ','))) THEN
        RAISE EXCEPTION 'El usuario % tiene rol "%"; en % solo se permite: %',
                        v_id, COALESCE(v_rol, 'inexistente'), TG_TABLE_NAME, TG_ARGV[0];
    END IF;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_validar_rol_usuario() OWNER TO postgres;

--
-- Name: f_venta_antes_insert(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_venta_antes_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.total  := 0;
    NEW.estado := TRUE;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_venta_antes_insert() OWNER TO postgres;

--
-- Name: f_venta_cancelar(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.f_venta_cancelar() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF OLD.estado = FALSE AND NEW.estado = TRUE THEN
        RAISE EXCEPTION 'Una venta cancelada no se puede reactivar; registra una nueva';
    END IF;

    IF OLD.estado = TRUE AND NEW.estado = FALSE AND OLD.id_ped IS NULL THEN
        UPDATE producto p SET stock = p.stock + d.cant
          FROM (SELECT id_prod, SUM(cantidad)::int AS cant
                  FROM detalleventa WHERE id_venta = OLD.id_venta GROUP BY id_prod) d
         WHERE p.id_prod = d.id_prod;
    END IF;
    RETURN NEW;
END $$;


ALTER FUNCTION public.f_venta_cancelar() OWNER TO postgres;

--
-- Name: registrar_cliente(character varying, character varying, character varying, character varying, character varying, character varying, character varying, character varying, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.registrar_cliente(p_nom_usua character varying, p_hash character varying, p_nombre character varying, p_ap character varying, p_am character varying, p_telefono character varying, p_calle character varying DEFAULT NULL::character varying, p_numero character varying DEFAULT NULL::character varying, p_cruzamientos character varying DEFAULT NULL::character varying) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_rol INT; v_usuario INT; v_direc INT;
BEGIN
    SELECT id_rol INTO v_rol FROM rol WHERE nom_rol = 'Cliente';
    IF v_rol IS NULL THEN
        RAISE EXCEPTION 'No existe el rol Cliente en la tabla rol';
    END IF;

    IF p_calle IS NOT NULL THEN
        INSERT INTO direccion (calle, numero, cruzamientos)
        VALUES (p_calle, p_numero, p_cruzamientos) RETURNING id_direc INTO v_direc;
    END IF;

    INSERT INTO usuario (nombre, nom_usua, ap, am, telefono, contrasena, id_rol)
    VALUES (p_nombre, p_nom_usua, p_ap, p_am, p_telefono, p_hash, v_rol)
    RETURNING id_usuario INTO v_usuario;

    INSERT INTO cliente (nombre, ap, am, telefono, id_direc, id_usuario)
    VALUES (p_nombre, p_ap, p_am, p_telefono, v_direc, v_usuario);

    RETURN v_usuario;
END $$;


ALTER FUNCTION public.registrar_cliente(p_nom_usua character varying, p_hash character varying, p_nombre character varying, p_ap character varying, p_am character varying, p_telefono character varying, p_calle character varying, p_numero character varying, p_cruzamientos character varying) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bitacora; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bitacora (
    id_bit bigint NOT NULL,
    fecha timestamp without time zone DEFAULT now() NOT NULL,
    tabla character varying(50) NOT NULL,
    operacion character varying(10) NOT NULL,
    id_registro character varying(50),
    id_usuario integer,
    conexion character varying(50),
    rol_bd character varying(50),
    datos_antes jsonb,
    datos_despues jsonb
);


ALTER TABLE public.bitacora OWNER TO postgres;

--
-- Name: bitacora_id_bit_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.bitacora ALTER COLUMN id_bit ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.bitacora_id_bit_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cliente; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cliente (
    id_client integer NOT NULL,
    nombre character varying(100) NOT NULL,
    ap character varying(100),
    am character varying(100),
    telefono character varying(15),
    estado boolean DEFAULT true NOT NULL,
    id_direc integer,
    id_usuario integer
);


ALTER TABLE public.cliente OWNER TO postgres;

--
-- Name: cliente_id_client_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.cliente ALTER COLUMN id_client ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cliente_id_client_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: corte; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.corte (
    id_corte integer NOT NULL,
    fecha_corte timestamp without time zone DEFAULT now() NOT NULL,
    total_ventas numeric(10,2) DEFAULT 0 NOT NULL,
    total_gastos numeric(10,2) DEFAULT 0 NOT NULL,
    monto_inicial numeric(10,2) DEFAULT 0 NOT NULL,
    monto_final numeric(10,2) DEFAULT 0 NOT NULL,
    observaciones text,
    estado boolean DEFAULT true NOT NULL
);


ALTER TABLE public.corte OWNER TO postgres;

--
-- Name: corte_id_corte_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.corte ALTER COLUMN id_corte ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.corte_id_corte_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: detallegasto; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.detallegasto (
    id_det_gas integer NOT NULL,
    id_usuario integer NOT NULL,
    id_gas integer NOT NULL
);


ALTER TABLE public.detallegasto OWNER TO postgres;

--
-- Name: detallegasto_id_det_gas_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.detallegasto ALTER COLUMN id_det_gas ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.detallegasto_id_det_gas_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: detallepedido; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.detallepedido (
    id_det_ped integer NOT NULL,
    cantidad integer NOT NULL,
    precio_uni numeric(10,2) NOT NULL,
    sub_total numeric(10,2) NOT NULL,
    id_prod integer NOT NULL,
    id_tipo_venta integer NOT NULL,
    id_ped integer NOT NULL,
    CONSTRAINT detallepedido_cantidad_check CHECK ((cantidad > 0))
);


ALTER TABLE public.detallepedido OWNER TO postgres;

--
-- Name: detallepedido_id_det_ped_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.detallepedido ALTER COLUMN id_det_ped ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.detallepedido_id_det_ped_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: detalleventa; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.detalleventa (
    id_dv integer NOT NULL,
    cantidad integer NOT NULL,
    precio_uni numeric(10,2) NOT NULL,
    sub_total numeric(10,2) NOT NULL,
    id_prod integer NOT NULL,
    id_tipo_venta integer NOT NULL,
    id_venta integer NOT NULL,
    CONSTRAINT detalleventa_cantidad_check CHECK ((cantidad > 0))
);


ALTER TABLE public.detalleventa OWNER TO postgres;

--
-- Name: detalleventa_id_dv_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.detalleventa ALTER COLUMN id_dv ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.detalleventa_id_dv_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: direccion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.direccion (
    id_direc integer NOT NULL,
    calle character varying(100) NOT NULL,
    numero character varying(20),
    cruzamientos character varying(100),
    ima_ref character varying(255),
    com_ref text,
    link_ubi character varying(255)
);


ALTER TABLE public.direccion OWNER TO postgres;

--
-- Name: direccion_id_direc_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.direccion ALTER COLUMN id_direc ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.direccion_id_direc_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: favorito; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.favorito (
    id_client integer NOT NULL,
    id_prod integer NOT NULL,
    fecha_fav timestamp without time zone DEFAULT now() NOT NULL,
    activo boolean DEFAULT true NOT NULL
);


ALTER TABLE public.favorito OWNER TO postgres;

--
-- Name: gastos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.gastos (
    id_gas integer NOT NULL,
    concepto character varying(100) NOT NULL,
    descripcion text,
    monto numeric(10,2) NOT NULL,
    fecha_gas date DEFAULT CURRENT_DATE NOT NULL,
    tipo character varying(10) DEFAULT 'variable'::character varying NOT NULL,
    estado boolean DEFAULT true NOT NULL,
    CONSTRAINT gastos_monto_check CHECK ((monto >= (0)::numeric)),
    CONSTRAINT gastos_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['fijo'::character varying, 'variable'::character varying])::text[])))
);


ALTER TABLE public.gastos OWNER TO postgres;

--
-- Name: gastos_id_gas_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.gastos ALTER COLUMN id_gas ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.gastos_id_gas_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pedidos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pedidos (
    id_ped integer NOT NULL,
    fecha_pedido timestamp without time zone DEFAULT now() NOT NULL,
    fecha_entrega timestamp without time zone NOT NULL,
    total numeric(10,2) DEFAULT 0 NOT NULL,
    observaciones text,
    estatus character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
    tipo_entrega character varying(10) DEFAULT 'pickup'::character varying NOT NULL,
    danado boolean DEFAULT false NOT NULL,
    id_client integer NOT NULL,
    CONSTRAINT pedidos_estatus_check CHECK (((estatus)::text = ANY ((ARRAY['pendiente'::character varying, 'en_proceso'::character varying, 'entregado'::character varying, 'cancelado'::character varying, 'no_entregado'::character varying])::text[]))),
    CONSTRAINT pedidos_tipo_entrega_check CHECK (((tipo_entrega)::text = ANY ((ARRAY['pickup'::character varying, 'domicilio'::character varying])::text[])))
);


ALTER TABLE public.pedidos OWNER TO postgres;

--
-- Name: pedidos_id_ped_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.pedidos ALTER COLUMN id_ped ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pedidos_id_ped_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: presentprodvent; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.presentprodvent (
    id_tipo_prod_vent integer NOT NULL,
    precio numeric(10,2) NOT NULL,
    id_tipo_venta integer NOT NULL,
    id_prod integer NOT NULL,
    CONSTRAINT presentprodvent_precio_check CHECK ((precio >= (0)::numeric))
);


ALTER TABLE public.presentprodvent OWNER TO postgres;

--
-- Name: presentprodvent_id_tipo_prod_vent_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.presentprodvent ALTER COLUMN id_tipo_prod_vent ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.presentprodvent_id_tipo_prod_vent_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: producto; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.producto (
    id_prod integer NOT NULL,
    nom_prod character varying(100) NOT NULL,
    descripcion text,
    stock integer DEFAULT 0 NOT NULL,
    fecha_reg date DEFAULT CURRENT_DATE NOT NULL,
    estado boolean DEFAULT true NOT NULL,
    CONSTRAINT producto_stock_check CHECK ((stock >= 0))
);


ALTER TABLE public.producto OWNER TO postgres;

--
-- Name: producto_id_prod_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.producto ALTER COLUMN id_prod ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.producto_id_prod_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rol; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rol (
    id_rol integer NOT NULL,
    nom_rol character varying(50) NOT NULL
);


ALTER TABLE public.rol OWNER TO postgres;

--
-- Name: rol_id_rol_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.rol ALTER COLUMN id_rol ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.rol_id_rol_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tipoventa; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tipoventa (
    id_tipo_venta integer NOT NULL,
    nom_tipo_venta character varying(50) NOT NULL
);


ALTER TABLE public.tipoventa OWNER TO postgres;

--
-- Name: tipoventa_id_tipo_venta_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.tipoventa ALTER COLUMN id_tipo_venta ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tipoventa_id_tipo_venta_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: usuario; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usuario (
    id_usuario integer NOT NULL,
    nombre character varying(100) NOT NULL,
    nom_usua character varying(50) NOT NULL,
    ap character varying(100) NOT NULL,
    am character varying(100),
    telefono character varying(15),
    contrasena character varying(255) NOT NULL,
    estado boolean DEFAULT true NOT NULL,
    id_rol integer NOT NULL
);


ALTER TABLE public.usuario OWNER TO postgres;

--
-- Name: usuario_id_usuario_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.usuario ALTER COLUMN id_usuario ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usuario_id_usuario_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: venta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.venta (
    id_venta integer NOT NULL,
    fecha_vent timestamp without time zone DEFAULT now() NOT NULL,
    total numeric(10,2) DEFAULT 0 NOT NULL,
    estado boolean DEFAULT true NOT NULL,
    metodo_pago character varying(20) DEFAULT 'efectivo'::character varying NOT NULL,
    id_usuario integer NOT NULL,
    id_client integer,
    id_ped integer,
    CONSTRAINT venta_metodo_pago_check CHECK (((metodo_pago)::text = ANY ((ARRAY['efectivo'::character varying, 'transferencia'::character varying])::text[])))
);


ALTER TABLE public.venta OWNER TO postgres;

--
-- Name: venta_id_venta_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.venta ALTER COLUMN id_venta ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.venta_id_venta_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Data for Name: bitacora; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bitacora (id_bit, fecha, tabla, operacion, id_registro, id_usuario, conexion, rol_bd, datos_antes, datos_despues) FROM stdin;
1	2026-11-22 13:32:10.750458	pedidos	UPDATE	1	2	castek_vendedor	none	{"total": 79.00, "danado": false, "id_ped": 1, "estatus": "pendiente", "id_client": 1, "fecha_pedido": "2026-11-22T01:45:41.101093", "tipo_entrega": "pickup", "fecha_entrega": "2026-11-22T23:59:00", "observaciones": "Buen pastel"}	{"total": 79.00, "danado": false, "id_ped": 1, "estatus": "entregado", "id_client": 1, "fecha_pedido": "2026-11-22T01:45:41.101093", "tipo_entrega": "pickup", "fecha_entrega": "2026-11-22T23:59:00", "observaciones": "Buen pastel"}
2	2026-11-22 13:48:55.860356	producto	INSERT	5	3	castek_admin	none	\N	{"stock": 5, "estado": true, "id_prod": 5, "nom_prod": "Hojaldritas", "fecha_reg": "2026-11-22", "descripcion": "Deliciosos paquete de hojaldritas tradicionales elaboradas con harina de trigo y azúcar caramelizada."}
3	2026-11-22 13:48:55.860356	presentprodvent	INSERT	5	3	castek_admin	none	\N	{"precio": 120.00, "id_prod": 5, "id_tipo_venta": 3, "id_tipo_prod_vent": 5}
4	2026-11-22 13:49:35.765084	pedidos	UPDATE	2	3	castek_admin	none	{"total": 79.00, "danado": false, "id_ped": 2, "estatus": "pendiente", "id_client": 1, "fecha_pedido": "2026-11-22T13:31:23.171469", "tipo_entrega": "pickup", "fecha_entrega": "2026-11-22T23:59:00", "observaciones": null}	{"total": 79.00, "danado": false, "id_ped": 2, "estatus": "en_proceso", "id_client": 1, "fecha_pedido": "2026-11-22T13:31:23.171469", "tipo_entrega": "pickup", "fecha_entrega": "2026-11-22T23:59:00", "observaciones": null}
5	2026-11-22 18:21:57.522525	pedidos	UPDATE	3	2	castek_vendedor	none	{"total": 120.00, "danado": false, "id_ped": 3, "estatus": "pendiente", "id_client": 1, "fecha_pedido": "2026-11-22T18:19:54.741004", "tipo_entrega": "pickup", "fecha_entrega": "2026-11-22T23:59:00", "observaciones": null}	{"total": 120.00, "danado": false, "id_ped": 3, "estatus": "entregado", "id_client": 1, "fecha_pedido": "2026-11-22T18:19:54.741004", "tipo_entrega": "pickup", "fecha_entrega": "2026-11-22T23:59:00", "observaciones": null}
6	2026-11-22 22:50:20.901128	usuario	INSERT	4	\N	castek_auth	none	\N	{"am": "Ek", "ap": "Castillo", "estado": true, "id_rol": 3, "nombre": "Lissie", "nom_usua": "Lissie", "telefono": "9842131942", "id_usuario": 4}
7	2026-11-22 23:05:52.42063	pedidos	UPDATE	4	3	castek_admin	none	{"total": 199.00, "danado": false, "id_ped": 4, "estatus": "pendiente", "id_client": 2, "fecha_pedido": "2026-11-22T22:52:13.411891", "tipo_entrega": "domicilio", "fecha_entrega": "2026-11-23T23:59:00", "observaciones": "Que la rebanada sea grande"}	{"total": 199.00, "danado": false, "id_ped": 4, "estatus": "cancelado", "id_client": 2, "fecha_pedido": "2026-11-22T22:52:13.411891", "tipo_entrega": "domicilio", "fecha_entrega": "2026-11-23T23:59:00", "observaciones": "Que la rebanada sea grande"}
8	2026-11-22 23:07:04.618444	venta	UPDATE	3	3	castek_admin	none	{"total": 120.00, "estado": true, "id_ped": 3, "id_venta": 3, "id_client": 1, "fecha_vent": "2026-11-22T18:21:57.522525", "id_usuario": 2, "metodo_pago": "efectivo"}	{"total": 120.00, "estado": false, "id_ped": 3, "id_venta": 3, "id_client": 1, "fecha_vent": "2026-11-22T18:21:57.522525", "id_usuario": 2, "metodo_pago": "efectivo"}
9	2026-11-22 23:12:56.577306	gastos	INSERT	1	3	castek_admin	none	\N	{"tipo": "variable", "monto": 200.00, "estado": true, "id_gas": 1, "concepto": "DROP DATA BASE;", "fecha_gas": "2026-11-22", "descripcion": "INSERT \\"HOLA\\""}
10	2026-11-22 23:13:10.102018	producto	UPDATE	1	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 1, "nom_prod": "Cruffin Toffee", "fecha_reg": "2026-11-21", "descripcion": "Cruffin con toffee"}	{"stock": 0, "estado": false, "id_prod": 1, "nom_prod": "Cruffin Toffee", "fecha_reg": "2026-11-21", "descripcion": "Cruffin con toffee"}
11	2026-11-22 23:13:11.020936	producto	UPDATE	1	3	castek_admin	none	{"stock": 0, "estado": false, "id_prod": 1, "nom_prod": "Cruffin Toffee", "fecha_reg": "2026-11-21", "descripcion": "Cruffin con toffee"}	{"stock": 0, "estado": true, "id_prod": 1, "nom_prod": "Cruffin Toffee", "fecha_reg": "2026-11-21", "descripcion": "Cruffin con toffee"}
12	2026-11-22 23:13:20.750047	producto	UPDATE	1	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 1, "nom_prod": "Cruffin Toffee", "fecha_reg": "2026-11-21", "descripcion": "Cruffin con toffee"}	{"stock": 5, "estado": true, "id_prod": 1, "nom_prod": "Cruffin Toffee", "fecha_reg": "2026-11-21", "descripcion": "Cruffin con toffee"}
13	2026-11-22 23:13:20.750047	producto	UPDATE	1	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 1, "nom_prod": "Cruffin Toffee", "fecha_reg": "2026-11-21", "descripcion": "Cruffin con toffee"}	{"stock": 5, "estado": true, "id_prod": 1, "nom_prod": "Cruffin Toffee", "fecha_reg": "2026-11-21", "descripcion": "Cruffin con toffee"}
14	2026-11-22 23:13:20.750047	presentprodvent	UPDATE	1	3	castek_admin	none	{"precio": 79.00, "id_prod": 1, "id_tipo_venta": 1, "id_tipo_prod_vent": 1}	{"precio": 79.00, "id_prod": 1, "id_tipo_venta": 1, "id_tipo_prod_vent": 1}
15	2026-11-22 23:13:26.075244	producto	UPDATE	2	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 2, "nom_prod": "New York Cheesecake (RB)", "fecha_reg": "2026-11-21", "descripcion": "Rebanada de cheesecake"}	{"stock": 6, "estado": true, "id_prod": 2, "nom_prod": "New York Cheesecake (RB)", "fecha_reg": "2026-11-21", "descripcion": "Rebanada de cheesecake"}
16	2026-11-22 23:13:26.075244	producto	UPDATE	2	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 2, "nom_prod": "New York Cheesecake (RB)", "fecha_reg": "2026-11-21", "descripcion": "Rebanada de cheesecake"}	{"stock": 6, "estado": true, "id_prod": 2, "nom_prod": "New York Cheesecake (RB)", "fecha_reg": "2026-11-21", "descripcion": "Rebanada de cheesecake"}
17	2026-11-22 23:13:26.075244	presentprodvent	UPDATE	2	3	castek_admin	none	{"precio": 79.00, "id_prod": 2, "id_tipo_venta": 2, "id_tipo_prod_vent": 2}	{"precio": 79.00, "id_prod": 2, "id_tipo_venta": 2, "id_tipo_prod_vent": 2}
18	2026-11-22 23:13:31.910846	producto	UPDATE	3	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 3, "nom_prod": "Pastel de mil hojas (EN)", "fecha_reg": "2026-11-21", "descripcion": "Pastel entero de mil hojas"}	{"stock": 6, "estado": true, "id_prod": 3, "nom_prod": "Pastel de mil hojas (EN)", "fecha_reg": "2026-11-21", "descripcion": "Pastel entero de mil hojas"}
19	2026-11-22 23:13:31.910846	producto	UPDATE	3	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 3, "nom_prod": "Pastel de mil hojas (EN)", "fecha_reg": "2026-11-21", "descripcion": "Pastel entero de mil hojas"}	{"stock": 6, "estado": true, "id_prod": 3, "nom_prod": "Pastel de mil hojas (EN)", "fecha_reg": "2026-11-21", "descripcion": "Pastel entero de mil hojas"}
20	2026-11-22 23:13:31.910846	presentprodvent	UPDATE	3	3	castek_admin	none	{"precio": 699.00, "id_prod": 3, "id_tipo_venta": 1, "id_tipo_prod_vent": 3}	{"precio": 699.00, "id_prod": 3, "id_tipo_venta": 1, "id_tipo_prod_vent": 3}
21	2026-11-22 23:14:05.578333	producto	UPDATE	4	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 4, "nom_prod": "Pastel Tiramisú (EN)", "fecha_reg": "2026-11-21", "descripcion": "Pastel entero de tiramisú"}	{"stock": 5, "estado": true, "id_prod": 4, "nom_prod": "Pastel Tiramisú (EN)", "fecha_reg": "2026-11-21", "descripcion": "Pastel entero de tiramisú"}
22	2026-11-22 23:14:05.578333	producto	UPDATE	4	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 4, "nom_prod": "Pastel Tiramisú (EN)", "fecha_reg": "2026-11-21", "descripcion": "Pastel entero de tiramisú"}	{"stock": 5, "estado": true, "id_prod": 4, "nom_prod": "Pastel Tiramisú (EN)", "fecha_reg": "2026-11-21", "descripcion": "Pastel entero de tiramisú"}
23	2026-11-22 23:14:05.578333	presentprodvent	UPDATE	4	3	castek_admin	none	{"precio": 699.00, "id_prod": 4, "id_tipo_venta": 1, "id_tipo_prod_vent": 4}	{"precio": 699.00, "id_prod": 4, "id_tipo_venta": 1, "id_tipo_prod_vent": 4}
24	2026-11-22 23:14:10.411951	producto	UPDATE	5	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 5, "nom_prod": "Hojaldritas", "fecha_reg": "2026-11-22", "descripcion": "Deliciosos paquete de hojaldritas tradicionales elaboradas con harina de trigo y azúcar caramelizada."}	{"stock": 5, "estado": true, "id_prod": 5, "nom_prod": "Hojaldritas", "fecha_reg": "2026-11-22", "descripcion": "Deliciosos paquete de hojaldritas tradicionales elaboradas con harina de trigo y azúcar caramelizada."}
25	2026-11-22 23:14:10.411951	producto	UPDATE	5	3	castek_admin	none	{"stock": 0, "estado": true, "id_prod": 5, "nom_prod": "Hojaldritas", "fecha_reg": "2026-11-22", "descripcion": "Deliciosos paquete de hojaldritas tradicionales elaboradas con harina de trigo y azúcar caramelizada."}	{"stock": 5, "estado": true, "id_prod": 5, "nom_prod": "Hojaldritas", "fecha_reg": "2026-11-22", "descripcion": "Deliciosos paquete de hojaldritas tradicionales elaboradas con harina de trigo y azúcar caramelizada."}
26	2026-11-22 23:14:10.411951	presentprodvent	UPDATE	5	3	castek_admin	none	{"precio": 120.00, "id_prod": 5, "id_tipo_venta": 3, "id_tipo_prod_vent": 5}	{"precio": 120.00, "id_prod": 5, "id_tipo_venta": 3, "id_tipo_prod_vent": 5}
27	2026-11-22 23:14:23.008488	corte	INSERT	1	3	castek_admin	none	\N	{"estado": true, "id_corte": 1, "fecha_corte": "2026-11-22T23:14:23.008488", "monto_final": 257.00, "total_gastos": 200.00, "total_ventas": 357.00, "monto_inicial": 100.00, "observaciones": "Drop data base"}
\.


--
-- Data for Name: cliente; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cliente (id_client, nombre, ap, am, telefono, estado, id_direc, id_usuario) FROM stdin;
1	Edelmy	Chay	\N	9991866644	t	1	1
2	Lissie	Castillo	Ek	9842131942	t	2	4
\.


--
-- Data for Name: corte; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.corte (id_corte, fecha_corte, total_ventas, total_gastos, monto_inicial, monto_final, observaciones, estado) FROM stdin;
1	2026-11-22 23:14:23.008488	357.00	200.00	100.00	257.00	Drop data base	t
\.


--
-- Data for Name: detallegasto; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.detallegasto (id_det_gas, id_usuario, id_gas) FROM stdin;
1	3	1
\.


--
-- Data for Name: detallepedido; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.detallepedido (id_det_ped, cantidad, precio_uni, sub_total, id_prod, id_tipo_venta, id_ped) FROM stdin;
1	1	79.00	79.00	2	2	1
2	1	79.00	79.00	2	2	2
3	1	120.00	120.00	5	3	3
4	1	79.00	79.00	2	2	4
5	1	120.00	120.00	5	3	4
6	9	79.00	711.00	1	1	5
7	7	79.00	553.00	2	2	5
8	10	699.00	6990.00	3	1	5
9	10	699.00	6990.00	4	1	5
10	3	120.00	360.00	5	3	5
\.


--
-- Data for Name: detalleventa; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.detalleventa (id_dv, cantidad, precio_uni, sub_total, id_prod, id_tipo_venta, id_venta) FROM stdin;
1	1	79.00	79.00	1	1	1
2	1	79.00	79.00	2	2	2
3	1	120.00	120.00	5	3	3
4	1	79.00	79.00	2	2	4
5	1	120.00	120.00	5	3	4
\.


--
-- Data for Name: direccion; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.direccion (id_direc, calle, numero, cruzamientos, ima_ref, com_ref, link_ubi) FROM stdin;
1	39	569	110 y 112	\N	Casa de dos pisos	
2	06	Sn	21 x 23	\N	\N	\N
\.


--
-- Data for Name: favorito; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.favorito (id_client, id_prod, fecha_fav, activo) FROM stdin;
1	1	2026-11-22 00:53:23.479188	t
1	2	2026-11-22 13:30:52.504784	f
1	5	2026-11-22 18:20:09.069881	t
2	1	2026-11-22 22:51:23.52308	f
\.


--
-- Data for Name: gastos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.gastos (id_gas, concepto, descripcion, monto, fecha_gas, tipo, estado) FROM stdin;
1	DROP DATA BASE;	INSERT "HOLA"	200.00	2026-11-22	variable	t
\.


--
-- Data for Name: pedidos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pedidos (id_ped, fecha_pedido, fecha_entrega, total, observaciones, estatus, tipo_entrega, danado, id_client) FROM stdin;
1	2026-11-22 01:45:41.101093	2026-11-22 23:59:00	79.00	Buen pastel	entregado	pickup	f	1
2	2026-11-22 13:31:23.171469	2026-11-22 23:59:00	79.00	\N	en_proceso	pickup	f	1
3	2026-11-22 18:19:54.741004	2026-11-22 23:59:00	120.00	\N	entregado	pickup	f	1
5	2026-11-22 22:59:29.222994	2026-11-22 23:59:00	15604.00	\N	pendiente	pickup	f	2
4	2026-11-22 22:52:13.411891	2026-11-23 23:59:00	199.00	Que la rebanada sea grande	cancelado	domicilio	f	2
\.


--
-- Data for Name: presentprodvent; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.presentprodvent (id_tipo_prod_vent, precio, id_tipo_venta, id_prod) FROM stdin;
1	79.00	1	1
2	79.00	2	2
3	699.00	1	3
4	699.00	1	4
5	120.00	3	5
\.


--
-- Data for Name: producto; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.producto (id_prod, nom_prod, descripcion, stock, fecha_reg, estado) FROM stdin;
1	Cruffin Toffee	Cruffin con toffee	5	2026-11-21	t
2	New York Cheesecake (RB)	Rebanada de cheesecake	6	2026-11-21	t
3	Pastel de mil hojas (EN)	Pastel entero de mil hojas	6	2026-11-21	t
4	Pastel Tiramisú (EN)	Pastel entero de tiramisú	5	2026-11-21	t
5	Hojaldritas	Deliciosos paquete de hojaldritas tradicionales elaboradas con harina de trigo y azúcar caramelizada.	5	2026-11-22	t
\.


--
-- Data for Name: rol; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rol (id_rol, nom_rol) FROM stdin;
1	Administrador
2	Vendedor
3	Cliente
\.


--
-- Data for Name: tipoventa; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tipoventa (id_tipo_venta, nom_tipo_venta) FROM stdin;
1	Pieza
2	Rebanada
3	Caja
\.


--
-- Data for Name: usuario; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.usuario (id_usuario, nombre, nom_usua, ap, am, telefono, contrasena, estado, id_rol) FROM stdin;
1	Edelmy	EdelmyClient	Chay	\N	\N	scrypt:32768:8:1$J7DlTdE5MrK4Nv4f$fca0862611eb18f79a3e700657427c0ada00f2c6e3e85117b124840e79efdcadb3fd14551bc1ffc339cb522d9993622edfddb547dd383400b922651d72c34be0	t	3
2	EdelmyA	EdelmyVendedor	Chay	\N	\N	scrypt:32768:8:1$UK5KCYAqemot33zT$f3603298adaa3e9a38fb79fe86d5fe0b1008436ffb4a7e6dd04caf66b97faaeb8793f60589f35bd1e8309edcd0254a434b7bb552d0bd97d039fbf511d67c698e	t	2
3	EdelmyD	EdelmyAdmin	Chay	\N	\N	scrypt:32768:8:1$07IKjqHGCnKVGvln$2603aee9b7205a1b9b90af054024732cd27d4cd2abd4198baf00fa58fbb7ce5887ec278bab8f3157aad8e5d29dc84bd1289165304c415264551cb25142911ab8	t	1
4	Lissie	Lissie	Castillo	Ek	9842131942	scrypt:32768:8:1$oUxvBqIEPxcq1w8v$ca07f33c941a38d0e624c7ec22b617f423ba2f9f0f206cf885a8ed9266e10374f4471eb07c2bdd373bbc3bb73c90304b41ae5d9802a9024fd3a1aebb6f6dc799	t	3
\.


--
-- Data for Name: venta; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.venta (id_venta, fecha_vent, total, estado, metodo_pago, id_usuario, id_client, id_ped) FROM stdin;
1	2026-11-22 13:45:54.216806	79.00	t	efectivo	2	\N	\N
2	2026-11-22 23:59:00	79.00	t	efectivo	3	1	1
3	2026-11-22 18:21:57.522525	120.00	f	efectivo	2	1	3
4	2026-11-22 23:09:03.919994	199.00	t	efectivo	3	\N	\N
\.


--
-- Name: bitacora_id_bit_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bitacora_id_bit_seq', 27, true);


--
-- Name: cliente_id_client_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cliente_id_client_seq', 2, true);


--
-- Name: corte_id_corte_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.corte_id_corte_seq', 1, true);


--
-- Name: detallegasto_id_det_gas_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.detallegasto_id_det_gas_seq', 1, true);


--
-- Name: detallepedido_id_det_ped_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.detallepedido_id_det_ped_seq', 10, true);


--
-- Name: detalleventa_id_dv_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.detalleventa_id_dv_seq', 5, true);


--
-- Name: direccion_id_direc_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.direccion_id_direc_seq', 2, true);


--
-- Name: gastos_id_gas_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.gastos_id_gas_seq', 1, true);


--
-- Name: pedidos_id_ped_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pedidos_id_ped_seq', 5, true);


--
-- Name: presentprodvent_id_tipo_prod_vent_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.presentprodvent_id_tipo_prod_vent_seq', 5, true);


--
-- Name: producto_id_prod_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.producto_id_prod_seq', 5, true);


--
-- Name: rol_id_rol_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rol_id_rol_seq', 3, true);


--
-- Name: tipoventa_id_tipo_venta_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tipoventa_id_tipo_venta_seq', 3, true);


--
-- Name: usuario_id_usuario_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.usuario_id_usuario_seq', 4, true);


--
-- Name: venta_id_venta_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.venta_id_venta_seq', 4, true);


--
-- Name: bitacora bitacora_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bitacora
    ADD CONSTRAINT bitacora_pkey PRIMARY KEY (id_bit);


--
-- Name: cliente cliente_id_usuario_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT cliente_id_usuario_key UNIQUE (id_usuario);


--
-- Name: cliente cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT cliente_pkey PRIMARY KEY (id_client);


--
-- Name: corte corte_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.corte
    ADD CONSTRAINT corte_pkey PRIMARY KEY (id_corte);


--
-- Name: detallegasto detallegasto_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detallegasto
    ADD CONSTRAINT detallegasto_pkey PRIMARY KEY (id_det_gas);


--
-- Name: detallepedido detallepedido_id_ped_id_prod_id_tipo_venta_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detallepedido
    ADD CONSTRAINT detallepedido_id_ped_id_prod_id_tipo_venta_key UNIQUE (id_ped, id_prod, id_tipo_venta);


--
-- Name: detallepedido detallepedido_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detallepedido
    ADD CONSTRAINT detallepedido_pkey PRIMARY KEY (id_det_ped);


--
-- Name: detalleventa detalleventa_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalleventa
    ADD CONSTRAINT detalleventa_pkey PRIMARY KEY (id_dv);


--
-- Name: direccion direccion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.direccion
    ADD CONSTRAINT direccion_pkey PRIMARY KEY (id_direc);


--
-- Name: favorito favorito_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorito
    ADD CONSTRAINT favorito_pkey PRIMARY KEY (id_client, id_prod);


--
-- Name: gastos gastos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.gastos
    ADD CONSTRAINT gastos_pkey PRIMARY KEY (id_gas);


--
-- Name: pedidos pedidos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_pkey PRIMARY KEY (id_ped);


--
-- Name: presentprodvent presentprodvent_id_prod_id_tipo_venta_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.presentprodvent
    ADD CONSTRAINT presentprodvent_id_prod_id_tipo_venta_key UNIQUE (id_prod, id_tipo_venta);


--
-- Name: presentprodvent presentprodvent_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.presentprodvent
    ADD CONSTRAINT presentprodvent_pkey PRIMARY KEY (id_tipo_prod_vent);


--
-- Name: producto producto_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.producto
    ADD CONSTRAINT producto_pkey PRIMARY KEY (id_prod);


--
-- Name: rol rol_nom_rol_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT rol_nom_rol_key UNIQUE (nom_rol);


--
-- Name: rol rol_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT rol_pkey PRIMARY KEY (id_rol);


--
-- Name: tipoventa tipoventa_nom_tipo_venta_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tipoventa
    ADD CONSTRAINT tipoventa_nom_tipo_venta_key UNIQUE (nom_tipo_venta);


--
-- Name: tipoventa tipoventa_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tipoventa
    ADD CONSTRAINT tipoventa_pkey PRIMARY KEY (id_tipo_venta);


--
-- Name: usuario usuario_nom_usua_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_nom_usua_key UNIQUE (nom_usua);


--
-- Name: usuario usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_pkey PRIMARY KEY (id_usuario);


--
-- Name: venta venta_id_ped_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venta
    ADD CONSTRAINT venta_id_ped_key UNIQUE (id_ped);


--
-- Name: venta venta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venta
    ADD CONSTRAINT venta_pkey PRIMARY KEY (id_venta);


--
-- Name: ix_detallepedido_ped; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_detallepedido_ped ON public.detallepedido USING btree (id_ped);


--
-- Name: ix_detalleventa_venta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_detalleventa_venta ON public.detalleventa USING btree (id_venta);


--
-- Name: ix_gastos_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_gastos_fecha ON public.gastos USING btree (fecha_gas) WHERE estado;


--
-- Name: ix_pedidos_cliente; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_pedidos_cliente ON public.pedidos USING btree (id_client);


--
-- Name: ix_pedidos_estatus; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_pedidos_estatus ON public.pedidos USING btree (estatus, fecha_entrega);


--
-- Name: ix_venta_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_venta_fecha ON public.venta USING btree (fecha_vent) WHERE estado;


--
-- Name: ux_corte_dia_activo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_corte_dia_activo ON public.corte USING btree (((fecha_corte)::date)) WHERE estado;


--
-- Name: bitacora t_bitacora_inmutable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_bitacora_inmutable BEFORE DELETE OR UPDATE ON public.bitacora FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('La bitácora es de solo lectura');


--
-- Name: cliente t_cliente_no_borrar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_cliente_no_borrar BEFORE DELETE ON public.cliente FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('Los clientes no se borran: desactívalos cambiando su estado');


--
-- Name: cliente t_cliente_rol; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_cliente_rol BEFORE INSERT OR UPDATE OF id_usuario ON public.cliente FOR EACH ROW EXECUTE FUNCTION public.f_validar_rol_usuario('Cliente');


--
-- Name: corte t_corte_bitacora; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_corte_bitacora AFTER INSERT OR UPDATE ON public.corte FOR EACH ROW EXECUTE FUNCTION public.f_bitacora('id_corte');


--
-- Name: corte t_corte_calcular; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_corte_calcular BEFORE INSERT ON public.corte FOR EACH ROW EXECUTE FUNCTION public.f_corte_calcular();


--
-- Name: corte t_corte_inmutable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_corte_inmutable BEFORE UPDATE ON public.corte FOR EACH ROW EXECUTE FUNCTION public.f_corte_inmutable();


--
-- Name: corte t_corte_no_borrar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_corte_no_borrar BEFORE DELETE ON public.corte FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('Los cortes no se borran: anúlalos cambiando su estado');


--
-- Name: detallepedido t_detallepedido_antes; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_detallepedido_antes BEFORE INSERT OR UPDATE ON public.detallepedido FOR EACH ROW EXECUTE FUNCTION public.f_detallepedido_antes();


--
-- Name: detallepedido t_detallepedido_no_borrar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_detallepedido_no_borrar BEFORE DELETE ON public.detallepedido FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('El detalle de un pedido no se borra: cancela el pedido y registra otro');


--
-- Name: detallepedido t_detallepedido_total; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_detallepedido_total AFTER INSERT OR UPDATE ON public.detallepedido FOR EACH ROW EXECUTE FUNCTION public.f_detallepedido_total();


--
-- Name: detalleventa t_detalleventa_antes; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_detalleventa_antes BEFORE INSERT ON public.detalleventa FOR EACH ROW EXECUTE FUNCTION public.f_detalleventa_antes();


--
-- Name: detalleventa t_detalleventa_inmutable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_detalleventa_inmutable BEFORE DELETE OR UPDATE ON public.detalleventa FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('El detalle de una venta no se modifica ni se borra: cancela la venta y registra otra');


--
-- Name: detalleventa t_detalleventa_total; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_detalleventa_total AFTER INSERT ON public.detalleventa FOR EACH ROW EXECUTE FUNCTION public.f_detalleventa_total();


--
-- Name: detallegasto t_detgasto_rol; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_detgasto_rol BEFORE INSERT ON public.detallegasto FOR EACH ROW EXECUTE FUNCTION public.f_validar_rol_usuario('Administrador');


--
-- Name: favorito t_favorito_fecha; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_favorito_fecha BEFORE UPDATE OF activo ON public.favorito FOR EACH ROW EXECUTE FUNCTION public.f_favorito_reactivar();


--
-- Name: gastos t_gastos_bitacora; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_gastos_bitacora AFTER INSERT OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.f_bitacora('id_gas');


--
-- Name: gastos t_gastos_no_borrar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_gastos_no_borrar BEFORE DELETE ON public.gastos FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('Los gastos no se borran: desactívalos cambiando su estado');


--
-- Name: pedidos t_pedido_a_venta; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_pedido_a_venta AFTER UPDATE OF estatus ON public.pedidos FOR EACH ROW WHEN ((((new.estatus)::text = 'entregado'::text) AND ((old.estatus)::text IS DISTINCT FROM 'entregado'::text))) EXECUTE FUNCTION public.f_pedido_a_venta();


--
-- Name: pedidos t_pedido_antes_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_pedido_antes_insert BEFORE INSERT ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.f_pedido_antes_insert();


--
-- Name: pedidos t_pedido_bitacora; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_pedido_bitacora AFTER UPDATE OF estatus, danado ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.f_bitacora('id_ped');


--
-- Name: pedidos t_pedido_estatus; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_pedido_estatus BEFORE UPDATE OF estatus, danado ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.f_pedido_estatus();


--
-- Name: pedidos t_pedido_no_borrar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_pedido_no_borrar BEFORE DELETE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('Los pedidos no se borran: cancélalos cambiando su estatus');


--
-- Name: presentprodvent t_presentacion_bitacora; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_presentacion_bitacora AFTER INSERT OR UPDATE ON public.presentprodvent FOR EACH ROW EXECUTE FUNCTION public.f_bitacora('id_tipo_prod_vent');


--
-- Name: producto t_producto_bitacora; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_producto_bitacora AFTER INSERT OR UPDATE OF nom_prod, descripcion, estado ON public.producto FOR EACH ROW EXECUTE FUNCTION public.f_bitacora('id_prod');


--
-- Name: producto t_producto_stock_manual; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_producto_stock_manual AFTER UPDATE OF stock ON public.producto FOR EACH ROW WHEN (((pg_trigger_depth() = 0) AND (old.stock IS DISTINCT FROM new.stock))) EXECUTE FUNCTION public.f_bitacora('id_prod');


--
-- Name: usuario t_usuario_bitacora; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_usuario_bitacora AFTER INSERT OR UPDATE ON public.usuario FOR EACH ROW EXECUTE FUNCTION public.f_bitacora('id_usuario');


--
-- Name: usuario t_usuario_no_borrar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_usuario_no_borrar BEFORE DELETE ON public.usuario FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('Los usuarios no se borran: desactívalos cambiando su estado');


--
-- Name: usuario t_usuario_validar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_usuario_validar BEFORE INSERT OR UPDATE ON public.usuario FOR EACH ROW EXECUTE FUNCTION public.f_usuario_validar();


--
-- Name: venta t_venta_antes_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_venta_antes_insert BEFORE INSERT ON public.venta FOR EACH ROW EXECUTE FUNCTION public.f_venta_antes_insert();


--
-- Name: venta t_venta_bitacora; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_venta_bitacora AFTER UPDATE OF estado ON public.venta FOR EACH ROW EXECUTE FUNCTION public.f_bitacora('id_venta');


--
-- Name: venta t_venta_cancelar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_venta_cancelar BEFORE UPDATE OF estado ON public.venta FOR EACH ROW EXECUTE FUNCTION public.f_venta_cancelar();


--
-- Name: venta t_venta_no_borrar; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_venta_no_borrar BEFORE DELETE ON public.venta FOR EACH ROW EXECUTE FUNCTION public.f_bloquear('Las ventas no se borran: cancélalas cambiando su estado');


--
-- Name: venta t_venta_rol; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER t_venta_rol BEFORE INSERT ON public.venta FOR EACH ROW EXECUTE FUNCTION public.f_validar_rol_usuario('Administrador,Vendedor');


--
-- Name: cliente cliente_id_direc_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT cliente_id_direc_fkey FOREIGN KEY (id_direc) REFERENCES public.direccion(id_direc);


--
-- Name: cliente cliente_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cliente
    ADD CONSTRAINT cliente_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id_usuario);


--
-- Name: detallegasto detallegasto_id_gas_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detallegasto
    ADD CONSTRAINT detallegasto_id_gas_fkey FOREIGN KEY (id_gas) REFERENCES public.gastos(id_gas) ON DELETE CASCADE;


--
-- Name: detallegasto detallegasto_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detallegasto
    ADD CONSTRAINT detallegasto_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id_usuario);


--
-- Name: detallepedido detallepedido_id_ped_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detallepedido
    ADD CONSTRAINT detallepedido_id_ped_fkey FOREIGN KEY (id_ped) REFERENCES public.pedidos(id_ped);


--
-- Name: detallepedido detallepedido_id_prod_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detallepedido
    ADD CONSTRAINT detallepedido_id_prod_fkey FOREIGN KEY (id_prod) REFERENCES public.producto(id_prod);


--
-- Name: detallepedido detallepedido_id_tipo_venta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detallepedido
    ADD CONSTRAINT detallepedido_id_tipo_venta_fkey FOREIGN KEY (id_tipo_venta) REFERENCES public.tipoventa(id_tipo_venta);


--
-- Name: detalleventa detalleventa_id_prod_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalleventa
    ADD CONSTRAINT detalleventa_id_prod_fkey FOREIGN KEY (id_prod) REFERENCES public.producto(id_prod);


--
-- Name: detalleventa detalleventa_id_tipo_venta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalleventa
    ADD CONSTRAINT detalleventa_id_tipo_venta_fkey FOREIGN KEY (id_tipo_venta) REFERENCES public.tipoventa(id_tipo_venta);


--
-- Name: detalleventa detalleventa_id_venta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.detalleventa
    ADD CONSTRAINT detalleventa_id_venta_fkey FOREIGN KEY (id_venta) REFERENCES public.venta(id_venta) ON DELETE CASCADE;


--
-- Name: favorito favorito_id_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorito
    ADD CONSTRAINT favorito_id_client_fkey FOREIGN KEY (id_client) REFERENCES public.cliente(id_client);


--
-- Name: favorito favorito_id_prod_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorito
    ADD CONSTRAINT favorito_id_prod_fkey FOREIGN KEY (id_prod) REFERENCES public.producto(id_prod);


--
-- Name: pedidos pedidos_id_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_id_client_fkey FOREIGN KEY (id_client) REFERENCES public.cliente(id_client);


--
-- Name: presentprodvent presentprodvent_id_prod_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.presentprodvent
    ADD CONSTRAINT presentprodvent_id_prod_fkey FOREIGN KEY (id_prod) REFERENCES public.producto(id_prod);


--
-- Name: presentprodvent presentprodvent_id_tipo_venta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.presentprodvent
    ADD CONSTRAINT presentprodvent_id_tipo_venta_fkey FOREIGN KEY (id_tipo_venta) REFERENCES public.tipoventa(id_tipo_venta);


--
-- Name: usuario usuario_id_rol_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_id_rol_fkey FOREIGN KEY (id_rol) REFERENCES public.rol(id_rol);


--
-- Name: venta venta_id_client_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venta
    ADD CONSTRAINT venta_id_client_fkey FOREIGN KEY (id_client) REFERENCES public.cliente(id_client);


--
-- Name: venta venta_id_ped_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venta
    ADD CONSTRAINT venta_id_ped_fkey FOREIGN KEY (id_ped) REFERENCES public.pedidos(id_ped);


--
-- Name: venta venta_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venta
    ADD CONSTRAINT venta_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuario(id_usuario);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO castek_auth;
GRANT USAGE ON SCHEMA public TO castek_cliente;
GRANT USAGE ON SCHEMA public TO castek_vendedor;
GRANT USAGE ON SCHEMA public TO castek_admin;


--
-- Name: FUNCTION cambiar_mi_acceso(p_id_usuario integer, p_nuevo_nom_usua character varying, p_nuevo_hash character varying); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.cambiar_mi_acceso(p_id_usuario integer, p_nuevo_nom_usua character varying, p_nuevo_hash character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cambiar_mi_acceso(p_id_usuario integer, p_nuevo_nom_usua character varying, p_nuevo_hash character varying) TO castek_cliente;


--
-- Name: FUNCTION f_bitacora(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_bitacora() FROM PUBLIC;


--
-- Name: FUNCTION f_bloquear(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_bloquear() FROM PUBLIC;


--
-- Name: FUNCTION f_corte_calcular(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_corte_calcular() FROM PUBLIC;


--
-- Name: FUNCTION f_corte_inmutable(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_corte_inmutable() FROM PUBLIC;


--
-- Name: FUNCTION f_detallepedido_antes(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_detallepedido_antes() FROM PUBLIC;


--
-- Name: FUNCTION f_detallepedido_total(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_detallepedido_total() FROM PUBLIC;


--
-- Name: FUNCTION f_detalleventa_antes(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_detalleventa_antes() FROM PUBLIC;


--
-- Name: FUNCTION f_detalleventa_total(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_detalleventa_total() FROM PUBLIC;


--
-- Name: FUNCTION f_favorito_reactivar(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_favorito_reactivar() FROM PUBLIC;


--
-- Name: FUNCTION f_pedido_a_venta(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_pedido_a_venta() FROM PUBLIC;


--
-- Name: FUNCTION f_pedido_antes_insert(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_pedido_antes_insert() FROM PUBLIC;


--
-- Name: FUNCTION f_pedido_estatus(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_pedido_estatus() FROM PUBLIC;


--
-- Name: FUNCTION f_usuario_validar(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_usuario_validar() FROM PUBLIC;


--
-- Name: FUNCTION f_validar_rol_usuario(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_validar_rol_usuario() FROM PUBLIC;


--
-- Name: FUNCTION f_venta_antes_insert(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_venta_antes_insert() FROM PUBLIC;


--
-- Name: FUNCTION f_venta_cancelar(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.f_venta_cancelar() FROM PUBLIC;


--
-- Name: FUNCTION registrar_cliente(p_nom_usua character varying, p_hash character varying, p_nombre character varying, p_ap character varying, p_am character varying, p_telefono character varying, p_calle character varying, p_numero character varying, p_cruzamientos character varying); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.registrar_cliente(p_nom_usua character varying, p_hash character varying, p_nombre character varying, p_ap character varying, p_am character varying, p_telefono character varying, p_calle character varying, p_numero character varying, p_cruzamientos character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION public.registrar_cliente(p_nom_usua character varying, p_hash character varying, p_nombre character varying, p_ap character varying, p_am character varying, p_telefono character varying, p_calle character varying, p_numero character varying, p_cruzamientos character varying) TO castek_auth;


--
-- Name: TABLE bitacora; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.bitacora TO castek_admin;


--
-- Name: TABLE cliente; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.cliente TO castek_cliente;
GRANT SELECT ON TABLE public.cliente TO castek_vendedor;
GRANT SELECT,INSERT,UPDATE ON TABLE public.cliente TO castek_admin;


--
-- Name: COLUMN cliente.nombre; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(nombre) ON TABLE public.cliente TO castek_cliente;


--
-- Name: COLUMN cliente.ap; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(ap) ON TABLE public.cliente TO castek_cliente;


--
-- Name: COLUMN cliente.am; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(am) ON TABLE public.cliente TO castek_cliente;


--
-- Name: COLUMN cliente.telefono; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(telefono) ON TABLE public.cliente TO castek_cliente;


--
-- Name: COLUMN cliente.id_direc; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(id_direc) ON TABLE public.cliente TO castek_cliente;


--
-- Name: TABLE corte; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.corte TO castek_admin;


--
-- Name: COLUMN corte.observaciones; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(observaciones) ON TABLE public.corte TO castek_admin;


--
-- Name: COLUMN corte.estado; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(estado) ON TABLE public.corte TO castek_admin;


--
-- Name: TABLE detallegasto; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.detallegasto TO castek_admin;


--
-- Name: TABLE detallepedido; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.detallepedido TO castek_cliente;
GRANT SELECT,INSERT ON TABLE public.detallepedido TO castek_vendedor;
GRANT SELECT,INSERT ON TABLE public.detallepedido TO castek_admin;


--
-- Name: COLUMN detallepedido.cantidad; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(cantidad) ON TABLE public.detallepedido TO castek_vendedor;
GRANT UPDATE(cantidad) ON TABLE public.detallepedido TO castek_admin;


--
-- Name: TABLE detalleventa; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.detalleventa TO castek_vendedor;
GRANT SELECT,INSERT ON TABLE public.detalleventa TO castek_admin;


--
-- Name: TABLE direccion; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.direccion TO castek_cliente;
GRANT SELECT ON TABLE public.direccion TO castek_vendedor;
GRANT SELECT,INSERT,UPDATE ON TABLE public.direccion TO castek_admin;


--
-- Name: TABLE favorito; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.favorito TO castek_cliente;
GRANT SELECT ON TABLE public.favorito TO castek_admin;


--
-- Name: COLUMN favorito.activo; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(activo) ON TABLE public.favorito TO castek_cliente;


--
-- Name: TABLE gastos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.gastos TO castek_admin;


--
-- Name: TABLE pedidos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.pedidos TO castek_cliente;
GRANT SELECT ON TABLE public.pedidos TO castek_vendedor;
GRANT SELECT,INSERT ON TABLE public.pedidos TO castek_admin;


--
-- Name: COLUMN pedidos.fecha_entrega; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(fecha_entrega) ON TABLE public.pedidos TO castek_admin;


--
-- Name: COLUMN pedidos.observaciones; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(observaciones) ON TABLE public.pedidos TO castek_vendedor;
GRANT UPDATE(observaciones) ON TABLE public.pedidos TO castek_admin;


--
-- Name: COLUMN pedidos.estatus; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(estatus) ON TABLE public.pedidos TO castek_vendedor;
GRANT UPDATE(estatus) ON TABLE public.pedidos TO castek_admin;


--
-- Name: COLUMN pedidos.danado; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(danado) ON TABLE public.pedidos TO castek_vendedor;
GRANT UPDATE(danado) ON TABLE public.pedidos TO castek_admin;


--
-- Name: TABLE presentprodvent; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.presentprodvent TO castek_cliente;
GRANT SELECT ON TABLE public.presentprodvent TO castek_vendedor;
GRANT SELECT,INSERT,UPDATE ON TABLE public.presentprodvent TO castek_admin;


--
-- Name: TABLE producto; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.producto TO castek_cliente;
GRANT SELECT ON TABLE public.producto TO castek_vendedor;
GRANT SELECT,INSERT,UPDATE ON TABLE public.producto TO castek_admin;


--
-- Name: COLUMN producto.stock; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(stock) ON TABLE public.producto TO castek_vendedor;


--
-- Name: TABLE rol; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.rol TO castek_auth;
GRANT SELECT ON TABLE public.rol TO castek_admin;


--
-- Name: TABLE tipoventa; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT ON TABLE public.tipoventa TO castek_cliente;
GRANT SELECT ON TABLE public.tipoventa TO castek_vendedor;
GRANT SELECT,INSERT,UPDATE ON TABLE public.tipoventa TO castek_admin;


--
-- Name: TABLE usuario; Type: ACL; Schema: public; Owner: postgres
--

GRANT INSERT,UPDATE ON TABLE public.usuario TO castek_admin;


--
-- Name: COLUMN usuario.id_usuario; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id_usuario) ON TABLE public.usuario TO castek_auth;
GRANT SELECT(id_usuario) ON TABLE public.usuario TO castek_admin;


--
-- Name: COLUMN usuario.nombre; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(nombre) ON TABLE public.usuario TO castek_auth;
GRANT SELECT(nombre) ON TABLE public.usuario TO castek_admin;


--
-- Name: COLUMN usuario.nom_usua; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(nom_usua) ON TABLE public.usuario TO castek_auth;
GRANT SELECT(nom_usua) ON TABLE public.usuario TO castek_admin;


--
-- Name: COLUMN usuario.ap; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(ap) ON TABLE public.usuario TO castek_admin;


--
-- Name: COLUMN usuario.am; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(am) ON TABLE public.usuario TO castek_admin;


--
-- Name: COLUMN usuario.telefono; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(telefono) ON TABLE public.usuario TO castek_admin;


--
-- Name: COLUMN usuario.contrasena; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(contrasena) ON TABLE public.usuario TO castek_auth;


--
-- Name: COLUMN usuario.estado; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(estado) ON TABLE public.usuario TO castek_auth;
GRANT SELECT(estado) ON TABLE public.usuario TO castek_admin;


--
-- Name: COLUMN usuario.id_rol; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT(id_rol) ON TABLE public.usuario TO castek_auth;
GRANT SELECT(id_rol) ON TABLE public.usuario TO castek_admin;


--
-- Name: TABLE venta; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.venta TO castek_vendedor;
GRANT SELECT,INSERT ON TABLE public.venta TO castek_admin;


--
-- Name: COLUMN venta.estado; Type: ACL; Schema: public; Owner: postgres
--

GRANT UPDATE(estado) ON TABLE public.venta TO castek_vendedor;
GRANT UPDATE(estado) ON TABLE public.venta TO castek_admin;


--
-- PostgreSQL database dump complete
--

\unrestrict XgqA57Su5duG1eTJG992zpx2gFkE4UzXLTrvh3QhQya8mCSYThhFf0Rwu2IdoBb

