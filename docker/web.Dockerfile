FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY frontend frontend
ARG VITE_WHATSAPP_SUPPORT=5519990041826
ENV VITE_WHATSAPP_SUPPORT=$VITE_WHATSAPP_SUPPORT
RUN npm run build -w @linkon/frontend

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
