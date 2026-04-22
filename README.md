# C4lendar 📅

Aplicación web para la gestión de calendarios de guardias con autenticación JWT, panel de administración, exportación iCal y API REST documentada con Swagger. El proyecto combina un frontend estático en HTML/CSS/JS, un backend en Node.js con Express y una base de datos MariaDB, todo desplegado con Docker Compose.

---

## ✨ Características

- Gestión de usuarios con roles `admin` y `user`.
- Autenticación mediante JWT con control básico de intentos de login.
- Creación, duplicado y borrado de calendarios.
- Asignación de permisos por calendario, con acceso de solo lectura o edición.
- Edición y almacenamiento de datos anuales del calendario.
- Exportación e importación en JSON.
- Exportación iCal y generación de enlaces de suscripción por token.
- Sincronización de calendarios `.ics` externos desde el visor.
- Documentación interactiva de la API con Swagger UI.
- Despliegue con HTTPS usando certificados autofirmados generados automáticamente.

---

## 🧱 Stack

- **Frontend:** HTML + CSS + JavaScript puro servido por Nginx.
- **Backend:** Node.js + Express.
- **Base de datos:** MariaDB 11.
- **Documentación API:** Swagger UI + swagger-jsdoc.
- **Contenedores:** Docker + Docker Compose.

---

## 🏗️ Arquitectura

El despliegue está dividido en cuatro servicios:

| Servicio         | Descripción                                                                 |
|------------------|-----------------------------------------------------------------------------|
| `C4lendar-DB`    | Base de datos MariaDB que almacena usuarios, calendarios, asignaciones, datos anuales e iCal tokens. |
| `C4lendar-BE`    | Backend Node.js/Express que expone la API REST y genera la documentación Swagger. |
| `C4lendar-Certs` | Genera el certificado autofirmado (`server.crt` / `server.key`) en el primer arranque. |
| `C4lendar-FE`    | Nginx que sirve el frontend estático y publica HTTP/HTTPS.                 |

---

## 🚀 Despliegue rápido

### 1. Clonar el repositorio

```bash
git clone https://gitlab.com/tu-usuario/c4lendar.git
cd c4lendar
```

### 2. Revisar estructura esperada

El `docker-compose` monta una carpeta `backend/` dentro del contenedor Node y una carpeta `frontend/` dentro de Nginx. También espera un fichero `nginx.conf` en la raíz del proyecto.

Estructura recomendada:

```text
c4lendar/
├── backend/
│   ├── server.js
│   └── package.json
├── frontend/
│   ├── index.html
│   ├── viewer.html
│   └── 404.html
├── nginx.conf
└── docker-compose.yml
```

### 3. Configurar `docker-compose.yml`

Antes de arrancar, cambia al menos estos valores:

- Contraseña root de MariaDB.
- Contraseña del usuario de aplicación.
- `JWTSECRET`.
- `BASEURL`.
- IP incluida en el certificado autofirmado.

Genera un secreto JWT seguro con:

```bash
openssl rand -base64 48
```

### 4. Ajustar certificado HTTPS

El certificado se genera automáticamente con OpenSSL y usa la IP indicada en `subjectAltName`. Si despliegas en otro servidor, cambia esa IP en el servicio `C4lendar-Certs`.

### 5. Configurar Nginx

El frontend hace de punto de entrada y el `nginx.conf` debe apuntar al backend por nombre de contenedor, normalmente `C4lendar-BE`. Si cambias ese nombre en Docker Compose, actualiza también el `proxy_pass`.

### 6. Arrancar el proyecto

Primera vez:

```bash
docker compose up -d
docker compose logs -f C4lendar-DB
```

Arranques posteriores:

```bash
docker compose up -d
```

La base de datos tiene un `healthcheck` con `start_period` amplio, así que el backend no arranca hasta que MariaDB está lista.

---

## 🔐 Credenciales iniciales

En el primer arranque, si no existe ningún usuario, se crea automáticamente un usuario administrador con credenciales `admin` / `admin`. Cambia la contraseña en cuanto accedas por primera vez.

| Campo      | Valor   |
|-----------|---------|
| Usuario   | `admin` |
| Contraseña| `admin` |

---

## 🌐 URLs y puertos

Según la configuración típica de `docker-compose`, estos son los puertos publicados:

| Recurso             | URL por defecto                    |
|---------------------|------------------------------------|
| Frontend HTTP       | `http://TU_HOST:8083`             |
| Frontend HTTPS      | `https://TU_HOST:8443`            |
| Swagger UI          | `http://TU_HOST:4000/api-docs`    |
| API backend         | `http://TU_HOST:4000` (si se expone)|

| Servicio  | Puerto host | Puerto contenedor | Notas                          |
|-----------|-------------|-------------------|--------------------------------|
| Frontend  | `8083`      | `80`              | Publicado por Nginx            |
| Frontend  | `8443`      | `443`             | Certificado autofirmado        |
| Backend   | opcional    | `4000`            | Servicio interno Node.js       |
| MariaDB   | `3308`      | `3306`            | Administración externa opcional|

---

## 👤 Frontend

El frontend está compuesto por tres ficheros estáticos principales:

- `index.html`: panel principal con login, gestión de usuarios y administración de calendarios.
- `viewer.html`: visor anual/mensual del calendario, gestión de semanas, eventos, feeds iCal, exportación JSON e iCal.
- `404.html`: página de error.

La interfaz usa un estilo tipo Material Design, soporte claro/oscuro y separación entre panel administrativo y visor de calendario.

---

## 🔌 API principal

La API está construida con Express y documentada con Swagger.

### Autenticación

- `POST /api/auth/login` — obtiene el JWT.
- `GET /api/auth/me` — devuelve el usuario autenticado.

### Usuarios

- `POST /api/users` — crear usuario (solo admin).
- `GET /api/users` — listar usuarios (solo admin).
- `PUT /api/users/me/password` — cambiar la contraseña propia.
- `PUT /api/users/:id` — actualizar rol o contraseña (solo admin).
- `DELETE /api/users/:id` — eliminar usuario (solo admin).

### Calendarios

- `POST /api/calendars` — crear calendario (solo admin).
- `GET /api/calendars` — listar calendarios accesibles.
- `GET /api/calendars/:id` — obtener un calendario concreto.
- `DELETE /api/calendars/:id` — eliminar calendario (solo admin).
- `POST /api/calendars/:id/duplicate` — duplicar calendario (solo admin).

### Permisos

- `GET /api/calendars/:id/assignments` — listar permisos de un calendario (solo admin).
- `PUT /api/calendars/:id/assignments` — reemplazar asignaciones de usuarios (solo admin).

### Datos anuales

- `GET /api/calendars/:id/year/:year` — cargar el estado del año.
- `PUT /api/calendars/:id/year/:year` — guardar el estado del año.
- `GET /api/calendars/:id/year/:year/export` — exportar JSON.
- `POST /api/calendars/:id/year/:year/import` — importar JSON (solo admin).

### iCal

- `GET /api/ical/fetch` — proxy para descargar un `.ics` externo autenticado.
- `GET /api/calendars/:id/year/:year/ical` — genera un `.ics` desde el calendario.
- `POST /api/calendars/:id/year/:year/ical-token` — crea una URL de suscripción temporal.
- `GET /api/ical/token/:token` — sirve el `.ics` usando token.

---

## 🗃️ Base de datos

El backend crea automáticamente las tablas necesarias al iniciar la aplicación, por lo que no hace falta ejecutar migraciones manuales en el estado actual del proyecto.

Tablas principales:

- `users`
- `calendars`
- `calendarassignments`
- `calendardata`
- `icaltokens`

Además, el backend combina festivos nacionales obtenidos desde Nager.Date con festivos regionales definidos en código para comunidades autónomas.

---

## 🛠️ Comandos útiles

```bash
# Levantar servicios
docker compose up -d

# Ver logs de todos los servicios
docker compose logs -f

# Ver logs solo de la base de datos
docker compose logs -f C4lendar-DB

# Ver logs solo del backend
docker compose logs -f C4lendar-BE

# Reiniciar solo el backend
docker compose restart C4lendar-BE

# Entrar al contenedor del backend
docker exec -it C4lendar-BE sh

# Entrar a MariaDB
docker exec -it C4lendar-DB mariadb -u TU_USUARIO -p
```

---

## 🔄 Actualizar el proyecto

```bash
git pull
docker compose down
docker compose up -d
```

Los datos persisten en los volúmenes Docker definidos para MariaDB y certificados, así que una actualización normal no debería borrar información.

---

## 🧹 Reset completo

### Resetear la base de datos

```bash
docker compose down
docker volume rm c4lendar_c4lendardbdata
```

Esto elimina todos los calendarios, usuarios, asignaciones y datos guardados.

### Regenerar el certificado HTTPS

```bash
docker compose down
docker volume rm c4lendar_c4lendarcerts
```

El siguiente arranque volverá a generar `server.crt` y `server.key`.

---

## 📦 Dependencias del backend

| Paquete              | Uso                                   |
|----------------------|----------------------------------------|
| `express`            | Servidor HTTP y API REST              |
| `mysql2`             | Acceso a MariaDB/MySQL                |
| `bcrypt`             | Hash de contraseñas                   |
| `jsonwebtoken`       | Autenticación JWT                     |
| `node-fetch`         | Peticiones HTTP externas (festivos, iCal) |
| `swagger-ui-express` | Interfaz Swagger UI                   |
| `swagger-jsdoc`      | Generación de especificación OpenAPI  |

---

## 🔒 Seguridad

- Cambia todas las contraseñas incluidas en `docker-compose.yml`.
- Sustituye `JWTSECRET` por un valor fuerte y privado.
- Cambia la contraseña del usuario `admin` inicial.
- Revisa el endpoint `/api/ical/fetch`, ya que actúa como proxy HTTP autenticado.
- Considera reemplazar el certificado autofirmado por uno válido si el proyecto se expone públicamente.

---

## 📄 Licencia

Este proyecto está licenciado bajo la licencia MIT. Consulta el fichero `LICENSE` para más información.
