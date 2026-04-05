# CLAUDE.md — Contexto del Proyecto

> **INSTRUCCION PARA EL AGENTE:**
> Este archivo es el documento vivo de contexto del proyecto. Cada vez que hagas cambios significativos (nuevas rutas, cambios en el schema, nueva lógica de negocio, módulos nuevos, cambios en autenticación, cambios de diseño/UI, etc.) **debes actualizar este archivo** antes de terminar tu respuesta. El próximo agente Claude leerá este archivo al inicio para entender el estado actual del proyecto. Mantén cada sección concisa pero completa.
>
> **IMPORTANTE — DISEÑO DE INTERFAZ:**
> Este proyecto tiene skills de diseño locales en `.claude/skills/`. Para cualquier trabajo de UI/UX o diseño visual **SIEMPRE** usa estas skills. Ver sección "Skills de Diseño Disponibles" más abajo.

---

## Descripción General

**Nombre del proyecto:** Portal de Pedidos — Grupo Corripio (Manuel Corripio S.A.S)
**Versión:** 2.0.0
**Stack:** Node.js (Express 5) + SQL Server (Azure) + Dynamics 365 F&O + Azure App Service

Portal interno para gestión de pedidos de ventas. Sincroniza automáticamente pedidos desde una base de datos SQL Azure hacia Dynamics 365 Finance & Operations vía OData. Incluye dashboard, visualización de cobros, tracking de ubicaciones, y panel de administración.

---

## Estructura de Archivos

```
/
├── server.js              # Servidor Express principal. API + SPA fallback + sync autostart
├── auth.js                # OAuth2 client-credentials para Dynamics 365 (getAccessToken)
├── syncOrders.js          # Loop de sincronización SQL → Dynamics 365 (cada 30s)
├── dbConnection.js        # Pool MSSQL + todas las queries de negocio (pedidos, cobros, etc.)
├── middleware/
│   └── auth.js            # JWT middleware: requireAuth, requireAdmin, getVendorFilter
├── routes/
│   ├── authRoutes.js      # /api/auth/* — Microsoft OAuth2 Authorization Code Flow
│   └── adminRoutes.js     # /api/admin/* — CRUD usuarios, vendor groups, vendor map
├── db/
│   ├── schema.js          # ensureAuthSchema() — crea tablas auth si no existen
│   └── authDb.js          # Queries de usuarios, módulos, vendor groups, audit log
├── public/
│   ├── index.html         # SPA principal (vanilla JS, sin framework)
│   ├── app.js             # Lógica principal del frontend
│   ├── admin.js           # Panel de administración frontend
│   ├── login.js           # Lógica de login
│   └── style.css          # Estilos
├── .github/workflows/
│   └── azure-deploy.yml   # CI/CD: push a main → deploy a Azure App Service
└── web.config             # Configuración IIS/Azure para Node.js
```

---

## Variables de Entorno Requeridas

| Variable | Descripción |
|---|---|
| `TENANT_ID` | Azure AD Tenant ID |
| `CLIENT_ID` | Azure App Registration Client ID (usado para Dynamics Y para Microsoft OAuth login) |
| `CLIENT_SECRET` | Client secret para Dynamics 365 (client_credentials) |
| `MS_AUTH_SECRET` | Client secret para Microsoft OAuth login (fallback a `CLIENT_SECRET`) |
| `RESOURCE_URL` | URL base de Dynamics 365 F&O |
| `DB_SERVER` | Servidor SQL Azure |
| `DB_NAME` | Nombre de la base de datos |
| `DB_USER` | Usuario SQL |
| `DB_PASSWORD` | Contraseña SQL |
| `JWT_SECRET` | Secret para firmar JWTs de sesión |
| `ALLOWED_ORIGIN` | Origen permitido para CORS |
| `PORT` | Puerto del servidor (default: 3000) |
| `NODE_ENV` | `production` oculta stack traces en respuestas de error |

---

## Autenticación y Autorización

### Flujo de Login
1. Usuario hace click en "Iniciar sesión con Microsoft"
2. Frontend llama `GET /api/auth/microsoft` → servidor redirige a Microsoft OAuth2
3. Microsoft devuelve `code` a `GET /api/auth/callback`
4. Servidor intercambia code por token, obtiene perfil via Microsoft Graph
5. Busca o crea usuario en `app_users`. El primer usuario registrado se convierte en `admin`
6. Genera JWT (8h) y lo setea como cookie HttpOnly `app_token`
7. Cookie adicional `app_user` (JS-readable, sin token) con datos de display

### Roles
- `admin`: acceso total, sin filtro de vendedores
- `supervisor`: (definido en schema, pendiente de implementación diferenciada)
- `viewer`: filtrado por sus vendedores asignados

### JWT Payload
```json
{
  "sub": <user_id>,
  "email": "...",
  "display_name": "...",
  "role": "admin|supervisor|viewer",
  "modules": ["dashboard", "pedidos", ...],
  "vendors": ["Nombre Vendedor", ...]
}
```

### Módulos disponibles
`dashboard`, `pedidos`, `cobros`, `sync`, `logs`, `rangos`, `tracking`, `clientes-extra`

---

## API Endpoints

### Auth (`/api/auth`)
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/auth/microsoft` | No | Redirige al login de Microsoft |
| GET | `/api/auth/callback` | No | Callback OAuth2, setea cookies |
| POST | `/api/auth/logout` | No | Limpia cookies de sesión |
| GET | `/api/auth/me` | requireAuth | Retorna usuario actual |

### Admin (`/api/admin`) — requireAuth + requireAdmin
| Método | Ruta | Descripción |
|---|---|---|
| GET/PUT | `/users`, `/users/:id` | Listar/actualizar usuarios |
| PUT | `/users/:id/modules` | Asignar módulos |
| PUT | `/users/:id/vendors` | Asignar vendedores individuales |
| PUT | `/users/:id/vendor-groups` | Asignar grupos de vendedores |
| GET/POST/PUT/DELETE | `/vendor-groups` | CRUD grupos de vendedores |
| GET | `/available-vendors` | Lista todos los vendedores disponibles |
| GET/POST/PUT/DELETE | `/vendor-map` | CRUD mapeo vendedor → Dynamics |
| GET | `/catalog-users` | Usuarios del catálogo de productos |
| PUT | `/catalog-users/:username/reset-password` | Reset contraseña catálogo |
| POST | `/catalog-users/sync` | Sincronizar vendedores al catálogo |

### Negocio (requireAuth)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/dashboard` | KPIs con filtros (vendedor, cliente, fechas) |
| GET | `/api/dashboard/filters` | Vendedores y clientes para filtros |
| GET | `/api/pedidos` | Lista pedidos (filtrado por vendor si no es admin) |
| GET | `/api/pedidos/:id` | Detalle pedido |
| GET | `/api/pedidos/:id/lineas` | Líneas de un pedido |
| POST | `/api/pedidos/:id/retry` | Reenviar pedido a Dynamics |
| GET | `/api/cobros` | Lista cobros |
| GET | `/api/rangos` | CRUD rangos |
| GET | `/api/tracking` | Logs de tracking de ubicación |
| GET | `/api/vendedores` | Lista de vendedores |
| GET | `/api/clientes` | Lista de clientes |
| GET | `/api/clientes-buscar?q=` | Búsqueda de clientes |
| GET/POST/DELETE | `/api/clientes-extra` | Clientes extra por vendedor |
| GET | `/api/sync/status` | Estado del sync |
| GET | `/api/sync/log` | Log del sync |
| POST | `/api/sync/trigger` | Dispara un ciclo de sync manual |
| GET | `/api/dynamics/campos` | Campos disponibles en Dynamics OData |
| GET | `/api/sql/columnas` | Columnas de tablas SQL (admin only) |
| GET | `/api/health` | Health check |

---

## Base de Datos SQL Server

### Tablas de negocio (pre-existentes)
- `pedidos` — pedidos de ventas con `vendedor_nombre`, `cliente_nombre`, estado sync
- `pedidos_detalle` — líneas de pedidos
- `cobros` — cobros asociados a vendedores
- `info_venderores` — tabla origen de vendedores (usada por sync catálogo)
- `usuarios_vendedores` — usuarios del catálogo de productos (credenciales legacy)
- `vendedor_dynamics_map` — mapeo: `vendedor_nombre` → `personnel_number`, `sales_group_id`, `secretario_personnel_number`

### Tablas auth (creadas automáticamente por `ensureAuthSchema()`)
- `app_users` — usuarios del portal (roles: admin, supervisor, viewer)
- `app_user_modules` — módulos habilitados por usuario
- `app_user_vendors` — vendedores individuales asignados a un usuario
- `app_vendor_groups` — grupos de vendedores
- `app_vendor_group_members` — miembros de cada grupo
- `app_user_vendor_groups` — grupos asignados a un usuario
- `app_audit_log` — log de acciones admin

### Filtrado por vendedor
La función `getVendorFilter(user)` en `middleware/auth.js` retorna:
- `null` → admin, sin filtro
- `string[]` → nombres de vendedores (union de individuales + grupos)
- `[]` → usuario sin vendors asignados, no ve nada

---

## Sincronización con Dynamics 365

- **Intervalo:** cada 30 segundos (`syncOrders.js`)
- **Flujo:** `getPendingOrders()` → por cada pedido: `getAccessToken()` → `processOrder()` → `saveOrderNumber()` / `markOrderAsFailed()`
- **Auth:** OAuth2 client_credentials contra Azure AD
- **API:** Dynamics 365 OData v4 (`/data/SalesOrderHeadersV2`, `/data/SalesOrderLines`)
- El `extractErrorMessage()` limpia los mensajes de error de Dynamics (filtra ruido del Infolog)

---

## Seguridad

- **Helmet:** CSP configurada para permitir Leaflet (mapas), Google Fonts, CDNs de scripts
- **Rate limiting:** 300 req/15min general; 20 req/15min en `/api/auth/`
- **CORS:** solo origen configurado en `ALLOWED_ORIGIN`
- **JWT:** HS256, 8 horas, vía cookie HttpOnly (`app_token`)
- **CSRF:** state token en memoria para el flujo OAuth (expira en 10 min)
- **CSP:** `scriptSrcAttr: unsafe-inline` habilitado para onclick/onchange inline en HTML

---

## Deploy

- **Plataforma:** Azure App Service (`catalogodeproductos`)
- **CI/CD:** GitHub Actions — push a `main` dispara deploy automático
- **Node:** 20.x
- **Zona horaria:** `America/Santo_Domingo` (hardcoded en server.js)

---

## Frontend (SPA Vanilla)

- Sin framework (vanilla JS)
- Vistas: `dashboard`, `pedidos`, `cobros`, `sync`, `logs`, `rangos`, `tracking`, `clientes-extra`, `admin`
- Mapa interactivo con **Leaflet.js** + **leaflet.markercluster** para tracking de ubicaciones
- Login overlay que se oculta una vez autenticado
- Sidebar con navegación por módulos (visible según permisos del JWT)

---

## Historial de cambios relevantes

| Commit | Descripción |
|---|---|
| `5bb6ea7` | Core app logic + helper fetch autenticado en app.js |
| `f738e5d` | Widget top items dashboard, CSP para mapas, lógica frontend |
| `dc38f7f` | CSP: permitir source maps externos |
| `cbec711` | CSP: unsafe-inline para scripts |
| `152dccc` | Sistema de autenticación, roles y vendor group access control |
| `5409ffa` | DB access layer para auth y vendor management |
| `1714b96` | Panel admin (usuario management + vendor groups) |

---

---

## Skills de Diseño Disponibles

> **Para cualquier tarea de diseño o UI/UX, SIEMPRE invocar la skill correspondiente** con `/nombre-skill`.
> Las skills están en `.claude/skills/` y tienen referencias, scripts y datos listos para usar.

| Skill | Invocación | Cuándo usarla |
|---|---|---|
| **UI/UX Pro Max** | `/ui-ux-pro-max` | Diseño general de UI/UX: dashboards, paneles, layouts, componentes, estilos (50+ estilos, 161 paletas, 57 font pairings). **Empezar aquí para cualquier rediseño de pantalla.** |
| **UI Styling** | `/ckm:ui-styling` | Implementación con shadcn/ui + Tailwind CSS, modo oscuro, accesibilidad, componentes (modals, forms, tables, dropdowns). |
| **Design System** | `/ckm:design-system` | Tokens de diseño (primitive → semantic → component), sistema de colores, tipografía, espaciado consistente. |
| **Design** | `/ckm:design` | Logos, iconos SVG (15 estilos), identidad corporativa, fotos para redes sociales, slides HTML. |
| **Slides** | `/ckm:slides` | Presentaciones HTML con Chart.js, layouts estratégicos, copywriting. |
| **Banner Design** | `/ckm:banner-design` | Banners para redes sociales, ads, hero sections (22 estilos, Facebook, LinkedIn, Instagram, Google Display). |
| **Brand** | `/ckm:brand` | Guías de marca, voz, identidad visual, consistencia, activos de marca. |

### Estado actual del diseño (post-rediseño 2026-04-05)

- **Stack frontend:** Vanilla JS (sin framework), CSS propio (`style.css`), Google Fonts (Inter)
- **Mapas:** Leaflet.js + leaflet.markercluster
- **Design system:** Tres capas de tokens CSS (primitive → semantic → component) implementadas en `style.css`
- **Dark mode:** Activado via `html[data-theme="dark"]` — toggle en topbar, persiste en `localStorage`
  - `initTheme()` se llama en `DOMContentLoaded` y hay un inline script en `<head>` para evitar FOUC
  - `toggleTheme()` alterna el atributo y guarda en localStorage
- **Skeleton loaders:** `.skeleton`, `.skeleton-text`, `.skeleton-title`, `.skeleton-card` con shimmer animation
- **KPI trends:** `.kpi-trend--up`, `.kpi-trend--down`, `.kpi-trend--flat`
- **Botones:** `.btn-primary` (gradient), `.btn-ghost`, `.btn-danger`, `.btn-lg`, `.btn-icon`, `.btn-sm`
- **Login screen:** Glassmorphism card, radial gradient animado, shimmerLine top border
- **Sidebar:** Accent line bajo brand, indicador activo con `::before`, transiciones suaves
- **Para agregar componentes modernos** considerar migrar vistas a shadcn/ui o Tailwind (ver `/ckm:ui-styling`)

---

*Última actualización: 2026-04-05*
