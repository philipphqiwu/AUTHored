import 'dotenv/config'
import express from 'express'
import path from 'path'
import cookieParser from 'cookie-parser'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

import authRoutes from './routes/auth.js'
import oauthRoutes from './routes/oauth.js'

const app = express()
const PORT = process.env.PORT || 3000
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

app.use('/', authRoutes)
app.use('/', oauthRoutes)

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Auth Provider Server' })
})

app.listen(PORT, () => {
  console.log(`Auth Server running on http://localhost:${PORT}`)
})
