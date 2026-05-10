import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // FastAPI-backed routes used by the current admin and attendance app
      '/auth': 'http://localhost:8000',
      '/students': 'http://localhost:8000',
      '/attendance': 'http://localhost:8000',
      '/camera': 'http://localhost:8000',
      '/subjects': 'http://localhost:8000',
      '/chatbot': 'http://localhost:8000',
      '/fire': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
    },
  },
})
