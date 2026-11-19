FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Expose port (Render/Railway automatically assigns PORT)
ENV PORT=3000
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
