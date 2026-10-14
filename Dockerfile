# Margin — single-container deployment (API + built web app).
# Mount a persistent volume at /app/data (uploads, embedded DB if no DATABASE_URL, model cache).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]
EXPOSE 3001
USER node
CMD ["node", "--import", "tsx", "server/index.ts"]
