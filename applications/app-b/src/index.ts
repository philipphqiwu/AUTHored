import 'dotenv/config'
import express from 'express'
import path from 'path'
import cookieParser from 'cookie-parser'
import expressLayouts from 'express-ejs-layouts'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

import routes from './routes/index.js'

const app = express()
const PORT = process.env.PORT || 3003
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.set('layout', 'layout')

app.use(expressLayouts)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

app.use('/', routes)

app.listen(PORT, () => {
  console.log(`App B running on http://localhost:${PORT}`)
})
