FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY web/package.json ./web/package.json
RUN npm --prefix web install --no-audit --no-fund
COPY web ./web
RUN npm --prefix web run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DB_PATH=/app/data/appointment.sqlite
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY --from=frontend /build/web/dist ./web/dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3001
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--experimental-sqlite","server/index.js"]
