# Two stages: build the web app, then a small runtime with only production dependencies.
FROM node:24.11-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24.11-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=7575 ATRIUM_CONFIG=/config/config.yaml
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 7575
CMD ["node", "dist/server.js"]
