FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./

EXPOSE 3000

CMD ["npm", "run", "forward"]
