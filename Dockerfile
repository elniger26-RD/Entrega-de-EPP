FROM node:22-trixie-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

FROM deps AS build

COPY index.html ./
COPY Public ./Public
COPY SRC ./SRC
RUN npm run build

FROM node:22-trixie-slim AS runner

ENV NODE_ENV=production
ENV PORT=3001
ENV SQLITE_DB_PATH=/app/data/epp-control.sqlite

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY server ./server
COPY data/epp-control.sqlite ./seed/epp-control.sqlite
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start"]
