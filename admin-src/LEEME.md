# Código fuente del panel de administración

`admin.js` (en la raíz del repo) se arma desde estos archivos:

    npm install esbuild firebase xlsx
    npx esbuild admin-src/admin.js --bundle --format=esm --minify --outfile=admin.js
