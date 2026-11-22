MAIN=server.js
MEMORY=1024
VERSION=recommended
DISPLAY_NAME=AMD Live
DESCRIPTION=AMD Live - analise de futebol virtual (Vavada/Kiron)
SUBDOMAIN=amdlive
AUTORESTART=true
START=node --max-old-space-size=768 server.js
