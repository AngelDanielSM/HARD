# HarnessLab

Editor local de diagramas de arneses, conectores, cables, crimps y reportes de pruebas.

## Desarrollo local

Requiere Node.js y pnpm. Desde la raíz del proyecto:

```powershell
pnpm install
pnpm dev
```

También puedes iniciar el entorno de Windows con `iniciar.cmd`. El cliente Vite corre en el puerto 5173 y el servidor Express/Socket.IO en el 3000. Los datos y usuarios se guardan en SQLite dentro de `servidor/`.

## Compilar el cliente

```powershell
pnpm --dir cliente build
```

## Git y despliegue

Este repositorio contiene cliente y servidor. El servidor actual usa SQLite local y Socket.IO persistente; por eso no se debe desplegar como una aplicación Vercel completa sin adaptar el backend y el almacenamiento. Para usar Vercel como vista previa del cliente, hace falta conectar el frontend a un backend accesible y persistente.
