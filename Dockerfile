# Alta Capital Base Server in a container (DB, 24/7 cron, AI research analyst, UI).
# Ollama/Colibri stay on the host (they use the Intel Arc / CPU) and are reached via host.docker.internal.
# The WhatsApp / X browser agents need a visible Chrome on your desktop, so they stay on the host.
FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts
COPY . .
ENV ALTA_BASE_SERVER=1 NODE_ENV=production HOST=0.0.0.0 PORT=8181 DB_MODE=local
EXPOSE 8181
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s CMD node -e "fetch('http://127.0.0.1:8181/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-base-server.mjs"]