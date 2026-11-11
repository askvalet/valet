# Two stages: build the web app and the server bundle, then a runtime with nothing but the bundle (the server and
# everything it imports are one folder of JavaScript; there's no node_modules to ship).
# The base image is pinned by digest so a rebuild gets exactly what was tested; bump both lines together.
FROM node:24.22.3-alpine3.23@sha256:3946fb783fdce8a2812136ea694bc95c698c4f4096f3fd18568dc27a8ac389dc AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.22.3-alpine3.23@sha256:3946fb783fdce8a2812136ea694bc95c698c4f4096f3fd18568dc27a8ac389dc
WORKDIR /app
ENV NODE_ENV=production PORT=7575 VALET_CONFIG=/config/config.yaml
COPY --from=build /app/dist ./dist
# the assistant's reference: it answers questions about Valet from these
COPY --from=build /app/docs ./docs
COPY --from=build /app/website/src/content/docs ./website/src/content/docs
COPY package.json ./
USER node
EXPOSE 7575
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7575)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
